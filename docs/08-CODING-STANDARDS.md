# NetAmplify — Coding Standards (mandatory)

> Status: LOCKED for MVP. These are not suggestions — they are enforced
> by lint, typecheck, code review, and CI. Violations block merge.
> Companion docs: `03-ARCHITECTURE.md` (folder structure), `07-SECURITY-ACCESS.md`
> (security checklist), `08-CODING-STANDARDS.md` (this doc).

---

## 1. TypeScript

### 1.1 Strict mode (non-negotiable)

```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "moduleResolution": "bundler"
  }
}
```

### 1.2 `any` is forbidden

- Use `unknown` + narrow with a type guard or Zod parse.
- The ONLY exception: third-party types we can't control (and we wrap
  those in our own type at the boundary).

```typescript
// WRONG:
function handleWebhook(body: any) { ... }

// RIGHT:
function handleWebhook(body: unknown) {
  const parsed = webhookBodySchema.parse(body);  // throws on invalid
  // parsed is typed
  ...
}
```

### 1.3 Non-null assertion `!` is forbidden outside tests

- Use optional chaining `?.` and nullish coalescing `??`.
- For values you KNOW are non-null after a check, use a type guard.

```typescript
// WRONG:
const name = user!.name;  // we "know" user exists

// RIGHT:
if (!user) throw new Error('unreachable');  // OR
const name = user?.name ?? 'anonymous';
```

### 1.4 Branded types for IDs

Prevents passing a `PostCardId` where a `PostId` is expected.

```typescript
// src/types/branded.ts
export type Branded<T, B> = T & { __brand: B };
export type UserId = Branded<string, 'UserId'>;
export type PostCardId = Branded<string, 'PostCardId'>;
export type PostId = Branded<string, 'PostId'>;
export type PostTargetId = Branded<string, 'PostTargetId'>;
export type ConnectionId = Branded<string, 'ConnectionId'>;

// Usage in services:
export async function getPostCard(
  userId: UserId,
  postCardId: PostCardId,
): Promise<PostCard | null> { ... }
```

### 1.5 Result type for service returns (no thrown exceptions for
expected errors)

```typescript
// src/types/results.ts
export type Result<T, E> =
  | { ok: true; data: T }
  | { ok: false; error: E };

// Usage:
export async function publishPostCard(
  userId: UserId,
  postCardId: PostCardId,
  platforms: Platform[],
  requestId: string,
): Promise<
  Result<
    { post: Post; targets: PostTarget[] },
    | { code: 'INVALID_CREDENTIALS'; invalidPlatforms: Platform[] }
    | { code: 'DUPLICATE_REQUEST'; postId: string }
    | { code: 'NOT_FOUND' }
  >
> { ... }

// Consumer:
const result = await publishPostCard(...);
if (!result.ok) {
  switch (result.error.code) {
    case 'INVALID_CREDENTIALS': ...
    case 'DUPLICATE_REQUEST': ...
    case 'NOT_FOUND': ...
  }
  return;
}
const { post, targets } = result.data;
```

### 1.6 When to throw

- Throw for **unexpected** errors (programmer bugs, invariant
  violations): `throw new Error('unreachable: userId should be set')`.
- Throw for **expected** errors (validation, not-found, conflict):
  return `Result.err(...)` from service; route handler maps to HTTP
  status.
- NEVER throw inside a service for an expected condition; the caller
  can't tell what kind of error happened without catching.

---

## 2. Layering

```
Route handler
  ├─ Guard (auth, rate-limit)
  ├─ Zod parse (input)
  ├─ Service call (business logic)
  └─ Error mapper → HTTP response
       │
       ▼
Service (src/server/services/*.ts)
  ├─ Prisma queries (owner-scoped)
  ├─ TokenVault calls (only in connections.ts during validation)
  ├─ Audit log writes
  └─ BullMQ enqueue (publish.ts only)
       │
       ▼
Pure helpers (src/lib/*)
  ├─ formatters (no DB, no network, no Date.now)
  ├─ vault (encrypt/decrypt only)
  ├─ validation schemas (shared)
  └─ config (typed env, platform limits)
       │
       ▼
Platform adapters (src/lib/platforms/*)
  └─ The ONLY place that calls platform APIs
       │
       ▼
Workers (src/workers/*.ts)
  ├─ Load target
  ├─ Decrypt creds in-memory
  ├─ Call formatter
  ├─ Call adapter
  └─ Update PostTarget status
```

### Rules

- **Business logic ONLY in `src/server/services/`.** Route handlers
  are thin (guard → Zod → service → errorMapper).
- **Adapters are the ONLY place that touches platform APIs.** UI
  components, route handlers, services MUST NOT import platform SDKs.
- **Formatters are pure.** No DB, no network, no `Date.now()`, no
  `Math.random()`. Same input → identical output, always.
- **Workers are thin.** Load → decrypt → format → adapter → persist.
  No business decisions in workers; all decisions in services before
  enqueue.

---

## 3. Validation

### 3.1 Shared Zod schemas

`src/lib/validation/schemas.ts`:

```typescript
import { z } from 'zod';

export const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72),
  name: z.string().min(1).max(100),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const profilePatchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  headline: z.string().max(140).optional(),
  // ...
});
export type ProfilePatch = z.infer<typeof profilePatchSchema>;

export const postCardCreateSchema = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(200),
  description: z.string().max(5000),
  techStack: z.array(z.string().min(1).max(24)).min(1).max(10),
  repoUrl: z.string().url().optional().or(z.literal('')),
  liveUrl: z.string().url().optional().or(z.literal('')),
});
export type PostCardCreate = z.infer<typeof postCardCreateSchema>;

// ... etc
```

### 3.2 Schema reuse

- Forms use the same schema via `@hookform/resolvers/zod`.
- Route handlers use the same schema to parse request body.
- This means: change the rule once → all three layers enforce.

### 3.3 Custom Zod refinements (where needed)

```typescript
export const githubUrlSchema = z.string()
  .url()
  .startsWith('https://github.com/')
  .refine(
    (url) => !url.includes(' ') && url.length < 500,
    'Invalid GitHub URL'
  ).optional().or(z.literal(''));
```

---

## 4. Errors

### 4.1 No silent catch

```typescript
// WRONG:
try {
  await someAsync();
} catch (e) {
  // empty
}

// WRONG:
try {
  await someAsync();
} catch (e) {
  console.error(e);  // logs raw error, leaks internals
}

// RIGHT:
try {
  await someAsync();
} catch (e) {
  logger.warn({ route, userId, requestId, err: serializeError(e) },
    'someAsync failed');
  return Result.err({ code: 'INTERNAL' });
}
```

### 4.2 Never leak raw DB / platform errors

```typescript
// WRONG:
return res.status(500).json({ error: { message: prismaError.message } });
// Prisma errors include column names, constraint names, sometimes
// even row data — internal leakage.

// RIGHT:
// Map via src/lib/errors/mapper.ts
const apiError = mapPrismaError(prismaError);
return res.status(apiError.status).json({ error: apiError.body });
```

### 4.3 Logging discipline

- Always log with structured fields: `{ route, userId, requestId,
  latencyMs, outcome }`.
- NEVER log credentials, decrypted content, full request bodies for
  credential routes.
- Levels:
  - `debug`: dev only (request bodies for non-credential routes).
  - `info`: audit events (PUBLISH, CONNECT, etc.).
  - `warn`: rate-limit hits, retries, expected-but-notable errors.
  - `error`: 5xx, adapter failures, unhandled exceptions.
- See `16-OBSERVABILITY.md` for the full schema + scanner regex.

### 4.4 Error mapper (`src/lib/errors/mapper.ts`)

```typescript
export function mapServiceError<T extends { code: string }>(
  error: T
): { status: number; body: ErrorResponse } {
  switch (error.code) {
    case 'VALIDATION_ERROR':
      return { status: 400, body: { error: { code: 'VALIDATION_ERROR',
        message: error.message, fieldErrors: error.fieldErrors } } };
    case 'NOT_FOUND':
      return { status: 404, body: { error: { code: 'NOT_FOUND',
        message: 'Not found' } } };
    case 'INVALID_CREDENTIALS':
      return { status: 400, body: { error: { code: 'INVALID_CREDENTIALS',
        message: error.message, invalidPlatforms: error.invalidPlatforms } } };
    case 'DUPLICATE_REQUEST':
      return { status: 409, body: { error: { code: 'DUPLICATE_REQUEST',
        message: 'Already publishing this card', postId: error.postId } } };
    // ...
    default:
      return { status: 500, body: { error: { code: 'INTERNAL',
        message: 'Something went wrong' } } };
  }
}
```

---

## 5. Prisma

### 5.1 Owner-scoped queries (Rule R1 — see 07-SECURITY-ACCESS §3)

```typescript
// WRONG:
const card = await prisma.postCard.findUnique({ where: { id } });

// RIGHT:
const card = await prisma.postCard.findUnique({
  where: { id, userId },  // session.user.id
});
if (!card) return Result.err({ code: 'NOT_FOUND' });
```

### 5.2 Field naming

- Prisma fields: `camelCase` (e.g., `createdAt`, `userId`).
- Prisma models: `PascalCase` (e.g., `PostCard`, `PostTarget`).
- DB columns (via `@map`): snake_case IF we need raw SQL; otherwise
  camelCase in DB too (default Prisma behavior).
- DB tables: snake_case (Prisma default uses model name verbatim; we
  can override with `@@map("post_cards")` if needed for SQL ergonomics).

### 5.3 Migrations

- Only via `npx prisma migrate dev --name <descriptive-name>`.
- NEVER `prisma db push` in dev (loses migration history).
- Commit the migration alongside the schema change.
- Destructive migrations (drop column, rename) require a 2-PR dance
  (see `04-DATABASE.md` §6).

### 5.4 Transactions

- Use `prisma.$transaction([...])` for multi-row writes.
- For the publish flow, use `$transaction` to ensure Post + PostTargets
  are created atomically.
- For X quota check + increment, use `$transaction` with conditional
  `where: { used: { lt: budget } }` to handle the race (FR-018).

### 5.5 N+1 prevention

- Use `include` / `select` for related data, not separate queries.
- For history list: `prisma.post.findMany({ include: { targets: true,
  postCard: { select: { id: true, title: true } } } })`.

---

## 6. Naming conventions

| Element | Convention | Example |
|---|---|---|
| Files (all) | `kebab-case.ts` / `kebab-case.tsx` | `token-vault.ts`, `connection-card.tsx` |
| Components (React) | `PascalCase` | `PostCardGrid`, `StatusChip` |
| Functions | `camelCase` | `publishPostCard`, `formatForReddit` |
| Constants | `SCREAMING_SNAKE_CASE` for env, `camelCase` for normal | `MAX_RETRIES`, `platformRegistry` |
| Types / interfaces | `PascalCase` | `PostCard`, `FormattedPayload` |
| Enums | `PascalCase` for type, `SCREAMING_SNAKE_CASE` for values | `Platform.REDDIT`, `PostTargetStatus.QUEUED` |
| Hooks | `useX` | `usePostStatus`, `useSession` |
| API JSON | `camelCase` | `{ postCardId, createdAt, ... }` |
| DB columns | `camelCase` (Prisma default) | `createdAt`, `userId` |
| DB tables | `snake_case` (if we override) or camelCase (Prisma default) | `post_card` or `PostCard` |
| Routes (URLs) | `kebab-case` | `/api/post-cards` (we use `postcards` for legacy — keep) |
| Env vars | `SCREAMING_SNAKE_CASE` | `DATABASE_URL`, `TOKEN_ENCRYPTION_KEY` |

### Component file naming

- One component per file.
- File name = component name in kebab-case: `post-card-grid.tsx` exports
  `PostCardGrid`.
- Co-located test: `post-card-grid.test.tsx`.
- Co-located stories (stretch): `post-card-grid.stories.tsx`.

---

## 7. Env access (typed env module)

```typescript
// src/lib/config/env.ts
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  TOKEN_ENCRYPTION_KEY: z.string().base64().refine(
    (s) => Buffer.from(s, 'base64').length === 32,
    'TOKEN_ENCRYPTION_KEY must be 32 bytes after base64 decode'
  ),
  NEXTAUTH_SECRET: z.string().min(32),
  NEXTAUTH_URL: z.string().url(),
  PUBLIC_APP_URL: z.string().url(),
  REDDIT_CLIENT_ID: z.string().min(1),
  REDDIT_CLIENT_SECRET: z.string().min(1),
  REDDIT_REDIRECT_URI: z.string().url(),
  EMAIL_FROM: z.string().email(),
  EMAIL_API_KEY: z.string().min(1),
  // Optional (Tier B)
  TWITTER_CLIENT_ID: z.string().optional(),
  TWITTER_CLIENT_SECRET: z.string().optional(),
  TWITTER_REDIRECT_URI: z.string().url().optional(),
  LINKEDIN_CLIENT_ID: z.string().optional(),
  LINKEDIN_CLIENT_SECRET: z.string().optional(),
  LINKEDIN_REDIRECT_URI: z.string().url().optional(),
  X_MONTHLY_POST_BUDGET: z.coerce.number().int().positive().default(450),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  SENTRY_DSN: z.string().url().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
```

### Usage

```typescript
// Right:
import { env } from '@/lib/config/env';
const redisUrl = env.REDIS_URL;

// WRONG (anywhere):
const redisUrl = process.env.REDIS_URL;  // not validated, not typed
```

### ESLint rule (enforce)

```javascript
// eslint.config.mjs
{
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: "MemberExpression[object.name='process'][property.name='env']",
        message: "Use env from '@/lib/config/env' instead of process.env directly.",
      },
    ],
  },
}
```

### Client vs server

- `src/lib/config/env.ts` is server-only (it reads `process.env` which
  is server-side).
- For client-side env (e.g., `NEXT_PUBLIC_*`), use `z.string().min(1)`
  in a separate `src/lib/config/public-env.ts`. MVP has no
  `NEXT_PUBLIC_*` vars.

---

## 8. Commits (Conventional Commits)

### Format

```
<type>(<scope>): <subject>

<optional body>

<optional footer(s)>
```

### Types

- `feat`: new feature
- `fix`: bug fix
- `test`: test addition or fix
- `docs`: doc change
- `chore`: tooling, deps, refactor without behavior change
- `perf`: performance improvement
- `refactor`: code change that neither fixes a bug nor adds a feature

### Scope

- Ticket ID: `feat(T-07): add token vault service` (preferred for
  ticket work)
- FR ID: `feat(FR-011): add reddit formatter` (when ticket maps 1:1
  to FR)
- Component: `feat(connections): add disconnect confirm dialog`

### Subject

- Imperative, present tense: "add", "fix", "update" (not "added",
  "fixes").
- Lowercase, no period.
- Max 72 chars.

### Examples

```
feat(T-01): scaffold next.js + tailwind + prisma
fix(T-09): handle reddit oauth state cookie expiry edge case
test(T-13): add golden files for discord formatter
docs: update PROGRESS.md with week 1 status
chore: bump prisma to 5.10.0
```

### Pre-commit hook (Husky)

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

npm run lint
npm run typecheck
```

(`test` runs in CI, not pre-commit — too slow for the dev loop.)

---

## 9. Code review checklist (per PR)

Reviewer verifies:

- [ ] No `any` introduced (search for `: any` in diff)
- [ ] No non-null `!` introduced outside tests
- [ ] All new inputs Zod-validated
- [ ] All new queries owner-scoped (or N/A — explain)
- [ ] No credentials in new logs / responses
- [ ] No `process.env` accessed directly (use `env` from config)
- [ ] No new dependency added without approval (check `package.json`
      diff)
- [ ] New components pass `axe-core` (if UI)
- [ ] Tests cover new logic branches incl. error paths
- [ ] `docs/13-PROGRESS.md` updated
- [ ] Commit message follows Conventional Commits with ticket ID
- [ ] Definition of Done boxes all checked (CLAUDE.md §4)

If any unchecked, request changes.

---

## 10. Per-PR security checklist (mandatory — see `07-SECURITY-ACCESS.md` §7)

```
- [ ] No new `any` introduced
- [ ] All new inputs Zod-validated
- [ ] All new queries owner-scoped (or N/A — explain)
- [ ] No credentials in new logs / responses
- [ ] New components pass `axe-core` (if UI)
- [ ] Tests cover new logic branches incl. error paths
- [ ] Dependency change (if any): approved in PR description
- [ ] No `process.env` direct access (use `env` module)
- [ ] No raw DB / platform errors leaked to client (use error mapper)
```

PR is NOT merged until every box is checked.

---

## 11. Examples (do / don't)

### 11.1 Service example

```typescript
// src/server/services/postcards.ts
import { prisma } from '@/server/db';
import { postCardCreateSchema, type PostCardCreate } from '@/lib/validation/schemas';
import type { Result } from '@/types/results';
import type { PostCardId, UserId } from '@/types/branded';

export async function createPostCard(
  userId: UserId,
  input: PostCardCreate,
): Promise<Result<PostCard, { code: 'VALIDATION_ERROR'; fieldErrors: Record<string, string[]> }>> {
  // (Zod already ran in route handler, but defensive parse here too)
  const parsed = postCardCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION_ERROR',
      fieldErrors: parsed.error.flatten().fieldErrors } };
  }

  const postCard = await prisma.postCard.create({
    data: { ...parsed.data, userId },
  });

  return { ok: true, data: postCard };
}
```

### 11.2 Route handler example

```typescript
// src/app/api/postcards/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { postCardCreateSchema } from '@/lib/validation/schemas';
import { createPostCard } from '@/server/services/postcards';
import { mapServiceError } from '@/lib/errors/mapper';
import { audit } from '@/server/services/audit';
import { env } from '@/lib/config/env';
import type { UserId } from '@/types/branded';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED',
      message: 'Log in first' } }, { status: 401 });
  }

  const body = await req.json();
  const parsed = postCardCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      fieldErrors: parsed.error.flatten().fieldErrors } },
      { status: 400 });
  }

  const userId = session.user.id as UserId;
  const result = await createPostCard(userId, parsed.data);
  if (!result.ok) {
    const { status, body } = mapServiceError(result.error);
    return NextResponse.json(body, { status });
  }

  return NextResponse.json(result.data, { status: 201 });
}
```

### 11.3 Pure formatter example

```typescript
// src/lib/formatters/reddit.ts
import type { PostCard, Profile } from '@/types/models';
import type { FormattedPayload } from './types';

interface RedditOptions { subreddit: string; }

export function formatReddit(
  postCard: PostCard,
  profile: Profile | null,
  options: RedditOptions,
): FormattedPayload {
  // Pure: no Date.now, no Math.random, no async.
  const title = postCard.title.slice(0, 300);  // hard cap
  const body = postCard.description;  // unlimited

  return {
    platform: 'REDDIT',
    title,
    body,
    subreddit: options.subreddit,
  };
}
```

### 11.4 Worker example (simplified)

```typescript
// src/workers/publish-worker.ts
import { Worker } from 'bullmq';
import { prisma } from '@/server/db';
import { tokenVault } from '@/lib/vault/token-vault';
import { formatFor } from '@/lib/formatters';
import { getAdapter } from '@/lib/platforms/registry';
import { audit } from '@/server/services/audit';
import { env } from '@/lib/config/env';
import type { Connection, PostTarget, PostCard, Profile } from '@/types/models';

const worker = new Worker('publish', async (job) => {
  const { targetId } = job.data;

  const target = await prisma.postTarget.findUnique({
    where: { id: targetId },
    include: { post: { include: { postCard: true } },
               connection: true },
  });
  if (!target) return;  // deleted
  if (target.status !== 'QUEUED') return;  // idempotent (already processed)

  await prisma.postTarget.update({ where: { id: targetId },
    data: { status: 'PUBLISHING' } });

  if (!target.connection) {
    return prisma.postTarget.update({ where: { id: targetId },
      data: { status: 'SKIPPED',
        error: 'Connection removed before publish',
        errorClass: 'AUTH' } });
  }

  // Decrypt in-memory only
  const creds = tokenVault.decrypt(target.connection.credentialsCipher);

  // Format (pure)
  const profile = await prisma.profile.findUnique({
    where: { userId: target.post.userId },
  });
  const formatted = formatFor(target.platform, {
    postCard: target.post.postCard,
    profile,
    options: target.options as Record<string, unknown>,
  });

  // Adapter
  const adapter = getAdapter(target.platform);
  const result = await adapter.publish({ creds, formatted,
    options: target.options as PublishOptions });

  if (result.ok) {
    await prisma.postTarget.update({ where: { id: targetId },
      data: { status: 'SUCCESS',
        platformPostUrl: result.data.platformPostUrl,
        platformPostId: result.data.platformPostId,
        publishedAt: new Date() } });
    await prisma.connection.update({ where: { id: target.connectionId },
      data: { lastUsedAt: new Date() } });
  } else {
    if (result.error.class === 'AUTH') {
      await prisma.connection.update({ where: { id: target.connectionId },
        data: { status: 'REVOKED' } });
    }
    await prisma.postTarget.update({ where: { id: targetId },
      data: { status: 'FAILED',
        error: result.error.message,
        errorClass: result.error.class } });
  }
}, { connection: { url: env.REDIS_URL } });

worker.on('completed', (job) => logger.info({ jobId: job.id }, 'completed'));
worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'failed'));
```

---

> End of coding standards. Next: `09-TESTING-STRATEGY.md` — what to
> test, how, in which layer, with what factories.
