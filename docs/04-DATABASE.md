# NetAmplify — Database Schema (Prisma — source of truth)

> Status: LOCKED for MVP. The Prisma schema in `prisma/schema.prisma` is
> the **single source of truth** for data. This doc explains the schema,
> the 5 mandatory data rules, and the migration policy.
>
> Companion docs: `02-SRS.md` (FRs that drive the schema),
> `05-API-SPEC.md` (what queries run), `07-SECURITY-ACCESS.md` §3
> (owner-scoping rules).

---

## 1. Schema (`prisma/schema.prisma`)

```prisma
// NetAmplify — Prisma schema v1.0
// Source of truth for data. Migrations only via `prisma migrate dev --name <desc>`.

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

enum Platform {
  REDDIT
  DISCORD
  DEVTO
  TELEGRAM
  BLUESKY
  HASHNODE
  TWITTER
  LINKEDIN
}

enum ConnectionType {
  OAUTH
  API_KEY
  WEBHOOK
  BOT_TOKEN
  APP_PASSWORD
}

enum ConnectionStatus {
  ACTIVE
  REVOKED
  ERROR
}

enum PostTargetStatus {
  QUEUED
  PUBLISHING
  SUCCESS
  FAILED
  SKIPPED
}

// ---------------------------------------------------------------------------
// User + Profile
// ---------------------------------------------------------------------------

model User {
  id            String        @id @default(cuid())
  email         String        @unique
  passwordHash  String
  name          String
  emailVerified DateTime?     // set when reset token confirms (optional MVP)
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt

  profile      Profile?
  postCards    PostCard[]
  connections  Connection[]
  posts        Post[]
  auditLogs    AuditLog[]

  @@index([email])
}

model Profile {
  id             String   @id @default(cuid())
  userId         String   @unique
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  headline       String?  @db.VarChar(140)
  college        String?  @db.VarChar(100)
  graduationYear Int?
  githubUrl      String?  @db.VarChar(500)
  portfolioUrl    String?  @db.VarChar(500)

  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([userId])
}

// ---------------------------------------------------------------------------
// Post Card (the "post once" canonical content)
// ---------------------------------------------------------------------------

model PostCard {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  title       String   @db.VarChar(120)
  summary     String   @db.VarChar(200)
  description String   @db.Text          // markdown, ≤5000 enforced by Zod (not DB)
  techStack   String[]                   // 1–10 enforced by Zod
  repoUrl     String?  @db.VarChar(500)
  liveUrl     String?  @db.VarChar(500)
  imageUrl    String?  @db.VarChar(500)

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  posts       Post[]

  @@index([userId, createdAt])
}

// ---------------------------------------------------------------------------
// Connection (per-user, per-platform credential)
// ---------------------------------------------------------------------------

model Connection {
  id                String           @id @default(cuid())
  userId            String
  user              User             @relation(fields: [userId], references: [id], onDelete: Cascade)

  platform          Platform
  type              ConnectionType
  platformAccountId String           @db.VarChar(200)  // stable id when available
  platformUsername  String?          @db.VarChar(200)  // display handle
  credentialsCipher String           @db.Text           // AES-256-GCM JSON blob — ONLY ciphertext
  scopes            String[]                            // [] for non-OAuth
  status            ConnectionStatus @default(ACTIVE)
  lastUsedAt        DateTime?
  lastValidatedAt   DateTime?
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt

  postTargets       PostTarget[]

  @@unique([userId, platform])
  @@index([userId, platform])
  @@index([status])
}

// ---------------------------------------------------------------------------
// Post + PostTarget (the "amplify" event)
// ---------------------------------------------------------------------------

model Post {
  id          String       @id @default(cuid())
  userId      String
  user        User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  postCardId  String
  postCard    PostCard     @relation(fields: [postCardId], references: [id], onDelete: Cascade)

  requestId   String?      @unique @db.VarChar(64)  // client idempotency key (UUID v4)
  targets     PostTarget[]

  createdAt   DateTime     @default(now())

  @@index([userId, createdAt])
  @@index([postCardId])
}

model PostTarget {
  id              String           @id @default(cuid())
  postId          String
  post            Post             @relation(fields: [postId], references: [id], onDelete: Cascade)

  platform        Platform
  connectionId    String?          // null if disconnected before execution
  connection      Connection?      @relation(fields: [connectionId], references: [id], onDelete: SetNull)

  status          PostTargetStatus @default(QUEUED)
  options         Json?            // e.g., { subreddit: "sideproject" }
  platformPostUrl String?         @db.VarChar(500)
  platformPostId  String?          @db.VarChar(200)

  error           String?          @db.Text          // sanitized platform message
  errorClass      String?          @db.VarChar(20)   // AUTH|RATE|VALIDATION|NETWORK|QUOTA
  attempts        Int              @default(0)

  publishedAt     DateTime?
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  @@index([postId])
  @@index([status])
  @@index([platform, status])
}

// ---------------------------------------------------------------------------
// QuotaUsage (X monthly budget guard — FR-018)
// ---------------------------------------------------------------------------

model QuotaUsage {
  id        String   @id @default(cuid())
  platform  Platform
  yearMonth String   @db.VarChar(7)  // "2025-01"
  used      Int      @default(0)

  @@unique([platform, yearMonth])
}

// ---------------------------------------------------------------------------
// AuditLog (security-relevant actions — FR-017)
// ---------------------------------------------------------------------------

model AuditLog {
  id        String   @id @default(cuid())
  userId    String?  // nullable for LOGIN_FAIL with unknown email
  user      User?    @relation(fields: [userId], references: [id], onDelete: NoAction)
  action    String   @db.VarChar(40)  // LOGIN|LOGIN_FAIL|CONNECT|DISCONNECT|PUBLISH|RETRY|TOKEN_FAIL|ACCOUNT_DELETE
  platform  String?  @db.VarChar(20)  // nullable
  ip        String?  @db.VarChar(45)
  userAgent String?  @db.VarChar(500)
  metadata  Json?
  createdAt DateTime @default(now())

  @@index([userId, createdAt])
  @@index([action, createdAt])
}
```

---

## 2. Data Rules (mandatory — review checklist + tests enforce)

### Rule 1 — `credentialsCipher` is the ONLY credential column; ciphertext only

Every credential shape (OAuth tokens, API keys, webhook URLs, bot tokens,
app passwords) is stored as a single AES-256-GCM-encrypted JSON blob in
`Connection.credentialsCipher`. No other column on any table may store
credential data.

**Enforcement:**
- Code review checklist item: "Does this PR add or read any column with
  credential-like content that is NOT `credentialsCipher`? If yes,
  reject."
- CI scanner test (`scripts/scan-db-dump.sh`): take a snapshot of the
  test DB, grep for token patterns (`sk-`, `xoxb-`, `did:plc:`,
  `https://discord.com/api/webhooks/`, telegram bot token shape,
  reddit refresh token shape, Bluesky accessJwt shape) → zero matches.

### Rule 2 — Decrypt happens ONLY inside TokenVault consumers

Plaintext credentials exist only in-memory inside:
- BullMQ workers (`src/workers/publish-worker.ts`) during the publish
  job
- Connection validation services (`src/server/services/connections.ts`)
  during the connect flow

Services MUST NOT return decrypted values upward. The boundary:
- `src/server/services/connections.ts` can call `TokenVault.decrypt`
  inside `connectDevto()` etc. for validation, but the return type is
  only metadata (`{ username }`, `{ channelName }`), never the
  decrypted credential.
- `src/server/services/publish.ts` does NOT decrypt; it passes the
  `connectionId` to the BullMQ job, and the worker decrypts in-process.

**Enforcement:**
- TypeScript: `TokenVault.decrypt` returns a branded type
  `DecryptedCredential` that can only be used inside
  `src/workers/*.ts` and `src/server/services/connections.ts` (via
  `declare module` scoping trick).
- Integration test: response scanner asserts no credential patterns
  in any API response.

### Rule 3 — Every query includes `userId` (owner scope)

Every Prisma read/write of `Profile`, `PostCard`, `Connection`, `Post`,
`PostTarget`, `AuditLog` (when reading own logs) MUST include
`where: { userId: <session.user.id>, ... }`. No unscoped reads.

The `:id` in a URL locates the row; ownership comes from the session.
Pattern:

```typescript
// WRONG:
const card = await prisma.postCard.findUnique({ where: { id } });

// RIGHT:
const card = await prisma.postCard.findUnique({
  where: { id, userId: session.user.id },
});
if (!card) return notFound(); // 404, not 403 — never leak existence
```

**Enforcement:**
- Code review checklist: "Every findUnique / findFirst / findMany /
  update / delete on user-owned models includes `userId`?"
- Per-resource integration test: user B calls user A's endpoint → 404
  (or 403 if explicitly authorized). 404 is preferred to avoid leaking
  existence.
- ESLint custom rule (stretch goal): forbid `prisma.postCard.find*`
  without `userId` in `where`. (If this rule proves hard to write in
  MVP, fall back to review checklist.)

### Rule 4 — Account deletion = single User delete; cascades wipe children

`DELETE /api/account`:
1. Audit `ACCOUNT_DELETE` row written FIRST (with userId).
2. `prisma.user.delete({ where: { id: userId } })` → cascades:
   - `Profile` (onDelete: Cascade) → row deleted
   - `PostCard` (Cascade) → rows deleted → cascades to `Post` (Cascade)
     → cascades to `PostTarget` (Cascade)
   - `Connection` (Cascade) → rows deleted (ciphertext gone)
   - `Post` (Cascade) → rows deleted → cascades to `PostTarget`
   - `AuditLog` (NoAction) → rows KEPT (with `userId` for forensics;
     the userId no longer points to a User, but the log entry remains
     with the userId string for traceability)
3. Test asserts zero residual rows in `User`, `Profile`, `PostCard`,
   `Connection`, `Post`, `PostTarget` for that userId; `AuditLog`
   rows for that userId remain (including the `ACCOUNT_DELETE` entry).

### Rule 5 — Migrations only via `prisma migrate dev --name <desc>`

No `prisma db push` in dev (loses migration history). No manual SQL.
Every schema change:
1. Edit `prisma/schema.prisma`.
2. `npx prisma migrate dev --name <descriptive-name>` → generates a
   migration in `prisma/migrations/<timestamp>_<name>/`.
3. Commit the migration alongside the schema change.
4. CI runs `prisma migrate deploy` against the test DB before tests.

Migration naming convention:
- `add_<table>_table`
- `add_<column>_to_<table>`
- `rename_<old>_to_<new>_on_<table>`
- `drop_<column>_from_<table>` (rare; coordinate with code)

---

## 3. Field-level rules (Zod-enforced; DB types are the backstop)

| Table | Field | Type | Zod rule | DB type |
|---|---|---|---|---|
| `User.email` | string | `z.string().email()` | `String @unique` |
| `User.passwordHash` | string | bcrypt output (≥60 chars) | `String` |
| `User.name` | string | `z.string().min(1).max(100)` | `String` |
| `Profile.headline` | string? | `z.string().max(140).optional()` | `String? @db.VarChar(140)` |
| `Profile.college` | string? | `z.string().max(100).optional()` | `String? @db.VarChar(100)` |
| `Profile.graduationYear` | int? | `z.number().int().min(2015).max(2035).optional()` | `Int?` |
| `Profile.githubUrl` | string? | `z.string().url().startsWith('https://github.com/').optional()` | `String? @db.VarChar(500)` |
| `Profile.portfolioUrl` | string? | `z.string().url().optional()` | `String? @db.VarChar(500)` |
| `PostCard.title` | string | `z.string().min(1).max(120)` | `String @db.VarChar(120)` |
| `PostCard.summary` | string | `z.string().min(1).max(200)` | `String @db.VarChar(200)` |
| `PostCard.description` | string | `z.string().max(5000)` | `String @db.Text` (unlimited DB; Zod caps) |
| `PostCard.techStack` | string[] | `z.array(z.string().max(24)).min(1).max(10)` | `String[]` |
| `PostCard.repoUrl` | string? | `z.string().url().optional()` | `String? @db.VarChar(500)` |
| `PostCard.liveUrl` | string? | `z.string().url().optional()` | `String? @db.VarChar(500)` |
| `PostCard.imageUrl` | string? | `z.string().url().optional()` | `String? @db.VarChar(500)` |
| `Connection.platformAccountId` | string | non-empty | `String @db.VarChar(200)` |
| `Connection.platformUsername` | string? | optional | `String? @db.VarChar(200)` |
| `Connection.credentialsCipher` | string | AES-256-GCM ciphertext | `String @db.Text` |
| `Connection.scopes` | string[] | OAuth only; `[]` for others | `String[]` |
| `Post.requestId` | string? | UUID v4 (client-generated) | `String? @unique @db.VarChar(64)` |
| `PostTarget.options` | Json? | per-platform Zod (e.g., Reddit: `{ subreddit: string }`) | `Json?` |
| `PostTarget.errorClass` | string? | enum: AUTH/RATE/VALIDATION/NETWORK/QUOTA | `String? @db.VarChar(20)` |
| `PostTarget.attempts` | int | `>= 0`, capped at 3 by service | `Int @default(0)` |
| `QuotaUsage.yearMonth` | string | `YYYY-MM` format | `String @db.VarChar(7)` |
| `AuditLog.action` | string | enum (see FR-017) | `String @db.VarChar(40)` |

---

## 4. Index strategy (why each index exists)

| Table | Index | Used by |
|---|---|---|
| `User` | `email` (unique) | login lookup |
| `Profile` | `userId` (unique) | settings page, formatters |
| `PostCard` | `[userId, createdAt]` | dashboard list (newest first per user) |
| `Connection` | `[userId, platform]` (unique) | connect checklist lookup, publish validation |
| `Connection` | `status` | admin / monitor queries (filter REVOKED) |
| `Post` | `[userId, createdAt]` | history list per user |
| `Post` | `postCardId` | cascade + "posts from this card" query |
| `PostTarget` | `postId` | status board poll |
| `PostTarget` | `status` | monitor queries (find stuck PUBLISHING) |
| `PostTarget` | `[platform, status]` | per-platform stats |
| `QuotaUsage` | `[platform, yearMonth]` (unique) | quota check |
| `AuditLog` | `[userId, createdAt]` | user audit history |
| `AuditLog` | `[action, createdAt]` | security forensics (e.g., all PUBLISH in a window) |

---

## 5. Relationships diagram (text)

```
User 1:1 Profile
User 1:N PostCard
User 1:N Connection
User 1:N Post
User 1:N AuditLog (NoAction on delete — rows kept)

PostCard 1:N Post
Post 1:N PostTarget
Connection 1:N PostTarget (SetNull on delete — connectionId becomes null,
                            worker sees null → SKIPPED "connection removed")
```

---

## 6. Migration policy

### Dev

- `npx prisma migrate dev --name <descriptive-name>` — generates + applies.
- Commit the new `prisma/migrations/<timestamp>_<name>/` folder.

### Test (CI)

- `npx prisma migrate deploy` — applies pending migrations to test DB
  before tests run.
- Test DB is reset between test suites via `prisma migrate reset --force`
  (or a TRUNCATE script for speed).

### Prod

- `npx prisma migrate deploy` — applies pending migrations in order.
- NEVER `prisma db push` in prod.
- Destructive migrations (drop column, rename) require a 2-PR dance:
  1. PR1: deploy code that no longer reads the old column (but DB still
     has it).
  2. PR2: deploy the migration that drops the old column.

---

## 7. Seed data (`prisma/seed.ts`)

For demo (T-22) and local dev. NOT for prod.

- 1 demo user (`demo@netamplify.dev`, password `demo-pass-123`).
- Full Profile.
- 6 Tier A Connections (ciphertext = encrypted mock credentials).
- 3 Post Cards (one about NetAmplify itself — meta demo card).
- 5 Posts with mixed statuses (3 all-SUCCESS, 1 partial-failure, 1
  with a FAILED target ready for retry demo).

Seed runs via `npm run db:seed` (which calls `tsx prisma/seed.ts`).
CI does NOT seed; E2E tests use `tests/factories.ts` for deterministic
data per test.

---

## 8. Test database setup

`docker-compose.test.yml` runs separate `postgres-test` and
`redis-test` containers on different ports (5433, 6380) to avoid
collisions with dev.

`DATABASE_URL=postgresql://test:test@localhost:5433/netamplify_test`
`REDIS_URL=redis://localhost:6380`

Vitest setup (`tests/setup.ts`):
1. `prisma migrate deploy` against test DB.
2. Before each integration test file: TRUNCATE all tables (fast).
3. After each test file: cleanup (no state leaks across files).

---

## 9. Backup / restore (post-MVP, but design leaves room)

- `pg_dump` nightly (cron) of prod DB.
- Encrypted at rest (Postgres TDE or volume encryption).
- Restore test: monthly drill (post-MVP).
- For MVP: Neon / Supabase managed Postgres has automated backups —
  rely on that.

---

> End of database doc. Next: `05-API-SPEC.md` — every endpoint with
> request/response examples, error codes, and ownership assertions.
