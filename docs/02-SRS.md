# NetAmplify — Software Requirements Specification (v1.0)

> Status: LOCKED for MVP. Reference FR IDs in code, tests, commits:
> `feat(FR-003): add postcard update route`. Every ticket in
> `11-FEATURE-TICKETS.md` references one or more FRs; every test asserts
> acceptance criteria for one or more FRs.
>
> Structure: each FR has a **Spec** (what), **Acceptance** (how we know it
> works), **Tests** (what to write), and **References** (where it lives in
> code). NFRs follow at the bottom.

---

## Functional Requirements

### FR-001 App Authentication

**Spec**
Email/password signup (password ≥8 chars, bcrypt cost ≥10), login,
logout, session 7 days, password reset via emailed 1-hour single-use
token. NextAuth.js v4 (credentials provider only) for sessions; no
Google OAuth in MVP. CSRF handled by NextAuth.

**Acceptance**
- Register → logout → login E2E passes.
- Wrong password → inline error `INVALID_CREDENTIALS`, no user
  enumeration.
- Unauthenticated `GET /dashboard/**` → 302 to `/login?returnTo=...`.
- After login, redirect to `returnTo` if it's a same-origin path.
- Password reset request → 204 always (no user enumeration), email
  sent only if the account exists.
- Password reset confirm with expired/used token → 400 `INVALID_TOKEN`.
- Rate-limited at 10 req/min/IP on `/api/auth/*` (FR-016).

**Tests**
- Unit: bcrypt hash/compare, password strength validator, reset-token
  generator + validator.
- Integration: signup happy path, duplicate email → 409, login → 200,
  reset-request 204 regardless of email existence, reset-confirm happy
  path and expired-token path.
- E2E (T-02): full signup → profile → logout → login journey.

**References**
- `src/app/api/auth/signup/route.ts`
- `src/app/api/auth/reset-request/route.ts`
- `src/app/api/auth/reset-confirm/route.ts`
- `src/lib/auth/config.ts`, `src/lib/auth/guards.ts`
- `src/server/services/auth.ts`

---

### FR-002 Minimal Profile

**Spec**
A `Profile` row per user (1:1) with fields:
- `name` (string, 1–100, required; inherited from `User.name` on first
  creation, then editable here)
- `headline` (string, ≤140)
- `college` (string, ≤100)
- `graduationYear` (int, 2015–2035 inclusive)
- `githubUrl` (URL, must start with `https://github.com/` if non-empty)
- `portfolioUrl` (URL, must be valid `https://` URL if non-empty)

All fields optional except `name`. Partial PATCH updates allowed.

**Acceptance**
- Persists across sessions.
- Invalid URL → 400 with `fieldErrors.githubUrl` or
  `fieldErrors.portfolioUrl`.
- `graduationYear` outside 2015–2035 → 400 with field error.
- `headline` over 140 chars → 400 with field error.
- A user can read only their own profile; cross-user `GET` → 403 / 404.
- Formatters use `profile.name` and `profile.portfolioUrl` for credit +
  linkback. If `portfolioUrl` is empty, formatters fall back to
  `githubUrl`; if both empty, no linkback line.

**Tests**
- Unit: Zod schema accepts valid, rejects invalid; partial PATCH merge.
- Integration: GET/PATCH happy path; cross-user 403; field validation.
- E2E (T-03): profile update in settings persists.

**References**
- `src/app/api/profile/route.ts`
- `src/lib/validation/schemas.ts` → `profilePatchSchema`
- `src/server/services/profile.ts`

---

### FR-003 Post Card CRUD

**Spec**
Fields:
- `title` (required, ≤120)
- `summary` (required, ≤200)
- `description` (markdown, ≤5000 chars; sanitized on render)
- `techStack` (1–10 tags, each ≤24 chars, kebab-case recommended)
- `repoUrl?` (URL, valid `https://`)
- `liveUrl?` (URL, valid `https://`)
- `imageUrl?` (URL of an uploaded image; see S3)

Owner-only access enforced server-side on every operation.

**Acceptance**
- Full CRUD: create, read (own), update (own), delete (own).
- User B calling `GET /api/postcards/:A_id` → 404 (not 403 — never leak
  existence).
- Empty required fields → 400 with `fieldErrors`.
- `techStack` empty array → 400 with field error; >10 tags → 400.
- Description > 5000 → 400; description with raw HTML is allowed to
  enter (markdown allows it textually) but is stripped on render.
- Image upload (S3): 5 MB max, jpg/png/webp only, oversize → 400.
- Delete a Post Card with existing Posts → cascade deletes the Posts
  and PostTargets (per `04-DATABASE.md`).

**Tests**
- Unit: Zod schemas for create and patch.
- Integration: full CRUD happy path; cross-user 403/404; field
  validation; cascade delete.
- E2E (T-04): create → dashboard shows → edit → save → delete.

**References**
- `src/app/api/postcards/route.ts` (GET list, POST create)
- `src/app/api/postcards/[id]/route.ts` (GET, PATCH, DELETE)
- `src/app/api/postcards/[id]/preview/route.ts` (GET live preview — see
  FR-011)
- `src/server/services/postcards.ts`
- `src/lib/validation/schemas.ts` → `postCardCreateSchema`,
  `postCardPatchSchema`

---

### FR-004 Connect Checklist — OAuth platforms (Reddit; X / LinkedIn if configured)

**Spec**
OAuth 2.0 + PKCE (S256 code challenge). Random 32-byte `state` stored in
a signed httpOnly cookie (10-min TTL, single-use). Request MINIMAL
scopes:
- Reddit: `identity`, `submit` (posting scope)
- X: `tweet.read`, `tweet.write`, `users.read` (only if Tier B enabled)
- LinkedIn: `w_member_social` (posting) + `r_liteprofile` (only if Tier
  B enabled)

On success: exchange code → tokens → fetch identity → encrypt via
TokenVault → upsert Connection (with `platformAccountId`,
`platformUsername`, `scopes`, `credentialsCipher`) → audit `CONNECT` →
302 to `/dashboard/connections?connected=<platform>`.

If platform client credentials are absent from env → platform card on
the checklist shows amber "Setup pending" state; Connect button
disabled; nothing errors. The `/api/oauth/:platform/start` endpoint
returns 400 `PLATFORM_NOT_CONFIGURED` if env vars are missing.

**Acceptance**
- Happy path: Connect → redirect → consent → callback → "Connected as
  @handle". Cookie cleared after callback (single-use).
- Tampered `state` (different from cookie) → 400 `BAD_STATE`, no
  Connection row created, audit `TOKEN_FAIL`.
- Missing `state` cookie (TTL expired) → 400 `BAD_STATE`.
- Callback for unconfigured platform (`/api/oauth/twitter/callback`
  when `TWITTER_CLIENT_ID` not in env) → 404.
- Response from `/api/oauth/:platform/start` for unconfigured platform
  → 400 `PLATFORM_NOT_CONFIGURED` (not 500).
- Response from `GET /api/connections` never includes credentials or
  tokens (scanner test green).
- Re-connecting with a different account → upsert: old ciphertext
  overwritten, `platformUsername` updated, audit `CONNECT` (not
  `DISCONNECT`).

**Tests**
- Unit: PKCE verifier/challenge generator, state-cookie signer,
  Reddit adapter `getAuthUrl` / `exchangeCode` / `getIdentity` with
  mocked fetch.
- Integration: full start → callback flow with mocked Reddit API;
  tampered state → 400; expired state → 400; unconfigured → 400.
- E2E (T-09): Connect Reddit (with mock-redirect helper for test
  environment).

**References**
- `src/app/api/oauth/[platform]/start/route.ts`
- `src/app/api/oauth/[platform]/callback/route.ts`
- `src/lib/auth/pkce.ts`, `src/lib/auth/state-cookie.ts`
- `src/lib/platforms/reddit/adapter.ts`
- `src/server/services/connections.ts`

---

### FR-005 Connect Checklist — API-key platforms (Dev.to, Hashnode)

**Spec**
User pastes API key (Dev.to `api-key` or Hashnode PAT) → server
validates by calling the platform's identity endpoint (Dev.to:
`GET /api/me`; Hashnode: `GET /` GraphQL query `me`) → key MUST resolve
to a username → on success: encrypt via TokenVault, upsert Connection,
audit `CONNECT`, return `{ username }` → on failure: surface the
platform's own error verbatim (e.g., "Key rejected by Dev.to — check
and re-paste").

**Acceptance**
- Valid key → 201 `{ username: "@user" }`; Connection row created with
  `platformUsername` set; `credentialsCipher` populated; `lastValidatedAt`
  set.
- Invalid / expired key → 400 `INVALID_CREDENTIALS` with platform's
  message in `error.message`; no Connection row.
- Network error during validation → 502 `IDENTITY_CHECK_FAILED` (we
  distinguish from invalid key — don't tell user their key is bad if our
  network is the problem).
- Same platform reconnected with different key → upsert; old ciphertext
  overwritten; `platformUsername` updated.
- Response never echoes the key (scanner test green).

**Tests**
- Unit: Dev.to / Hashnode adapter `validateCredentials` with mocked
  fetch returning valid, invalid, network-error.
- Integration: POST `/api/connections/devto` happy path, invalid key,
  network-error, re-connect.
- E2E (T-10): connect Dev.to with mocked API.

**References**
- `src/app/api/connections/devto/route.ts`
- `src/app/api/connections/hashnode/route.ts`
- `src/lib/platforms/devto/adapter.ts`
- `src/lib/platforms/hashnode/adapter.ts`
- `src/server/services/connections.ts`

---

### FR-006 Connect Checklist — Discord webhook

**Spec**
User pastes a Discord webhook URL (`https://discord.com/api/webhooks/...`).
Server `GET`s it (Discord returns channel metadata) → on success, show
user "Will post to `#channel-name` in `<server name>`" → encrypt URL,
upsert Connection, audit `CONNECT`, return `{ channelName, guildName }`.
On failure (404 / 401 / network) → clear rejection with platform's own
error.

**Acceptance**
- Valid webhook → 201 `{ channelName: "side-projects", guildName:
  "Code Club" }`.
- Revoked / deleted webhook → 400 `INVALID_CREDENTIALS` with
  "Discord rejected this webhook — check the URL or recreate it in
  your server settings".
- Wrong-shaped URL (not a Discord webhook URL) → 400 `VALIDATION_ERROR`
  with `fieldErrors.webhookUrl`.
- Response never echoes the webhook URL (scanner test green).
- Re-connect with new webhook → upsert.

**Tests**
- Unit: Discord adapter `validateCredentials` with mocked fetch.
- Integration: POST `/api/connections/discord` happy / invalid / network.
- E2E (T-10): connect Discord happy path (mocked webhook validation).

**References**
- `src/app/api/connections/discord/route.ts`
- `src/lib/platforms/discord/adapter.ts`
- `src/server/services/connections.ts`

---

### FR-007 Connect Checklist — Telegram bot

**Spec**
User pastes `botToken` (from @BotFather) + `channel` (a `@username`
public channel where the bot is admin). Server calls Telegram
`getMe` (validates token) + `getChat` (validates the bot is admin of
that channel) → on success: encrypt both, upsert Connection (with
`platformUsername` = channel handle), audit `CONNECT`, return
`{ channelTitle }`. On failure: distinguish `BAD_TOKEN` vs `NOT_ADMIN`
for a precise user hint.

**Acceptance**
- Valid token + bot is admin → 201 `{ channelTitle: "My Project
  Updates" }`.
- Bad token (`getMe` returns 401) → 400 `{ reason: "BAD_TOKEN",
  message: "Bot token invalid — get a fresh one from @BotFather" }`.
- Token valid but bot not admin of channel (`getChat` returns 403) →
  400 `{ reason: "NOT_ADMIN", message: "Make your bot an admin of the
  channel first" }`.
- Channel doesn't exist (`getChat` returns 400) → 400 `{ reason:
  "BAD_CHANNEL", message: "Channel not found — check the @username" }`.
- Response never echoes the bot token (scanner test green).

**Tests**
- Unit: Telegram adapter `validateCredentials` with mocked fetch
  covering all four outcomes.
- Integration: POST `/api/connections/telegram` happy + each failure.
- E2E (T-11): connect Telegram happy path with mock.

**References**
- `src/app/api/connections/telegram/route.ts`
- `src/lib/platforms/telegram/adapter.ts`
- `src/server/services/connections.ts`

---

### FR-008 Connect Checklist — Bluesky app password

**Spec**
User pastes `handle` (e.g., `alice.bsky.social`) + `appPassword`
(generated in Bluesky Settings → App passwords). Server creates a
session via the `bsky.app` protocol (`createSession` endpoint at
`https://bsky.social/xrpc/com.atproto.server.createSession`) → on
success: encrypt `accessJwt` + `refreshJwt` + `did`, upsert Connection
(with `platformAccountId = did`, `platformUsername = handle`), audit
`CONNECT`, return `{ did }`. On failure: surface Bluesky's own error
verbatim with hint to create an app password in settings.

**Acceptance**
- Valid handle + app password → 201 `{ did: "did:plc:..." }`.
- Invalid pair (wrong password / handle doesn't exist) → 400
  `INVALID_CREDENTIALS` with message "Bluesky rejected these
  credentials — create the app password in Settings → App passwords".
- Network error → 502.
- Response never echoes the app password (scanner test green).

**Tests**
- Unit: Bluesky adapter `validateCredentials` with mocked fetch.
- Integration: POST `/api/connections/bluesky` happy / invalid /
  network.
- E2E (T-11): connect Bluesky happy path with mock.

**References**
- `src/app/api/connections/bluesky/route.ts`
- `src/lib/platforms/bluesky/adapter.ts`
- `src/server/services/connections.ts`

---

### FR-009 Token Vault (security-critical)

**Spec**
AES-256-GCM. Key from `TOKEN_ENCRYPTION_KEY` env (32-byte base64;
generate with `openssl rand -base64 32`). All credential shapes (OAuth
tokens, API keys, webhook URLs, bot tokens, app passwords) stored as
ONE encrypted JSON blob per Connection (`credentialsCipher`).
Ciphertext format: `base64(iv) : base64(ciphertext) : base64(authTag)`.

Plaintext exists ONLY in-memory inside server workers / connect-
validation. NEVER in:
- DB (only ciphertext column)
- Logs (scanner test greps all log lines for token patterns)
- API responses (whitelist projection; never `select *`)
- Client bundles (server-only module imports)

Typed env module: `src/lib/config/env.ts` validates `TOKEN_ENCRYPTION_KEY`
at boot; app fails fast if missing or wrong length.

**Acceptance**
- Unit tests prove: ciphertext ≠ plaintext (assert); round-trip
  `encrypt → decrypt` equals input; tampered ciphertext (any byte
  changed) throws on decrypt; missing key at boot throws.
- Integration test greps every API response from the full test suite
  for token patterns (`sk-`, `xoxb-`, `reddit refresh token shape`,
  `did:plc:`, telegram bot token shape, Discord webhook URL shape,
  Bluesky accessJwt shape) → zero matches.
- DB dump grep test (CI): take a snapshot of the test DB, grep for the
  same patterns → zero matches (ciphertext is base64 of random-looking
  bytes; patterns won't appear).

**Tests**
- Unit (`src/lib/vault/token-vault.test.ts`):
  - round-trip works for all credential shapes
  - ciphertext ≠ plaintext for all shapes
  - tampered ciphertext throws
  - missing key throws at boot
  - wrong-shape key (not 32 bytes after base64 decode) throws
- Integration: response scanner test (`tests/integration/credential-scanner.test.ts`).
- CI: DB dump grep test (`scripts/scan-db-dump.sh`).

**References**
- `src/lib/vault/token-vault.ts`
- `src/lib/config/env.ts`
- `tests/unit/vault/token-vault.test.ts`
- `tests/integration/credential-scanner.test.ts`

---

### FR-010 Disconnect

**Spec**
Hard-delete the `Connection` row (ciphertext gone). Audit `DISCONNECT`
logged. Any queued or in-flight PostTargets with that `connectionId` are
marked `SKIPPED` with reason "connection removed" (worker re-reads the
Connection at execution; null → SKIPPED; never crashes).

Revoked-on-platform detection: adapter call fails with AUTH error →
mark `Connection.status = REVOKED`, `PostTarget.status = FAILED` with
hint "Reconnect this platform" + `errorClass = AUTH`.

**Acceptance**
- After disconnect, any future `POST /api/postcards/:id/publish` that
  includes that platform → 400 with `invalidPlatforms: [<platform>]`.
- DB has zero residual `Connection` rows for that user+platform.
- Audit `DISCONNECT` row exists with `userId`, `platform`, timestamp.
- In-flight target with disconnected platform → SKIPPED, error
  message "connection removed before publish".
- Auth-failure detection: worker calls adapter, gets AUTH class
  failure → Connection REVOKED, target FAILED with reconnect hint.

**Tests**
- Unit: `disconnectConnection` service deletes row + audit logs.
- Integration: DELETE `/api/connections/:platform` → 204; subsequent
  publish with that platform → 400 `invalidPlatforms`; in-flight target
  → SKIPPED.
- Integration: simulate AUTH failure in adapter → Connection REVOKED,
  PostTarget FAILED.

**References**
- `src/app/api/connections/[platform]/route.ts` (DELETE)
- `src/server/services/connections.ts`
- `src/workers/publish-worker.ts` (re-read Connection at execution)

---

### FR-011 Format Engine (pure)

**Spec**
Pure functions: `format<Platform>(postCard, profile, options) →
FormattedPayload`. Input: `PostCard` + `Profile` + per-platform
options (e.g., `subreddit` for Reddit). Output: platform-specific
payload (string / embed / markdown / HTML).

### Output rules per platform

| Platform | Char limit | Body format | Tags | URL | Notes |
|---|---|---|---|---|---|
| X (Twitter) | ≤280 graphemes | plain text | `#hashtags` appended if room; each tag counts as text | URL counts as 23 chars regardless of length | truncate: description → summary → ellipsis before link |
| LinkedIn | ≤3000 | plain text, line breaks preserved | ≤3 hashtags on own line | link on own line | no markdown rendering |
| Reddit | title ≤300 + body unlimited | markdown body (uses description verbatim-ish) | n/a | n/a | subreddit required in options |
| Discord | embed title ≤256, description ≤4096 | embed (title, description, fields) | n/a | fields include tech stack + links | single embed per post |
| Dev.to | article: title + body markdown | markdown | ≤4 tags in front-matter | n/a | body = description + summary |
| Hashnode | article: title + body markdown | markdown | publication optional | n/a | body = description + summary |
| Telegram | ≤4096 HTML | HTML message | `#hashtags` line at end | title links to repoUrl/liveUrl | parseMode = HTML |
| Bluesky | ≤300 graphemes + external link facet | plain text + facet | n/a | external facet on URL | graphemes, not chars |

### Truncation strategy (uniform across platforms)

1. **Never truncate title** — title is the user's headline.
2. Truncate **description** first (the longest field).
3. If still over limit, truncate **summary**.
4. Always reserve room for the primary link (`repoUrl` or `liveUrl`)
   and an ellipsis marker (`…`) before it.
5. Title, link, and ellipsis are mandatory; description and summary
   are flexible.
6. **Tags**: append `#techTag` for X / LinkedIn / Telegram only if
   room remains after the truncated body + link + ellipsis. Skip tags
   if no room; never exceed the limit.

### Determinism

- Same input → identical output. Always.
- No `Date.now()`, no `Math.random()`, no `new Date()` inside
  formatters.
- All "current time" needs (e.g., Dev.to front-matter `published:`
  field) are passed in as input by the worker, not computed inside the
  formatter.

**Acceptance**
- Golden-file tests per platform: a fixed input → a fixed expected
  output. Stored in `tests/unit/formatters/__fixtures__/`.
- Property test: for randomized inputs (fuzz with fast-check), output
  length ≤ limit for every platform.
- Determinism test: same input called 100 times → identical output
  byte-for-byte.
- Grapheme counting: X / Bluesky output respects grapheme count, not
  code-unit count (test with emoji + ZWJ sequences).
- Truncation strategy test: a description that's exactly the limit
  length fits; +1 char triggers truncation with ellipsis + link.

**Tests**
- Unit (`src/lib/formatters/*.test.ts`): golden files + edge cases
  (empty techStack, very long description, emoji, multibyte).
- Property (`src/lib/formatters/property.test.ts`): randomized inputs,
  assert length ≤ limit for all 8 platforms.
- Determinism (`src/lib/formatters/determinism.test.ts`): 100x same
  input → identical output.
- Integration (`/api/postcards/:id/preview`): live preview endpoint
  returns formatted output + char count + limit.

**References**
- `src/lib/formatters/index.ts` (registry: `formatFor(platform,
  input)`)
- `src/lib/formatters/{reddit,discord,devto,telegram,bluesky,
  hashnode,twitter,linkedin}.ts`
- `src/app/api/postcards/[id]/preview/route.ts`
- `tests/unit/formatters/__fixtures__/` (golden files)

---

### FR-012 Amplify (one-click cross-post)

**Spec**
`POST /api/postcards/:id/publish` with body:
```json
{
  "platforms": [
    { "platform": "REDDIT", "options": { "subreddit": "sideproject" } },
    { "platform": "DISCORD" },
    { "platform": "DEVTO" }
  ],
  "requestId": "uuid-v4-client-generated"
}
```

Server validates:
1. Auth (session).
2. Ownership (`postCard.userId === session.user.id`).
3. Every requested platform has that user's `ACTIVE` Connection. If
   any platform is missing or not ACTIVE → 400 with `invalidPlatforms:
   [...]` listing which to connect.
4. (X only) `QuotaUsage` for current month < `X_MONTHLY_POST_BUDGET`
   (FR-018). If over budget → X target SKIPPED at creation time with
   message "X quota for this month is used"; other targets proceed
   normally.
5. `requestId` unique: if it already exists → 409 `DUPLICATE_REQUEST`
   with the existing Post id (idempotency).

Then in a transaction:
1. Create `Post` (id, userId, postCardId, requestId).
2. Create one `PostTarget` per platform with status `QUEUED`, options,
   connectionId, attempts=0.
3. Enqueue one BullMQ job per target with the targetId.

Response 201:
```json
{
  "post": {
    "id": "post-id",
    "targets": [
      { "id": "target-id", "platform": "REDDIT", "status": "QUEUED" },
      ...
    ]
  }
}
```

UI polls `GET /api/posts/:id` every 3s until all targets terminal
(`SUCCESS`, `FAILED`, `SKIPPED`). Polling aborts on unmount; max 5 min.

**Partial-success semantics**: each target is independent. One
adapter failing never blocks others. Each target has its own status
transition and its own retry budget.

**Acceptance**
- E2E with mocked adapters: N targets created, all terminal within
  60s, permalinks stored on SUCCESS.
- Forced failure of one adapter does not affect others (adapter call
  counts asserted in test).
- Double-click publish (two POSTs with same `requestId`) → ONE Post
  created; second response returns the existing Post with `409
  DUPLICATE_REQUEST`.
- Publish to a Post Card owned by another user → 403.
- Publish to a Post Card that doesn't exist → 404.
- Publish with no platforms → 400 `VALIDATION_ERROR` with
  `fieldErrors.platforms`.

**Tests**
- Integration (`tests/integration/publish.test.ts`): happy path with
  3 mocked adapters; partial failure isolation (adapter A throws,
  adapters B and C still SUCCESS, assert call counts); idempotency
  via `requestId`; ownership 403; unconfigured platform 400.
- E2E (T-15): publish screen → Amplify button → status board flips
  to terminal → history shows permalinks (mocked adapters).
- Property: random platform combinations, assert each target ends in
  a terminal state within 5s with mocked adapters.

**References**
- `src/app/api/postcards/[id]/publish/route.ts`
- `src/server/services/publish.ts`
- `src/lib/queue/setup.ts`, `src/lib/queue/workers.ts`
- `src/workers/publish-worker.ts`

---

### FR-013 Retry

**Spec**
Retry a `FAILED` target only. `POST /api/posts/:id/targets/:targetId/
retry`:
1. Validate: target status must be `FAILED`; `attempts < 3`; post
   ownership.
2. Increment `attempts`. If `attempts` reaches 3 → 409 `MAX_RETRIES`.
3. Re-enqueue the BullMQ job for that single target. Other targets
   are NOT re-enqueued (assert call counts in test).
4. If the failure class was `AUTH` → 409 with hint "Reconnect this
   platform first" (retry won't help; user needs to re-auth).

**Acceptance**
- Retry on `FAILED` target → 200; new BullMQ job enqueued; attempts
  incremented.
- Retry on `SUCCESS` target → 409 `NOT_FAILED`.
- Retry on `SKIPPED` target → 409 `NOT_FAILED` (skipped is terminal
  and not retried; user can manually re-publish).
- Retry on `QUEUED` / `PUBLISHING` target → 409 `NOT_FAILED`.
- Retry when `attempts >= 3` → 409 `MAX_RETRIES`.
- Retry on `AUTH`-class failure → 409 with reconnect hint.
- SUCCESS targets' adapters are NEVER called on retry of a sibling
  (call-count assertion in integration test).

**Tests**
- Unit: retry service logic, attempts counter, state guards.
- Integration: each guard path returns the right 409; happy path
  re-enqueues; AUTH-class hint returned.
- E2E (T-16): forced adapter failure → FAILED chip → Retry button →
  SUCCESS; assert SUCCESS target's adapter NOT called again.

**References**
- `src/app/api/posts/[id]/targets/[targetId]/retry/route.ts`
- `src/server/services/publish.ts` → `retryTarget`
- `src/workers/publish-worker.ts`

---

### FR-014 History Dashboard

**Spec**
Paginated (20/page) list of Posts with per-target status chips,
permalinks, timestamps. Filters: `platform`, `status`. Sort: newest
first.

`GET /api/posts?page=1&platform=REDDIT&status=SUCCESS` →
```json
{
  "items": [
    {
      "id": "post-id",
      "createdAt": "2025-01-15T10:30:00Z",
      "postCard": { "id": "card-id", "title": "..." },
      "targets": [
        { "id": "t1", "platform": "REDDIT", "status": "SUCCESS",
          "platformPostUrl": "https://reddit.com/r/...", "attempts": 1 }
      ]
    }
  ],
  "total": 53,
  "page": 1
}
```

**Acceptance**
- 50+ seeded posts render without layout shift (skeleton during fetch).
- Filters work: `platform=REDDIT` returns only Posts with a Reddit
  target; `status=SUCCESS` returns only Posts with at least one
  SUCCESS target.
- Pagination: page 1 has 20, page 2 has 20, page 3 has 10 (for 50).
- Empty state: "No posts yet → amplify your first post card".
- Cross-user: user B never sees user A's posts (owner scope enforced).

**Tests**
- Unit: query builder for filters, pagination math.
- Integration: 50 seeded posts → list returns 20; filters applied
  correctly; cross-user isolation.
- E2E (T-16): history page renders after publish.

**References**
- `src/app/api/posts/route.ts`
- `src/app/dashboard/history/page.tsx`
- `src/server/services/publish.ts` → `listPosts`

---

### FR-015 Trust & Security Panel

**Spec**
Settings → Security & Connections tab. Per-connection display:
- Platform (icon + name)
- Handle / username
- Scopes granted (OAuth platforms only; `[]` for non-OAuth)
- `connectedAt` (date)
- `lastUsedAt` (date of last publish attempt)
- `lastValidatedAt` (date of last successful adapter call)
- Big Disconnect button (confirm dialog)

Static "How we protect you" section (copy verbatim from
`12-TRUST-COPY.md` §2).

Danger zone:
- **Export data** → `GET /api/account/export` → JSON of all user data
  (PostCards, Posts, Connections metadata WITHOUT ciphertext, Profile,
  AuditLogs) → download.
- **Delete account** → typed confirmation "DELETE" → `DELETE
  /api/account` → cascades all tables + audit `ACCOUNT_DELETE` →
  logout + redirect to landing.

**Acceptance**
- Live Disconnect works and disappears from checklist (real-time
  update without page refresh).
- Account deletion test: zero residual rows across all user tables
  (`User`, `Profile`, `PostCard`, `Connection`, `Post`, `PostTarget`,
  `AuditLog` for that userId).
- Export JSON contains everything except `credentialsCipher` values
  (those are stripped; the `platform` / `username` / `connectedAt`
  metadata is preserved).
- Audit `ACCOUNT_DELETE` row exists with `userId` (kept for security
  forensics) — but the User row is gone.

**Tests**
- Integration: delete account → assert zero rows for that userId in
  every table; audit `ACCOUNT_DELETE` exists.
- Integration: export → JSON contains expected keys; no ciphertext
  patterns present.
- E2E (T-19): settings → disconnect → checklist updates → delete
  account (typed confirm) → redirect to landing.

**References**
- `src/app/dashboard/settings/page.tsx` (Security & Connections tab)
- `src/app/api/account/route.ts` (DELETE)
- `src/app/api/account/export/route.ts` (GET)
- `src/server/services/account.ts`

---

### FR-016 Rate Limiting (basic)

**Spec**
Redis-backed counters (BullMQ-compatible Redis client):
- Global per-user: 100 req/min (sliding window).
- Auth endpoints (`/api/auth/*`, `/api/oauth/*`): 10 req/min per IP.
- Publish endpoint (`/api/postcards/:id/publish`): 10 req/min per user
  (one Amplify every 6 sec max — prevent runaway).

Response on limit hit: 429 `RATE_LIMITED` with `Retry-After` header
(seconds until next allowed request).

**Acceptance**
- Burst test: 11 rapid POSTs to `/api/auth/login` with wrong password
  → first 10 return 401, 11th returns 429 with `Retry-After`.
- Normal flow never hits the limit (assert in E2E).
- Rate-limit counter resets after window passes.

**Tests**
- Unit: rate-limit middleware logic.
- Integration: burst test on auth + publish + global.
- E2E: doesn't trigger during normal use.

**References**
- `src/lib/middleware/rate-limit.ts`
- `src/lib/queue/redis.ts`
- `src/lib/config/limits.ts` → `RATE_LIMITS`

---

### FR-017 Audit Logging

**Spec**
`AuditLog` rows for: `LOGIN`, `LOGIN_FAIL`, `CONNECT`, `DISCONNECT`,
`PUBLISH`, `RETRY`, `TOKEN_FAIL`, `ACCOUNT_DELETE`.

Fields: `id`, `userId` (nullable — `LOGIN_FAIL` may have null userId),
`action`, `platform` (nullable), `ip`, `userAgent`, `metadata` (JSON,
nullable), `createdAt`.

NEVER log credentials, decrypted content, full request bodies for
credential routes, or anything matching the secret regex in
`16-OBSERVABILITY.md` §3.

`metadata` examples:
- `LOGIN`: `{}` (no metadata)
- `PUBLISH`: `{ postId, platforms: ["REDDIT","DISCORD"] }`
- `CONNECT`: `{ platform, username }`
- `TOKEN_FAIL`: `{ platform, reason: "BAD_STATE" }`
- `ACCOUNT_DELETE`: `{}`

**Acceptance**
- Each publish produces an audit row (one per Post, not one per target).
- Each retry produces an audit row.
- Each connect / disconnect produces an audit row.
- Log scanner test (`scripts/scan-logs.sh`) greps AuditLog.metadata
  JSON for token patterns → zero matches.
- Account deletion keeps the `ACCOUNT_DELETE` AuditLog row (with the
  now-deleted userId) for security forensics.

**Tests**
- Unit: audit service `log(action, fields)` writes correct row.
- Integration: each action produces an audit row; metadata shape
  correct; scanner test green.
- E2E: login → publish → audit rows exist for both.

**References**
- `src/server/services/audit.ts`
- `src/lib/audit/actions.ts` (enum + helpers)
- `scripts/scan-logs.sh`

---

### FR-018 X Quota Guard (config-driven)

**Spec**
Config: `X_MONTHLY_POST_BUDGET` env var (default 450, under free tier
1500-cap to leave headroom). Counter per calendar month in
`QuotaUsage` table.

On publish including X:
1. Read `QuotaUsage` for `(platform: TWITTER, yearMonth: "YYYY-MM")`.
2. If `used >= budget` → X target created with status `SKIPPED`,
   `errorClass: "QUOTA"`, error message "X quota for this month is
   used — other platforms unaffected". X target NOT enqueued.
3. Otherwise: increment `used` in the same transaction as Post+target
   creation. If increment fails (race) → retry once; if still fails →
   X target SKIPPED with "quota check failed".

Budget resets on the first of each month (new `yearMonth` row auto-
created on first publish that month).

**Acceptance**
- With `X_MONTHLY_POST_BUDGET=2` test config: 1st X post → SUCCESS; 2nd
  → SUCCESS; 3rd → SKIPPED with quota message; other platforms in the
  same publish → SUCCESS.
- Month boundary: at month-end, `used` count for old month is
  preserved; new month starts at 0; first publish in new month →
  SUCCESS (not SKIPPED for old month's count).
- Race condition: two concurrent publishes both checking quota → only
  one succeeds in incrementing; the other sees updated count and
  either succeeds (if under budget) or SKIPPED (if over).

**Tests**
- Unit: quota check + increment logic.
- Integration: budget=2 test sequence; month-boundary test; race
  condition (two concurrent publishes).
- E2E: skipped target renders correctly in status board.

**References**
- `src/lib/quota/x-monthly.ts`
- `src/lib/config/platforms.ts` → `X_MONTHLY_POST_BUDGET`
- `src/server/services/publish.ts` (quota check before enqueue)

---

## Non-Functional Requirements

### NFR-001 Security

- No platform passwords ever (OAuth or user-generated credentials only).
- PKCE for OAuth flows; AES-256-GCM vault for at-rest credentials.
- HTTPS only in production (HSTS, 1 year, include subdomains).
- Security headers: CSP (allow `self` + platform OAuth redirect
  domains), `X-Frame-Options: DENY`, `X-Content-Type-Options:
  nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- Server-side Zod on every input. Markdown rendered sanitized (no
  raw HTML).
- bcrypt cost ≥10 for password hashing.
- NextAuth secrets from env; no secret in `.env.example` values (use
  placeholders like `generate-with-openssl-rand-base64-32`).
- OWASP Top 10 checklist review before final demo (see
  `07-SECURITY-ACCESS.md` §6).

### NFR-002 Performance

- p95 internal API response < 500ms (excluding platform API calls).
- Publish dispatch (request → all BullMQ jobs enqueued) < 2s.
- Lighthouse ≥90 on dashboard (performance + a11y + best-practice).
- Status polling ≤3s interval; abort on unmount; max 5 min total.
- Image upload < 5s for 5MB file.

### NFR-003 Reliability

- BullMQ jobs: 3 attempts max, exponential backoff (10s / 60s / 300s)
  for `RATE` and `NETWORK` error classes only. `AUTH`, `VALIDATION`,
  `QUOTA` are not retried (they're terminal).
- Durable across Redis restart: BullMQ persisted jobs survive Redis
  crash + restart (with AOF persistence enabled in docker-compose).
- Worker idempotency: if a job runs twice (after Redis restart), the
  second run is a no-op (target status check).

### NFR-004 Privacy

- Full account wipe on deletion: cascades `Profile`, `PostCard`,
  `Connection`, `Post`, `PostTarget`; AuditLog `ACCOUNT_DELETE` row
  kept with userId for forensics (but User row gone).
- User data export JSON: all user data except `credentialsCipher`
  values; `Connection` rows show metadata only.
- Right to be forgotten: deletion is irreversible; no soft-delete.

### NFR-005 Maintainability

- Adding a platform = 1 adapter (in `src/lib/platforms/<platform>/`)
  + 1 formatter (in `src/lib/formatters/<platform>.ts`) + 1 registry
  entry (in `src/lib/platforms/registry.ts`) + 1 config row (in
  `src/lib/config/platforms.ts`). Nothing else changes.
- Each adapter has the same interface; tests mock at the adapter
  boundary.
- Formatters are pure; tests are golden-file + property.

### NFR-006 Accessibility

- Labels on all inputs (`<label for=...>` or `aria-label`).
- Keyboard navigable: every interactive element reachable + operable
  via keyboard.
- Visible focus states: `:focus-visible` rings on all interactive
  elements.
- AA contrast (4.5:1 text, 3:1 large text + UI components).
- Toasts announce via `aria-live="polite"`.
- Status chips have `aria-label` (e.g., "Status: success").
- `axe-core` clean in Playwright tests for every screen.

### NFR-007 Internationalization (minimal for MVP)

- All UI strings in English (no i18n framework in MVP).
- All user-facing text centralized in `src/lib/copy.ts` for future
  i18n migration (post-MVP).
- Date / time formats use `Intl.DateTimeFormat` with the user's
  locale (default `en-IN` for the target audience).
- Timezone: UTC stored in DB; display in user's local timezone (via
  `Intl`).

### NFR-008 Browser support

- Latest Chrome, Firefox, Safari, Edge (last 2 versions).
- No IE support.
- Mobile Safari + Chrome (responsive design).

---

> End of SRS. Next: `03-ARCHITECTURE.md` — system design, flows, adapter
> contracts, environment, platform config (single source of truth for
> char limits / retries / quotas).
