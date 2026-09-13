# NetAmplify — Technical Architecture (v1.0)

> Status: LOCKED for MVP. Companion docs: `02-SRS.md` (requirements),
> `04-DATABASE.md` (schema), `05-API-SPEC.md` (endpoints),
> `07-SECURITY-ACCESS.md` (threat model), `16-OBSERVABILITY.md`
> (logs/metrics).
>
> This doc is the **single source of truth** for system design, data
> flows, adapter contracts, environment variables, and platform
> configuration (char limits, retries, quotas).

---

## 1. Stack + Reasoning

| Layer | Choice | Why this, not the alternative |
|---|---|---|
| UI + API | **Next.js 14 App Router + TS strict** | One deployable, SSR pages, route handlers as API. Fastest path for a 4-week MVP. Alternatives (Remix, separate Next+Express) add complexity without MVP benefit. |
| Styling | **Tailwind + shadcn/ui** | Consistent components without a designer. shadcn/ui = "you own the components" — no version-lock to a lib. Alternatives (MUI, Chakra) add bundle weight and visual opinionation. |
| DB | **PostgreSQL + Prisma** | Relational fits our data (User → PostCard → Post → PostTarget). Migrations from day 1; type-safe client. Alternatives (Supabase, raw SQL) add vendor lock-in or lose type safety. |
| Queue | **Redis + BullMQ** | Publishing is async per-platform work with retries + backoff. BullMQ is the modern, TS-friendly Redis queue. Alternatives (BullMQ predecessor `bull` is in maintenance mode; SQS adds AWS). |
| Auth | **NextAuth (credentials)** | Sessions + CSRF handled. Credentials provider only for MVP — Google OAuth cut (see `07-SECURITY-ACCESS.md` §1). |
| Validation | **Zod** | Shared client+server schemas; infer TS types from schemas. Single source of truth. |
| Tests | **Vitest + Playwright** | Vitest for unit/integration (fast, Jest-compatible API). Playwright for E2E (cross-browser, modern). |
| Markdown | **react-markdown + remark-gfm** | Sanitized rendering (no raw HTML). GFM for tables/strikethrough. |
| Grapheme counting | **Intl.Segmenter** (Node 20 native) | X / Bluesky truncation must be grapheme-correct (emoji + ZWJ sequences). No extra dependency. |
| HTTP client | **native fetch** (Node 20 has global fetch) | No `axios` needed; reduces dependency surface. |
| Uploads | **local disk (dev) + Cloudinary interface** | Interface is the seam; swap to Cloudinary in prod is config-only. No vendor lock-in MVP. |
| Email | **Resend** (transactional only) | Only for password-reset emails. Free tier covers MVP. |

---

## 2. System Diagram

```
                         Browser (Next.js client)
                                  │
                                  ▼
                  ┌───────────────────────────────────┐
                  │   Next.js 14 App Router (Node 20)  │
                  │                                   │
                  │   (marketing)  page.tsx            │
                  │   (auth)       login/signup/reset  │
                  │   (dashboard)  shell + screens    │
                  │   /api/*       route handlers      │
                  └───────────────────────────────────┘
                       │     │     │     │     │
            ┌──────────┘     │     │     │     └──────────┐
            ▼                ▼     │     ▼                ▼
       NextAuth.js      Zod       │  TokenVault      Format Engine
       (sessions,       (input)   │  (AES-256-GCM)   (pure fns)
        CSRF)                     │
            │                     │
            ▼                     │
        Prisma Client ────────────┼───► PostgreSQL 16
            │                     │     (User, Profile, PostCard,
            │                     │      Connection, Post,
            │                     │      PostTarget, QuotaUsage,
            │                     │      AuditLog)
            │                     │
            │                     ▼
            │                  Redis 7
            │                  (BullMQ queue + rate-limit
            │                   counters + OAuth state
            │                   cookies alternative)
            │
            ▼
        BullMQ Producers
        (publish service
         enqueues per-target
         jobs)
            │
            ▼
        BullMQ Workers
        (publish-worker.ts,
         same process as Next.js,
         separate module)
            │
            ├──► TokenVault.decrypt (in-memory only)
            ├──► Format Engine (pure)
            └──► Platform Adapter
                  │
                  ├──► Reddit API
                  ├──► Discord API (webhook)
                  ├──► Dev.to API
                  ├──► Telegram Bot API
                  ├──► Bluesky (bsky.app)
                  ├──► Hashnode API
                  ├──► X API (Tier B)
                  └──► LinkedIn API (Tier B)
                  │
                  ▼
              update PostTarget status
              (SUCCESS+url | FAILED+errorClass |
               SKIPPED | retried)
                  │
                  ▼
              UI polls GET /api/posts/:id
              every 3s until all terminal
```

---

## 3. Flows

### Flow A — Amplify (the money flow)

```
User clicks "🚀 Amplify to N platforms"
            │
            ▼
POST /api/postcards/:id/publish
{ platforms: [...], options, requestId }
            │
            ▼
[1] Auth guard: session present? → 401 if not
[2] Ownership: postCard.userId === session.user.id? → 403 if not
[3] For each platform in request:
    - Connection ACTIVE for (userId, platform)?
      → if not, add to invalidPlatforms
    - (X only) QuotaUsage under budget?
      → if not, mark this target SKIPPED at creation
[4] If invalidPlatforms non-empty → 400 with list
[5] requestId already exists? → 409 DUPLICATE_REQUEST
[6] Transaction:
    - INSERT Post (id, userId, postCardId, requestId)
    - INSERT PostTarget per platform (QUEUED, options, connectionId, attempts=0)
    - (X only) UPSERT QuotaUsage incrementing used
[7] For each target: BullMQ add('publish', { targetId })
[8] Audit PUBLISH (one row per Post)
[9] Return 201 { post: { id, targets: [...] } }
            │
            ▼
UI polls GET /api/posts/:id every 3s
            │
            ▼
[BullMQ worker] picks up job:
[1] Load PostTarget by id
[2] If status !== QUEUED → no-op (idempotent)
[3] Set status = PUBLISHING
[4] Load Connection by connectionId
    - if null → SKIPPED, "connection removed"
[5] Decrypt credentialsCipher in-memory (TokenVault)
[6] Format payload via Format Engine (pure)
[7] adapter.publish(creds, formatted, options)
[8] On SUCCESS:
    - Set status = SUCCESS, platformPostUrl, platformPostId
    - Update Connection.lastUsedAt
[9] On AUTH failure:
    - Set Connection.status = REVOKED
    - Set target status = FAILED, errorClass = AUTH,
      error = "Reconnect this platform"
[10] On RATE failure:
    - attempts++ ; if attempts < 3 → re-enqueue with backoff (10/60/300s)
    - else → FAILED, errorClass = RATE, "Platform rate-limiting — try later"
[11] On VALIDATION failure:
    - FAILED, errorClass = VALIDATION, error = platform's message verbatim
[12] On NETWORK/5xx failure:
    - attempts++ ; if attempts < 3 → re-enqueue with backoff
    - else → FAILED, errorClass = NETWORK
[13] On QUOTA: (shouldn't happen — quota checked at publish time, but
    defensive) → SKIPPED, errorClass = QUOTA
[14] Audit per outcome (one row per terminal transition)
            │
            ▼
UI sees all terminal → stops polling → shows final status board
```

### Flow B — OAuth connect (Reddit; X / LinkedIn if configured)

```
User clicks "Connect Reddit" on checklist
            │
            ▼
GET /api/oauth/reddit/start
            │
            ▼
[1] Generate code_verifier (random 32 bytes, base64url)
[2] Generate code_challenge = SHA256(code_verifier), base64url
[3] Generate state (random 32 bytes, base64url)
[4] Set signed httpOnly cookie:
    oauth_state = { state, verifier, returnTo, expiresAt }
    - httpOnly, sameSite=lax, secure (prod), maxAge=10min, signed
[5] 302 to https://reddit.com/api/v1/authorize?
    client_id=...&response_type=code&state=...&
    redirect_uri=...&duration=permanent&scope=identity,submit&
    code_challenge=...&code_challenge_method=S256
            │
            ▼
Reddit login + consent page (user interacts)
            │
            ▼
302 to GET /api/oauth/reddit/callback?code=...&state=...
            │
            ▼
[1] Read oauth_state cookie; if missing/expired → 400 BAD_STATE
[2] If state !== cookie.state → 400 BAD_STATE, audit TOKEN_FAIL
[3] Delete cookie (single-use)
[4] POST https://reddit.com/api/v1/access_token with:
    grant_type=authorization_code, code, redirect_uri,
    client_id, client_secret, code_verifier
[5] If 4xx → 502 OAUTH_EXCHANGE_FAILED
[6] tokens = { access_token, refresh_token, expires_in, scope }
[7] GET https://oauth.reddit.com/api/v1/me
    with Authorization: Bearer <access_token>
    → identity = { id, name, subreddit.title }
[8] credentialsCipher = TokenVault.encrypt(JSON.stringify({
        access_token, refresh_token, expires_at, scope
    }))
[9] Upsert Connection:
    userId, platform=REDDIT, type=OAUTH,
    platformAccountId=identity.id,
    platformUsername=identity.name,
    credentialsCipher, scopes=['identity','submit'],
    status=ACTIVE, lastValidatedAt=now
[10] Audit CONNECT { platform, username }
[11] 302 to /dashboard/connections?connected=reddit
            │
            ▼
UI shows "Connected as @handle" + Disconnect button
```

### Flow C — Simple credential connect (Dev.to / Hashnode / Discord / Telegram / Bluesky)

```
User pastes credential on checklist, clicks "Connect"
            │
            ▼
POST /api/connections/<platform>
{ ...credential fields }
            │
            ▼
[1] Auth guard
[2] Zod validate input (per-platform schema)
[3] adapter.validateCredentials(input):
    - Dev.to: GET https://dev.to/api/me with api-key header
    - Hashnode: GraphQL POST https://gql.hashnode.com/ with query { me { username } }
    - Discord: GET <webhookUrl> → returns channel metadata
    - Telegram: GET getMe + getChat on botToken+channel
    - Bluesky: POST createSession with handle+appPassword
[4] On failure → 400 with platform's own error verbatim
[5] On network error → 502
[6] On success:
    - credentialsCipher = TokenVault.encrypt(JSON.stringify(credential))
    - Upsert Connection
    - Audit CONNECT
    - Return 201 { username | channelName | did }
            │
            ▼
UI shows "Connected as @handle" + Disconnect button
```

### Flow D — Disconnect

```
User clicks "Disconnect" → confirm dialog
            │
            ▼
DELETE /api/connections/<platform>
            │
            ▼
[1] Auth guard
[2] Find Connection by (userId, platform)
    - if not found → 404
[3] Hard-delete Connection row (ciphertext gone)
[4] Mark any in-flight PostTargets with that connectionId as SKIPPED,
    "connection removed"
[5] Audit DISCONNECT { platform }
[6] Return 204
            │
            ▼
UI updates checklist: card back to "Not connected"
```

### Flow E — Retry

```
User clicks "Retry" on a FAILED target
            │
            ▼
POST /api/posts/:id/targets/:targetId/retry
            │
            ▼
[1] Auth guard
[2] Load target; if not FAILED → 409 NOT_FAILED
[3] If attempts >= 3 → 409 MAX_RETRIES
[4] If errorClass === AUTH → 409 with "Reconnect this platform first"
[5] Increment attempts
[6] Re-enqueue BullMQ job for that target
[7] Audit RETRY { postId, targetId, attemptNumber }
[8] Return 200
            │
            ▼
Worker picks up job → same as Flow A steps [worker]
```

---

## 4. Adapter Contracts

### OAuth-capable adapter (Reddit, X, LinkedIn)

```typescript
// src/lib/platforms/types.ts
interface OAuthAdapter {
  readonly platform: Platform;
  readonly kind: 'OAUTH';
  readonly scopes: string[];
  /** Required env vars for this adapter to be configured. */
  readonly requiredEnvVars: readonly string[];
  /** True iff all required env vars are set (drives "Setup pending" UI). */
  configured(): boolean;
  /** Build the authorize URL with PKCE challenge + state. */
  getAuthUrl(opts: { codeChallenge: string; state: string; redirectUri: string }): string;
  /** Exchange the code + verifier for tokens. */
  exchangeCode(opts: { code: string; codeVerifier: string; redirectUri: string }):
    Promise<Result<TokenSet, OAuthExchangeError>>;
  /** Fetch user identity using the tokens. */
  getIdentity(tokens: TokenSet): Promise<Result<PlatformIdentity, OAuthIdentityError>>;
  /** Refresh access token if needed (optional; only Reddit/X have refresh). */
  refresh?(refreshToken: string): Promise<Result<TokenSet, OAuthRefreshError>>;
  /** Publish a formatted payload. */
  publish(opts: { creds: TokenSet; formatted: FormattedPayload; options?: PublishOptions }):
    Promise<Result<PublishSuccess, PublishFailure>>;
}
```

### Simple connector adapter (Dev.to, Hashnode, Discord, Telegram, Bluesky)

```typescript
interface SimpleAdapter {
  readonly platform: Platform;
  readonly kind: 'SIMPLE';
  readonly requiredEnvVars: readonly string[];
  configured(): boolean;
  /** Validate the pasted credential by calling the platform's
      cheap identity endpoint. */
  validateCredentials(input: CredentialInput): Promise<Result<ValidatedCredential, ValidationError>>;
  /** Publish a formatted payload. */
  publish(opts: { creds: ValidatedCredential; formatted: FormattedPayload; options?: PublishOptions }):
    Promise<Result<PublishSuccess, PublishFailure>>;
}
```

### Result types

```typescript
type Result<T, E> = { ok: true; data: T } | { ok: false; error: E };

type PublishSuccess = { platformPostUrl: string; platformPostId: string };
type PublishFailure = {
  class: 'AUTH' | 'RATE' | 'VALIDATION' | 'NETWORK' | 'QUOTA';
  message: string; // platform's own error, sanitized
  retryable: boolean; // false for AUTH, VALIDATION, QUOTA; true for RATE, NETWORK
};
```

### Registry

`src/lib/platforms/registry.ts`:

```typescript
export const PLATFORM_REGISTRY: Record<Platform, OAuthAdapter | SimpleAdapter> = {
  REDDIT: redditAdapter,
  DISCORD: discordAdapter,
  DEVTO: devtoAdapter,
  TELEGRAM: telegramAdapter,
  BLUESKY: blueskyAdapter,
  HASHNODE: hashnodeAdapter,
  TWITTER: twitterAdapter,
  LINKEDIN: linkedinAdapter,
};

export function getAdapter(p: Platform): OAuthAdapter | SimpleAdapter {
  return PLATFORM_REGISTRY[p];
}

export function isConfigured(p: Platform): boolean {
  return PLATFORM_REGISTRY[p].configured();
}

export function isTierA(p: Platform): boolean {
  return ['REDDIT','DISCORD','DEVTO','TELEGRAM','BLUESKY','HASHNODE'].includes(p);
}
```

---

## 5. Folder Structure (exact — agents follow this verbatim)

```
netamplify/
├── CLAUDE.md                           # Agent constitution (read first)
├── docs/                               # This build pack (00-16)
├── prisma/
│   ├── schema.prisma                   # Source of truth for data (04-DATABASE.md)
│   ├── migrations/                     # Generated by prisma migrate dev
│   └── seed.ts                         # Demo user + connections for demo (T-22)
├── public/
│   ├── uploads/                        # Local image storage (dev only)
│   └── icons/                          # Platform icons (simple-icons or custom)
├── scripts/
│   ├── smoke.ts                        # Real-post smoke (manual; never in CI)
│   ├── scan-db-dump.sh                 # CI: grep DB dump for token patterns
│   └── scan-logs.sh                    # CI: grep AuditLog + app logs for tokens
├── src/
│   ├── app/
│   │   ├── (marketing)/page.tsx        # Landing
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   ├── signup/page.tsx
│   │   │   └── reset/page.tsx
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx               # Auth-guarded shell, nav, sidebar
│   │   │   ├── dashboard/page.tsx       # Post cards grid + onboarding strip + stats
│   │   │   ├── connections/page.tsx    # Connect Checklist
│   │   │   ├── postcards/
│   │   │   │   ├── new/page.tsx         # Composer
│   │   │   │   ├── [id]/page.tsx        # View
│   │   │   │   ├── [id]/edit/page.tsx   # Edit composer
│   │   │   │   └── [id]/publish/page.tsx # Publish (core UX)
│   │   │   ├── history/page.tsx
│   │   │   └── settings/page.tsx        # Profile + Security & Connections
│   │   ├── api/
│   │   │   ├── auth/                    # /signup, /reset-request, /reset-confirm, /api/auth/[...nextauth]
│   │   │   ├── profile/route.ts
│   │   │   ├── postcards/
│   │   │   │   ├── route.ts             # GET list, POST create
│   │   │   │   ├── [id]/route.ts        # GET, PATCH, DELETE
│   │   │   │   ├── [id]/preview/route.ts
│   │   │   │   └── [id]/publish/route.ts
│   │   │   ├── connections/
│   │   │   │   ├── route.ts             # GET list
│   │   │   │   ├── [platform]/route.ts   # POST (simple), DELETE
│   │   │   │   ├── devto/route.ts        # (alias; redirects to [platform])
│   │   │   │   └── ...
│   │   │   ├── oauth/
│   │   │   │   └── [platform]/
│   │   │   │       ├── start/route.ts
│   │   │   │       └── callback/route.ts
│   │   │   ├── posts/
│   │   │   │   ├── route.ts             # GET list (history)
│   │   │   │   ├── [id]/route.ts        # GET (poll)
│   │   │   │   └── [id]/targets/[targetId]/retry/route.ts
│   │   │   ├── account/
│   │   │   │   ├── route.ts             # DELETE
│   │   │   │   └── export/route.ts      # GET
│   │   │   ├── stats/summary/route.ts
│   │   │   └── health/route.ts
│   │   ├── layout.tsx                  # Root layout (fonts, providers)
│   │   ├── error.tsx                    # Global error boundary
│   │   ├── not-found.tsx
│   │   └── globals.css                  # Tailwind + CSS vars for design tokens
│   ├── components/
│   │   ├── ui/                          # shadcn/ui primitives (Button, Card, ...)
│   │   ├── forms/                       # Composer, Profile form, ...
│   │   ├── connections/
│   │   │   ├── connection-card.tsx
│   │   │   ├── trust-expander.tsx       # Verbatim copy from 12-TRUST-COPY
│   │   │   └── connect-checklist.tsx
│   │   ├── publish/
│   │   │   ├── platform-checklist.tsx
│   │   │   ├── live-preview-panel.tsx
│   │   │   ├── status-board.tsx
│   │   │   └── amplify-button.tsx
│   │   └── layout/                      # Nav, sidebar, footer
│   ├── lib/
│   │   ├── platforms/
│   │   │   ├── types.ts                 # Adapter contracts (above)
│   │   │   ├── registry.ts
│   │   │   ├── reddit/
│   │   │   │   ├── adapter.ts
│   │   │   │   ├── client.ts            # Low-level fetch wrappers
│   │   │   │   └── errors.ts
│   │   │   ├── discord/
│   │   │   ├── devto/
│   │   │   ├── telegram/
│   │   │   ├── bluesky/
│   │   │   ├── hashnode/
│   │   │   ├── twitter/                 # Tier B
│   │   │   └── linkedin/                # Tier B
│   │   ├── formatters/
│   │   │   ├── index.ts                 # Registry: formatFor(platform, input)
│   │   │   ├── types.ts                 # FormattedPayload union
│   │   │   ├── reddit.ts
│   │   │   ├── discord.ts
│   │   │   ├── devto.ts
│   │   │   ├── telegram.ts
│   │   │   ├── bluesky.ts
│   │   │   ├── hashnode.ts
│   │   │   ├── twitter.ts
│   │   │   ├── linkedin.ts
│   │   │   └── _shared.ts               # truncate(), graphemeCount(), hashtagLine()
│   │   ├── vault/
│   │   │   └── token-vault.ts           # AES-256-GCM
│   │   ├── queue/
│   │   │   ├── setup.ts                # BullMQ Queue + Worker init
│   │   │   └── workers.ts               # Worker processor (calls adapter)
│   │   ├── validation/
│   │   │   └── schemas.ts               # All Zod schemas (shared)
│   │   ├── auth/
│   │   │   ├── config.ts                # NextAuth config
│   │   │   ├── guards.ts                # requireSession(), requireOwnership()
│   │   │   ├── pkce.ts                  # verifier + challenge (S256)
│   │   │   └── state-cookie.ts          # httpOnly signed cookie helpers
│   │   ├── config/
│   │   │   ├── env.ts                   # Typed env module (fail-fast)
│   │   │   ├── platforms.ts             # Platform limits/budgets/retries (table below)
│   │   │   └── limits.ts                # Rate limits, pagination
│   │   ├── quota/
│   │   │   └── x-monthly.ts
│   │   ├── errors/
│   │   │   ├── codes.ts                 # Error code enum
│   │   │   ├── envelope.ts               # { error: { code, message, fieldErrors } }
│   │   │   └── mapper.ts                # Map DB/platform errors to envelope
│   │   ├── middleware/
│   │   │   └── rate-limit.ts
│   │   ├── audit/
│   │   │   └── actions.ts
│   │   ├── copy.ts                      # All user-facing strings (for i18n later)
│   │   └── upload/
│   │       ├── local.ts                 # Dev: write to /public/uploads
│   │       └── cloudinary.ts            # Prod-ready interface
│   ├── server/
│   │   ├── db.ts                        # Prisma client singleton
│   │   ├── redis.ts                     # Redis client singleton
│   │   └── services/
│   │       ├── auth.ts                  # signup, login (NextAuth), reset
│   │       ├── profile.ts
│   │       ├── postcards.ts
│   │       ├── connections.ts           # connect, disconnect, list
│   │       ├── publish.ts               # createPost, retryTarget, listPosts, getPost
│   │       ├── account.ts               # delete, export
│   │       └── audit.ts                 # log()
│   ├── workers/
│   │   └── publish-worker.ts            # BullMQ processor (Flow A worker steps)
│   └── types/
│       ├── branded.ts                   # UserId, PostCardId, etc. branded types
│       └── results.ts                   # Result<T, E>
├── tests/
│   ├── unit/
│   │   ├── vault/
│   │   ├── formatters/
│   │   │   ├── __fixtures__/            # Golden files per platform
│   │   │   └── *.test.ts
│   │   ├── services/
│   │   └── platforms/                   # Adapter tests with mocked fetch
│   ├── integration/
│   │   ├── auth.test.ts
│   │   ├── postcards.test.ts
│   │   ├── connections.test.ts
│   │   ├── publish.test.ts
│   │   ├── retry.test.ts
│   │   ├── quota.test.ts
│   │   ├── audit.test.ts
│   │   └── credential-scanner.test.ts
│   ├── e2e/
│   │   ├── signup-flow.spec.ts
│   │   ├── postcard-crud.spec.ts
│   │   ├── connect-checklist.spec.ts
│   │   ├── publish-flow.spec.ts
│   │   ├── retry-flow.spec.ts
│   │   └── account-deletion.spec.ts
│   ├── factories.ts                     # Deterministic data factories
│   ├── helpers/                         # Polling, mock-adapter, ...
│   └── setup.ts                        # Global Vitest setup
├── docker-compose.yml                   # Dev: postgres + redis
├── docker-compose.test.yml             # Test: separate postgres + redis
├── Dockerfile                          # Prod (Next.js standalone)
├── .env.example                         # Template; never real values
├── .gitignore
├── .env.local                           # Local dev (gitignored)
├── next.config.mjs
├── tailwind.config.ts
├── tsconfig.json                        # Strict + noUncheckedIndexedAccess
├── vitest.config.ts
├── playwright.config.ts
├── eslint.config.mjs
├── package.json
├── README.md                            # Quick start
└── LICENSE                             # Chosen license (NOT AGPL)
```

---

## 6. Environment Variables

### Required (app fails fast at boot if missing)

| Var | Purpose | Generate with |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | `postgresql://user:pass@localhost:5432/netamplify` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `TOKEN_ENCRYPTION_KEY` | 32-byte base64 AES key | `openssl rand -base64 32` |
| `NEXTAUTH_SECRET` | NextAuth session signing | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | App base URL | `http://localhost:3000` (dev) |
| `PUBLIC_APP_URL` | Public URL for OAuth redirects | same as NEXTAUTH_URL in dev |
| `REDDIT_CLIENT_ID` | Reddit OAuth app id | reddit.com/prefs/apps |
| `REDDIT_CLIENT_SECRET` | Reddit OAuth app secret | same |
| `REDDIT_REDIRECT_URI` | Reddit OAuth callback | `${PUBLIC_APP_URL}/api/oauth/reddit/callback` |
| `EMAIL_FROM` | Sender email for resets | `no-reply@netamplify.app` |
| `EMAIL_API_KEY` | Resend / Postmark API key | provider dashboard |

### Optional (Tier B / prod)

| Var | Purpose | Default if missing |
|---|---|---|
| `TWITTER_CLIENT_ID` | X OAuth (Tier B) | "Setup pending" UI |
| `TWITTER_CLIENT_SECRET` | X OAuth (Tier B) | same |
| `TWITTER_REDIRECT_URI` | X OAuth callback | same |
| `LINKEDIN_CLIENT_ID` | LinkedIn OAuth (Tier B) | "Setup pending" UI |
| `LINKEDIN_CLIENT_SECRET` | LinkedIn OAuth (Tier B) | same |
| `LINKEDIN_REDIRECT_URI` | LinkedIn OAuth callback | same |
| `X_MONTHLY_POST_BUDGET` | X quota guard | `450` |
| `CLOUDINARY_*` | Image uploads (prod) | falls back to local disk |
| `SENTRY_DSN` | Error tracking (prod) | logs to stdout only |

### Rules

- Server-only vars (`DATABASE_URL`, `REDIS_URL`, `TOKEN_ENCRYPTION_KEY`,
  `NEXTAUTH_SECRET`, all platform secrets) are NEVER referenced in
  client components. ESLint rule enforces: `no-restricted-imports` on
  `src/lib/config/env.ts` from any file under `src/components/` or
  `src/app/` that's a client component (`"use client"`).
- `src/lib/config/env.ts` validates all required vars at boot and
  throws a descriptive error if any are missing or wrong-shape.
- `.env.example` contains placeholders (`generate-with-openssl-rand-base64-32`),
  never real values.
- `.env.local` is gitignored.

---

## 7. Platform Config (single source of truth — `src/lib/config/platforms.ts`)

| Platform | Kind | Credential shape | Limits | Notes |
|---|---|---|---|---|
| `REDDIT` | OAUTH | access + refresh token | 60 req/min per user token; title 300; body unlimited | per-user bucket — effectively unbounded for us; refresh tokens valid ~1 year |
| `DISCORD` | SIMPLE | webhook URL | 30 webhook posts/min/channel; embed title 256, description 4096 | posts to ONE channel only; webhook is the trust boundary |
| `DEVTO` | SIMPLE | api_key | 10 articles/hr soft | markdown body; tags ≤4 in front-matter |
| `TELEGRAM` | SIMPLE | bot token + channel | 30 msg/sec global per bot; 4096 chars | user's own bot (trust story); channel must be public OR bot must be admin |
| `BLUESKY` | SIMPLE | handle + app password | 5000 posts/day per account | open protocol, no approval; app password is scoped to posting |
| `HASHNODE` | SIMPLE | PAT | generous (no published hard limit) | markdown; publication optional |
| `TWITTER` | OAUTH | access + refresh | 280 chars; APP monthly budget (config 450) | free tier — quota guard FR-018; refresh token rotation |
| `LINKEDIN` | OAUTH | access token (60d) | 3000 chars | dev/limited mode until review; posts on behalf of person (not org) |

### Retry config (per error class)

| Error class | Retryable? | Backoff (BullMQ) | Max attempts | Terminal action |
|---|---|---|---|---|
| `AUTH` | No | n/a | 1 | Connection → REVOKED; target → FAILED + "Reconnect this platform" |
| `RATE` | Yes | 10s, 60s, 300s | 3 | After 3 → FAILED + "Platform rate-limiting — try later" |
| `VALIDATION` | No | n/a | 1 | FAILED + platform's message verbatim |
| `NETWORK` | Yes | 10s, 60s, 300s | 3 | After 3 → FAILED + "Network issue — try again" |
| `QUOTA` | No | n/a | 1 | SKIPPED + "X quota for this month is used" |

### Failure Classification (worker → outcome)

```
adapter.publish() returns
    ┌─► { ok: true, data: { url, id } }        → SUCCESS (status=SUCCESS, store url+id, lastUsedAt)
    └─► { ok: false, error: { class, message, retryable } }
            │
            ├─ class=AUTH     → Connection REVOKED; target FAILED; "Reconnect this platform"
            ├─ class=RATE     → attempts++; if <3 re-enqueue (backoff 10s/60s/300s); else FAILED
            ├─ class=VALIDATION → target FAILED; message = platform's error verbatim
            ├─ class=NETWORK  → attempts++; if <3 re-enqueue (backoff); else FAILED
            └─ class=QUOTA    → target SKIPPED; "quota used" (shouldn't happen — checked at publish time)
```

---

## 8. Data flow boundaries (what crosses what)

| Boundary | What crosses | What does NOT cross |
|---|---|---|
| Browser ↔ Next.js | Form input, JSON responses, session cookie | Platform credentials, plaintext tokens |
| Next.js ↔ Prisma | Typed Prisma queries | Plaintext credentials (only ciphertext) |
| Next.js ↔ Redis | BullMQ job payloads (targetId), rate-limit counters, OAuth state cookies | Plaintext credentials |
| BullMQ worker ↔ TokenVault | Encrypt request, decrypt response (in-memory only) | n/a (vault is in-process) |
| BullMQ worker ↔ Platform API | Formatted payload + decrypted creds (in-flight only) | User passwords (we never have them) |
| Next.js ↔ AuditLog | userId, action, platform, ip, ua, metadata | Credentials, decrypted content, full request bodies |
| Next.js ↔ Logs | Structured logs with `{ route, userId, requestId, latencyMs, outcome }` | Credentials, decrypted content, tokens |

---

## 9. Performance budgets

| Operation | Budget | Measurement |
|---|---|---|
| Internal API p95 | < 500ms (excluding platform API calls) | `next.js` server timing |
| Publish dispatch | < 2s (request → all jobs enqueued) | timing in publish service |
| Worker per target | < 30s (including platform API) | BullMQ job duration |
| Status poll interval | 3s | client `setInterval` |
| Status poll max duration | 5 min | client abort-on-timeout |
| Image upload (5MB) | < 5s | upload route timing |
| Lighthouse (dashboard) | ≥90 (perf, a11y, best-practice) | Lighthouse CI |

---

## 10. Key design decisions (rationale)

### 10.1 Why BullMQ (not a cron / in-process setTimeout)

- Per-target retry with exponential backoff is built-in.
- Durable across Redis restart (AOF persistence).
- Worker can be split to a separate process when scaling.
- Free tier of Upstash Redis covers MVP volume.

### 10.2 Why a single `credentialsCipher` JSON blob (not per-field columns)

- Adding a new credential shape (e.g., LinkedIn adds `person_urn`) is
  a JSON change, not a migration.
- One column to scan for leaks in CI.
- One decrypt per job; simpler in-memory lifecycle.

### 10.3 Why poll (not WebSocket)

- Polling is dead simple in Next.js; no extra infra.
- 3s × 5min = 100 requests max per Amplify; trivially cacheable.
- WebSocket adds a connection layer + reconnection logic + auth over
  ws — too much for MVP. Post-MVP `C-realtime`.

### 10.4 Why mocked adapters in tests (not real OAuth test apps)

- Real platform APIs cost setup time, rate limits, and can leak
  secrets. Mocking at the adapter boundary is a clean seam and the only
  way to test failure paths deterministically.

### 10.5 Why `requestId` for idempotency (not a server-generated hash)

- Client-generated UUID means the client can retry the same request
  safely (network blip). Server can't regenerate the same UUID.
- Server upserts on `requestId`; second POST returns the first Post
  with `409 DUPLICATE_REQUEST`. UI shows "Already publishing this card"
  + link to status.

### 10.6 Why `userId` scoping in app layer (not Postgres RLS)

- Prisma doesn't expose RLS ergonomically; we'd need raw SQL.
- App-layer scoping enforced by review checklist + per-resource 403
  test is enough for MVP.
- Post-MVP: add Postgres RLS as defense-in-depth.

---

## 11. Cross-cutting concerns

### Logging
- Structured JSON via `pino` (lighter than winston).
- One logger per request (correlated by `requestId`).
- Levels: `debug` (dev), `info` (audit events), `warn` (rate-limit hits),
  `error` (adapter failures, 5xx).
- See `16-OBSERVABILITY.md` for the full schema + scanner regex.

### Error tracking
- Sentry in prod (DSN from env).
- Source maps uploaded on build.
- PII scrubbing configured (no emails, tokens, IPs in breadcrumbs).

### Metrics (basic)
- Counters: publishes, retries, per-platform success/fail.
- Histograms: publish dispatch latency, worker per-target latency.
- See `16-OBSERVABILITY.md` §2.

### Health check
- `GET /api/health` → `{ db: "up", redis: "up" }` or 503 with failing
  component.
- Used by Docker healthcheck + uptime monitor.

---

> End of architecture. Next: `04-DATABASE.md` — Prisma schema (source of
> truth for data) and the 5 mandatory data rules.
