# NetAmplify — API Specification (v1.0)

> Status: LOCKED for MVP. Every endpoint the frontend or external
> client may call. Companion docs: `02-SRS.md` (FRs), `03-ARCHITECTURE.md`
> (Flows A-E), `04-DATABASE.md` (models), `07-SECURITY-ACCESS.md`
> (error matrix).
>
> All endpoints are under `/api/*` (Next.js route handlers). All
> non-GET endpoints require a valid NextAuth session cookie unless
> noted.

---

## 1. Conventions

### Auth
- NextAuth session cookie (HttpOnly, SameSite=Lax, Secure in prod).
- Endpoints that need a session return `401 UNAUTHENTICATED` if missing.
- Endpoints that need ownership return `404 NOT_FOUND` (not `403` —
  never leak existence) if the resource exists but isn't owned by the
  session user. Exceptions documented per-endpoint.

### Error envelope (always, on any 4xx/5xx)

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Title is required",
    "fieldErrors": {
      "title": ["Title is required"]
    }
  }
}
```

- `code`: machine-readable error code (see §2).
- `message`: human-readable, safe to surface to user (sanitized — no
  internal paths, no DB errors, no token patterns).
- `fieldErrors`: optional, per-field error arrays for form validation.

### Success response

- `200` / `201` with JSON body (or `204` with no body for DELETE).
- All timestamps are ISO 8601 UTC strings (e.g., `2025-01-15T10:30:00Z`).
- All IDs are cuid strings.

### Rate limiting
- Global per-user: 100 req/min.
- Auth endpoints (`/api/auth/*`): 10 req/min per IP.
- Publish endpoint: 10 req/min per user.
- On limit hit: `429 RATE_LIMITED` with `Retry-After` header (seconds).

### Idempotency
- Publish endpoint: client sends `requestId` (UUID v4). Server upserts
  on `requestId`; second POST with same `requestId` returns `409
  DUPLICATE_REQUEST` with the existing Post id.
- Other endpoints: not idempotent (no `requestId`); retry at your own
  risk.

---

## 2. Error codes (exhaustive)

| HTTP | Code | Meaning | Surface to user? |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | Zod validation failed | inline field errors |
| 400 | `INVALID_CREDENTIALS` | Platform rejected pasted credential | yes (platform's message) |
| 400 | `BAD_STATE` | OAuth state mismatch / expired | "Security check failed — please reconnect" |
| 400 | `PLATFORM_NOT_CONFIGURED` | Tier B platform env vars missing | "Coming soon — setup pending" |
| 400 | `INVALID_TOKEN` | Password reset token invalid/expired | "Reset link expired — request a new one" |
| 401 | `UNAUTHENTICATED` | No session | redirect to /login |
| 403 | `FORBIDDEN` | Cross-user access (rare; usually 404) | "You don't have access to this" |
| 404 | `NOT_FOUND` | Resource doesn't exist OR not owned | "Not found" + back link |
| 409 | `EMAIL_TAKEN` | Signup with existing email | "Email already registered — log in?" |
| 409 | `DUPLICATE_REQUEST` | Publish with same requestId | "Already publishing this card" → link to status |
| 409 | `NOT_FAILED` | Retry on a non-FAILED target | "This target isn't in a retryable state" |
| 409 | `MAX_RETRIES` | Retry when attempts ≥ 3 | "Max retries reached — reconnect and try again" |
| 429 | `RATE_LIMITED` | Rate limit hit | "Too many requests — wait {Retry-After}s" |
| 502 | `OAUTH_EXCHANGE_FAILED` | OAuth code exchange failed | "{Platform} didn't complete the handshake — try again" |
| 502 | `IDENTITY_CHECK_FAILED` | Network error during credential validation | "Couldn't verify — check your connection and try again" |
| 500 | `INTERNAL` | Unhandled error | "Something went wrong — we've been notified" |

---

## 3. Auth

### POST `/api/auth/signup`

Create a new account. Auto-login on success.

**Request**
```json
{ "email": "alice@example.com", "password": "secure-pass-123", "name": "Alice" }
```

**Zod**
```typescript
signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72),  // bcrypt caps at 72
  name: z.string().min(1).max(100),
});
```

**Responses**
- `201 Created` → `{ id: "user-id", email: "alice@example.com" }`
  (session cookie set automatically)
- `400 VALIDATION_ERROR` → field errors
- `409 EMAIL_TAKEN` → `{ error: { code: "EMAIL_TAKEN", message: "Email already registered" } }`

**Notes**
- bcrypt cost = 10.
- Password strength check: ≥8 chars, mixed case recommended but not
  required (don't be annoying for students).
- Audit: no audit row on signup (we don't log `SIGNUP` in MVP; only
  `LOGIN` after the auto-login).

---

### POST `/api/auth/reset-request`

Request a password reset email. **Always returns 204** regardless of
whether the email exists (no user enumeration).

**Request**
```json
{ "email": "alice@example.com" }
```

**Responses**
- `204 No Content` (always)
- Audit: `LOGIN_FAIL` if email not found (for monitoring) — but no
  response difference.

**Notes**
- Email sent via Resend with a 1-hour single-use token.
- Token format: 32 random bytes, base64url, stored as `emailVerified`
  + a `passwordResetToken` (if we add a column) OR a separate
  `PasswordReset` table. (We'll decide in T-02; lean toward a small
  `PasswordReset` table to avoid User schema churn.)

---

### POST `/api/auth/reset-confirm`

Confirm a password reset with the token from the email.

**Request**
```json
{ "token": "...", "newPassword": "new-secure-pass-123" }
```

**Responses**
- `204 No Content` (password updated, all sessions invalidated)
- `400 INVALID_TOKEN` → `{ error: { code: "INVALID_TOKEN", message: "Reset link expired — request a new one" } }`

---

### GET / POST `/api/auth/[...nextauth]`

NextAuth.js v4 endpoints (sign in, sign out, session, csrf token).
Handled by NextAuth; no custom code.

---

## 4. Profile

### GET `/api/profile`

Returns the session user's profile.

**Responses**
- `200 OK` →
  ```json
  {
    "id": "profile-id",
    "userId": "user-id",
    "name": "Alice",                  // from User.name (joined)
    "headline": "Final-year CS @ IIT",
    "college": "IIT Madras",
    "graduationYear": 2026,
    "githubUrl": "https://github.com/alice",
    "portfolioUrl": "https://alice.dev"
  }
  ```
- `401 UNAUTHENTICATED`

---

### PATCH `/api/profile`

Partial update. All fields optional; only provided fields are updated.

**Request**
```json
{ "headline": "Building in public 🚀", "graduationYear": 2027 }
```

**Zod**
```typescript
profilePatchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  headline: z.string().max(140).optional(),
  college: z.string().max(100).optional(),
  graduationYear: z.number().int().min(2015).max(2035).optional(),
  githubUrl: z.string().url().startsWith('https://github.com/').optional().or(z.literal('')),
  portfolioUrl: z.string().url().optional().or(z.literal('')),
});
```

**Responses**
- `200 OK` → updated Profile (same shape as GET)
- `400 VALIDATION_ERROR` → field errors
- `401 UNAUTHENTICATED`

---

## 5. Post Cards

### GET `/api/postcards?page=1&pageSize=12`

List the session user's post cards, newest first.

**Query params**
- `page` (int, default 1)
- `pageSize` (int, default 12, max 50)

**Responses**
- `200 OK` →
  ```json
  {
    "items": [
      {
        "id": "card-id",
        "title": "NetAmplify: post once, get seen everywhere",
        "summary": "A multi-platform publisher for students.",
        "techStack": ["nextjs", "prisma", "redis"],
        "repoUrl": "https://github.com/alice/netamplify",
        "liveUrl": "https://netamplify.app",
        "imageUrl": null,
        "createdAt": "2025-01-15T10:00:00Z",
        "updatedAt": "2025-01-15T10:30:00Z"
      }
    ],
    "total": 3,
    "page": 1,
    "pageSize": 12
  }
  ```
- `401 UNAUTHENTICATED`

---

### POST `/api/postcards`

Create a new post card.

**Request**
```json
{
  "title": "NetAmplify: post once, get seen everywhere",
  "summary": "A multi-platform publisher for students.",
  "description": "# NetAmplify\n\nA student creates a Post Card once...",
  "techStack": ["nextjs", "prisma", "redis", "typescript"],
  "repoUrl": "https://github.com/alice/netamplify",
  "liveUrl": "https://netamplify.app"
}
```

**Zod**
```typescript
postCardCreateSchema = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(200),
  description: z.string().max(5000),
  techStack: z.array(z.string().min(1).max(24)).min(1).max(10),
  repoUrl: z.string().url().optional().or(z.literal('')),
  liveUrl: z.string().url().optional().or(z.literal('')),
  imageUrl: z.string().url().optional(),
});
```

**Responses**
- `201 Created` → created PostCard (full shape)
- `400 VALIDATION_ERROR` → field errors
- `401 UNAUTHENTICATED`

---

### GET `/api/postcards/:id`

Get a single post card by ID. Owner-only (404 if not owned).

**Responses**
- `200 OK` → PostCard (full shape, includes description markdown)
- `401 UNAUTHENTICATED`
- `404 NOT_FOUND` (also when not owned by session user)

---

### PATCH `/api/postcards/:id`

Partial update. All fields optional.

**Request** — same shape as POST but all fields optional.

**Zod** — `postCardPatchSchema` (all fields optional).

**Responses**
- `200 OK` → updated PostCard
- `400 VALIDATION_ERROR` → field errors
- `401 UNAUTHENTICATED`
- `404 NOT_FOUND`

---

### DELETE `/api/postcards/:id`

Delete a post card. Cascades to Posts and PostTargets.

**Responses**
- `204 No Content`
- `401 UNAUTHENTICATED`
- `404 NOT_FOUND`

---

### GET `/api/postcards/:id/preview?platform=REDDIT&subreddit=sideproject`

Live preview of formatted output for a single platform. Used by the
publish page to show real formatter output + char counter.

**Query params**
- `platform` (required, enum: REDDIT, DISCORD, DEVTO, TELEGRAM, BLUESKY,
  HASHNODE, TWITTER, LINKEDIN)
- `subreddit` (string, required if platform=REDDIT)

**Responses**
- `200 OK` →
  ```json
  {
    "platform": "REDDIT",
    "formatted": {
      "title": "NetAmplify: post once, get seen everywhere",
      "body": "# NetAmplify\n\nA student creates a Post Card once..."
    },
    "charCount": { "title": 42, "body": 580 },
    "limit": { "title": 300, "body": null }
  }
  ```
- `400 VALIDATION_ERROR` → if `platform` missing/invalid or subreddit
  missing for Reddit
- `401 UNAUTHENTICATED`
- `404 NOT_FOUND` (post card not found or not owned)

**Notes**
- This endpoint calls the pure formatter only — no DB write, no
  platform API call. Cheap.
- Response shape varies per platform (`formatted` is a discriminated
  union). See `src/lib/formatters/types.ts`.

---

## 6. Connections (Connect Checklist)

### GET `/api/connections`

List the session user's connections. **Never includes credentials or
ciphertext.** Whitelist projection.

**Responses**
- `200 OK` →
  ```json
  [
    {
      "platform": "REDDIT",
      "type": "OAUTH",
      "username": "alice_dev",
      "status": "ACTIVE",
      "configured": true,            // false for Tier B unconfigured
      "connectedAt": "2025-01-10T...",
      "lastUsedAt": "2025-01-15T...",
      "scopes": ["identity", "submit"]
    },
    {
      "platform": "DISCORD",
      "type": "WEBHOOK",
      "username": "#side-projects in Code Club",
      "status": "ACTIVE",
      "configured": true,
      "connectedAt": "2025-01-11T...",
      "lastUsedAt": null,
      "scopes": []
    },
    {
      "platform": "TWITTER",
      "type": "OAUTH",
      "username": null,
      "status": "ACTIVE",
      "configured": false,           // Tier B not configured → "Setup pending"
      "connectedAt": null,
      "lastUsedAt": null,
      "scopes": []
    }
  ]
  ```
- `401 UNAUTHENTICATED`

**Notes**
- Includes ALL platforms (Tier A + Tier B), even unconnected ones, so
  the UI can render the full checklist. Unconnected platforms have
  `connectedAt: null`, `username: null`.
- `configured: false` only for Tier B platforms whose env vars are
  missing. Tier A platforms are always `configured: true` (we ship
  with their credentials).

---

### GET `/api/oauth/:platform/start`

Start an OAuth flow for `REDDIT`, `TWITTER`, or `LINKEDIN`.

**Responses**
- `302 Found` → redirect to platform authorize URL with PKCE challenge
  + state. Sets `oauth_state` httpOnly signed cookie (10 min TTL,
  single-use).
- `400 PLATFORM_NOT_CONFIGURED` → if Tier B env vars missing
  (`{ error: { code: "PLATFORM_NOT_CONFIGURED", message: "Coming
  soon — setup pending" } }`)
- `400 VALIDATION_ERROR` → if `:platform` not in supported list

---

### GET `/api/oauth/:platform/callback?code=...&state=...`

OAuth callback. Validates state cookie, exchanges code for tokens,
fetches identity, encrypts, upserts Connection, audits, redirects to
checklist.

**Responses**
- `302 Found` → redirect to `/dashboard/connections?connected=<platform>`
- `400 BAD_STATE` → if state missing, expired, or mismatched (audit
  `TOKEN_FAIL`)
- `404 NOT_FOUND` → if `:platform` not supported or not configured
- `502 OAUTH_EXCHANGE_FAILED` → if code exchange fails (platform API
  4xx/5xx)

---

### POST `/api/connections/devto`

Connect Dev.to with an API key.

**Request**
```json
{ "apiKey": "sk-..." }
```

**Zod**
```typescript
z.object({ apiKey: z.string().min(20).max(100) });
```

**Responses**
- `201 Created` → `{ username: "@alice" }`
- `400 INVALID_CREDENTIALS` → `{ error: { code: "INVALID_CREDENTIALS",
  message: "Key rejected by Dev.to — check and re-paste" } }`
- `502 IDENTITY_CHECK_FAILED` → network error during validation

---

### POST `/api/connections/hashnode`

Connect Hashnode with a PAT.

**Request**
```json
{ "pat": "..." }
```

**Responses**
- `201 Created` → `{ username: "@alice" }`
- `400 INVALID_CREDENTIALS` → "Key rejected by Hashnode — check and re-paste"
- `502 IDENTITY_CHECK_FAILED`

---

### POST `/api/connections/discord`

Connect Discord with a webhook URL.

**Request**
```json
{ "webhookUrl": "https://discord.com/api/webhooks/..." }
```

**Zod**
```typescript
z.object({
  webhookUrl: z.string().url().startsWith('https://discord.com/api/webhooks/')
});
```

**Responses**
- `201 Created` → `{ channelName: "side-projects", guildName: "Code Club" }`
- `400 INVALID_CREDENTIALS` → "Discord rejected this webhook — check the URL or recreate it in your server settings"
- `400 VALIDATION_ERROR` → fieldErrors.webhookUrl (wrong shape)
- `502 IDENTITY_CHECK_FAILED`

---

### POST `/api/connections/telegram`

Connect Telegram with a bot token + channel.

**Request**
```json
{ "botToken": "123:ABC...", "channel": "@myproject" }
```

**Zod**
```typescript
z.object({
  botToken: z.string().regex(/^\d+:.+$/),
  channel: z.string().regex(/^@[\w_]+$/),
});
```

**Responses**
- `201 Created` → `{ channelTitle: "My Project Updates" }`
- `400 INVALID_CREDENTIALS` → `{ error: { code: "INVALID_CREDENTIALS",
  message: "...", reason: "BAD_TOKEN" | "NOT_ADMIN" | "BAD_CHANNEL" } }`
  - `BAD_TOKEN`: "Bot token invalid — get a fresh one from @BotFather"
  - `NOT_ADMIN`: "Make your bot an admin of the channel first"
  - `BAD_CHANNEL`: "Channel not found — check the @username"
- `502 IDENTITY_CHECK_FAILED`

---

### POST `/api/connections/bluesky`

Connect Bluesky with handle + app password.

**Request**
```json
{ "handle": "alice.bsky.social", "appPassword": "..." }
```

**Zod**
```typescript
z.object({
  handle: z.string().min(3).max(100),
  appPassword: z.string().min(8).max(200),
});
```

**Responses**
- `201 Created` → `{ did: "did:plc:..." }`
- `400 INVALID_CREDENTIALS` → "Bluesky rejected these credentials — create the app password in Settings → App passwords"
- `502 IDENTITY_CHECK_FAILED`

---

### DELETE `/api/connections/:platform`

Disconnect a platform. Hard-delete Connection row, audit `DISCONNECT`.

**Responses**
- `204 No Content`
- `401 UNAUTHENTICATED`
- `404 NOT_FOUND` (connection not found for that user+platform)

---

## 7. Publishing

### POST `/api/postcards/:id/publish`

Amplify a post card to N platforms. See Flow A in `03-ARCHITECTURE.md`.

**Request**
```json
{
  "platforms": [
    { "platform": "REDDIT", "options": { "subreddit": "sideproject" } },
    { "platform": "DISCORD" },
    { "platform": "DEVTO" }
  ],
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Zod**
```typescript
publishSchema = z.object({
  platforms: z.array(z.object({
    platform: z.enum(['REDDIT','DISCORD','DEVTO','TELEGRAM','BLUESKY','HASHNODE','TWITTER','LINKEDIN']),
    options: z.record(z.unknown()).optional(),
  })).min(1).max(8),
  requestId: z.string().uuid(),
});
```

**Responses**
- `201 Created` →
  ```json
  {
    "post": {
      "id": "post-id",
      "createdAt": "2025-01-15T10:30:00Z",
      "targets": [
        { "id": "t1", "platform": "REDDIT", "status": "QUEUED" },
        { "id": "t2", "platform": "DISCORD", "status": "QUEUED" },
        { "id": "t3", "platform": "DEVTO", "status": "QUEUED" }
      ]
    }
  }
  ```
- `400 VALIDATION_ERROR` → field errors
- `400 INVALID_CREDENTIALS` (invalidPlatforms) →
  ```json
  {
    "error": {
      "code": "INVALID_CREDENTIALS",
      "message": "Connect these platforms first",
      "invalidPlatforms": ["REDDIT", "TWITTER"]
    }
  }
  ```
- `401 UNAUTHENTICATED`
- `404 NOT_FOUND` (post card not found or not owned)
- `409 DUPLICATE_REQUEST` →
  ```json
  {
    "error": {
      "code": "DUPLICATE_REQUEST",
      "message": "Already publishing this card",
      "postId": "existing-post-id"
    }
  }
  ```

**Notes**
- Server validates every requested platform has the user's ACTIVE
  Connection. If any platform is missing or REVOKED → 400 with
  `invalidPlatforms`.
- X quota check (FR-018) happens here. If X over budget → X target
  created with `status: SKIPPED`, `errorClass: "QUOTA"`, NOT enqueued.
  Other targets proceed normally.
- BullMQ job enqueued per non-SKIPPED target.
- Audit `PUBLISH` logged once (one row per Post, not per target).

---

### GET `/api/posts?page=1&platform=REDDIT&status=SUCCESS`

History list. Owner-scoped.

**Query params**
- `page` (int, default 1)
- `pageSize` (int, default 20, max 50)
- `platform` (enum, optional filter)
- `status` (enum, optional filter — filters by Posts that have at
  least one target with this status)

**Responses**
- `200 OK` →
  ```json
  {
    "items": [
      {
        "id": "post-id",
        "createdAt": "2025-01-15T10:30:00Z",
        "postCard": {
          "id": "card-id",
          "title": "NetAmplify: post once, get seen everywhere"
        },
        "targets": [
          {
            "id": "t1",
            "platform": "REDDIT",
            "status": "SUCCESS",
            "platformPostUrl": "https://reddit.com/r/sideproject/comments/...",
            "platformPostId": "t3_abc123",
            "error": null,
            "errorClass": null,
            "attempts": 1,
            "publishedAt": "2025-01-15T10:30:45Z"
          },
          {
            "id": "t2",
            "platform": "DISCORD",
            "status": "FAILED",
            "platformPostUrl": null,
            "platformPostId": null,
            "error": "Webhook deleted — recreate it",
            "errorClass": "AUTH",
            "attempts": 1,
            "publishedAt": null
          }
        ]
      }
    ],
    "total": 53,
    "page": 1,
    "pageSize": 20
  }
  ```
- `401 UNAUTHENTICATED`

---

### GET `/api/posts/:id`

Single post + targets. Used by status board poll.

**Responses**
- `200 OK` → Post with targets (same shape as items[] above, single
  object)
- `401 UNAUTHENTICATED`
- `404 NOT_FOUND`

**Notes**
- Polled by UI every 3s until all targets terminal (SUCCESS / FAILED /
  SKIPPED). Max 5 min, then abort.
- Server-side: this is a cheap query (one Post + N targets by postId
  index).

---

### POST `/api/posts/:id/targets/:targetId/retry`

Retry a FAILED target. See Flow E.

**Responses**
- `200 OK` → `{ target: { ...updated target with attempts+1, status: QUEUED } }`
- `401 UNAUTHENTICATED`
- `404 NOT_FOUND` (post or target not found or not owned)
- `409 NOT_FAILED` → target not in FAILED state
- `409 MAX_RETRIES` → attempts ≥ 3
- `409 INVALID_CREDENTIALS` (AUTH-class) → `{ error: { code:
  "INVALID_CREDENTIALS", message: "Reconnect this platform first",
  needsReconnect: true } }`

---

## 8. Account

### DELETE `/api/account`

Delete the user's account. Typed confirmation in UI ("DELETE").

**Responses**
- `204 No Content` (session destroyed, redirect to landing)
- `401 UNAUTHENTICATED`

**Notes**
- Audit `ACCOUNT_DELETE` row written BEFORE deletion (with userId).
- Cascades: Profile, PostCard (→ Post → PostTarget), Connection
  (ciphertext gone), Post (→ PostTarget). AuditLog rows kept
  (NoAction) for forensics.
- In-flight BullMQ jobs for this user's targets: worker re-reads
  Connection at execution → null → SKIPPED "connection removed".

---

### GET `/api/account/export`

Export all user data as JSON. Used by Settings → Danger zone → Export.

**Responses**
- `200 OK` → JSON file download (`Content-Disposition: attachment;
  filename="netamplify-export-<userId>-<timestamp>.json"`)
  ```json
  {
    "user": { "id": "...", "email": "...", "name": "...", "createdAt": "..." },
    "profile": { ... },
    "postCards": [ ... ],
    "connections": [
      // Metadata only — NO credentialsCipher
      { "platform": "REDDIT", "username": "...", "connectedAt": "...", "scopes": ["identity","submit"] },
      ...
    ],
    "posts": [ ... with targets ... ],
    "auditLogs": [ ... ]
  }
  ```
- `401 UNAUTHENTICATED`

**Notes**
- `credentialsCipher` is stripped from `connections`; metadata only.
- Audit `EXPORT` (new action — add to FR-017 if not present).

---

## 9. Misc

### GET `/api/health`

Health check (no auth required). Used by Docker healthcheck + uptime
monitor.

**Responses**
- `200 OK` → `{ db: "up", redis: "up" }`
- `503 Service Unavailable` → `{ db: "down", redis: "up" }` (or vice
  versa, with the failing component marked `down` and an `error`
  message)

---

### GET `/api/stats/summary`

Basic stats for the dashboard stats strip (S2). Owner-scoped.

**Responses**
- `200 OK` →
  ```json
  {
    "posts": 53,
    "successRate": 0.94,        // 0-1
    "byPlatform": {
      "REDDIT": { "total": 30, "success": 28, "failed": 2 },
      "DISCORD": { "total": 18, "success": 18, "failed": 0 },
      "DEVTO": { "total": 5, "success": 4, "failed": 1 }
    }
  }
  ```
- `401 UNAUTHENTICATED`

**Notes**
- Computed by aggregating PostTarget rows for this user. Indexed by
  `[platform, status]`.
- Cache 60s in Redis (stretch goal; MVP computes each call).

---

## 10. Cross-cutting ownership assertions

For every endpoint that takes an `:id` parameter for a user-owned
resource:

| Endpoint | Resource | Owner field | 404 if not owned? |
|---|---|---|---|
| `GET/PATCH/DELETE /api/postcards/:id` | PostCard | `userId` | Yes (404, not 403) |
| `GET /api/postcards/:id/preview` | PostCard | `userId` | Yes |
| `POST /api/postcards/:id/publish` | PostCard | `userId` | Yes |
| `GET /api/posts/:id` | Post | `userId` | Yes |
| `POST /api/posts/:id/targets/:targetId/retry` | Post | `userId` | Yes (and targetId must belong to postId) |

The pattern (enforced by integration test per resource):
```typescript
const resource = await prisma.postCard.findUnique({
  where: { id, userId: session.user.id },
});
if (!resource) return notFound();
```

---

## 11. Response scanner (CI gate)

`tests/integration/credential-scanner.test.ts`:

```typescript
describe('credential scanner', () => {
  for (const endpoint of ALL_ENDPOINTS) {
    it(`${endpoint} response contains no credential patterns`, async () => {
      const res = await callWithMockedAuth(endpoint);
      const body = JSON.stringify(res.body);
      const patterns = [
        /sk-[A-Za-z0-9]{20,}/,                  // Dev.to / OpenAI-style keys
        /xoxb-[A-Za-z0-9-]+/,                    // Slack-style (defensive)
        /did:plc:[A-Za-z2-7]{24}/,               // Bluesky DID
        /\d{6,}:[A-Za-z0-9_-]{30,}/,            // Telegram bot token
        /https:\/\/discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/,
        /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,  // JWT shape
      ];
      for (const p of patterns) {
        expect(body).not.toMatch(p);
      }
    });
  }
});
```

CI fails on any match. This is the single most important test in the
suite — it catches the worst class of security regression.

---

> End of API spec. Next: `06-FRONTEND-SPEC.md` — design system, every
> screen, every state, integration map.
