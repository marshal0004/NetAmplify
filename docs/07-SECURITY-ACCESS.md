# NetAmplify — Security & Access (v1.0)

> Status: LOCKED for MVP. Companion docs: `02-SRS.md` (FR-009 vault,
> FR-010 disconnect), `03-ARCHITECTURE.md` (Flows B-D, env), `04-DATABASE.md`
> (rules 1–5), `12-TRUST-COPY.md` (user-facing), `16-OBSERVABILITY.md`
> (log scanner).

---

## 1. Authentication

### 1.1 App account

- Email + password (bcrypt cost ≥10).
- NextAuth.js v4 (credentials provider) — sessions, CSRF, cookie
  management handled.
- Session duration: 7 days (rolling refresh on activity).
- Cookie: `next-auth.session-token`, HttpOnly, SameSite=Lax, Secure
  in prod.

### 1.2 Password reset

- User requests reset: `POST /api/auth/reset-request { email }`.
- Server ALWAYS returns 204 (no user enumeration). Audit `LOGIN_FAIL`
  if email not found (for monitoring).
- Email sent via Resend with a 1-hour single-use token (32 random
  bytes, base64url, stored hashed in `PasswordReset` table).
- User confirms: `POST /api/auth/reset-confirm { token, newPassword }`.
- On success: update passwordHash, delete the token row, invalidate
  all existing sessions for that user.
- On failure (token not found / expired / used): 400 `INVALID_TOKEN`.
- Rate-limited: 3 reset requests per email per hour.

### 1.3 What we explicitly DON'T do in MVP

- Google OAuth (cut from MVP — adds Google API console setup, OAuth
  flow maintenance, and a "what if Google rejects our app review"
  scenario).
- Email verification on signup (we don't verify the email at signup;
  we send the reset email to whatever they typed). MVP risk: fake
  emails can sign up but can't reset (no email to receive the link).
  Trade-off acceptable for v1; add email verification post-MVP.
- 2FA / TOTP (post-MVP).
- Passkeys / WebAuthn (post-MVP).
- "Remember this device" emails (post-MVP).

---

## 2. Roles & Permissions

### 2.1 MVP roles

MVP has **ONE role**: `USER` (any authenticated account).

**Rules**:
- A `USER` sees / edits ONLY their own `Profile`, `PostCard`s,
  `Connection`s, `Post`s, and their own `AuditLog` rows.
- Cross-user access MUST return 404 (preferred) or 403 (if explicitly
  authorized by some future role). 404 is preferred to avoid leaking
  existence.
- Anonymous: landing + login / signup / reset only. Everything else
  → 302 to `/login?returnTo=<path>`.

### 2.2 ADMIN role (deferred)

- The schema leaves room for a future `role` column on `User`
  (`@default('USER')`), but **NO admin UI exists in MVP**.
- Nobody but the DBA touches prod data directly. MVP has no admin
  actions exposed through the app.

### 2.3 Permission matrix

| Action | Anonymous | USER (own) | USER (other's) |
|---|---|---|---|
| View landing | ✓ | ✓ | ✓ |
| Sign up / log in | ✓ | ✓ | ✓ |
| View own dashboard | ✗ (→ login) | ✓ | ✗ (→ 404) |
| View own PostCard | ✗ | ✓ | ✗ (→ 404) |
| Edit own PostCard | ✗ | ✓ | ✗ (→ 404) |
| Connect platform | ✗ | ✓ | ✗ (n/a) |
| Disconnect platform | ✗ | ✓ (own) | ✗ |
| Amplify own PostCard | ✗ | ✓ | ✗ (→ 404) |
| Retry own PostTarget | ✗ | ✓ | ✗ (→ 404) |
| Delete own account | ✗ | ✓ | ✗ |
| View audit logs | ✗ | ✓ (own) | ✗ |

---

## 3. Data Isolation Rules (RLS-equivalent, enforced in app layer)

### R1 — Every Prisma read/write of user-owned models includes `userId` from the session

The `:id` in a URL locates the row; ownership comes from the session,
never from the request body or params.

```typescript
// WRONG (leaks data across users):
const card = await prisma.postCard.findUnique({ where: { id } });

// RIGHT (owner-scoped):
const card = await prisma.postCard.findUnique({
  where: { id, userId: session.user.id },
});
if (!card) return notFound(); // 404, not 403 — never leak existence
```

**Enforcement**:
- Code review checklist item.
- Per-resource integration test: user B calls user A's endpoint → 404.
- (Stretch) ESLint custom rule forbidding `prisma.<userModel>.find*`
  without `userId` in `where`.

### R2 — Connection credentials: selected ONLY inside TokenVault consumers

- API responses build from a whitelist projection — never `select *`
  on `Connection`.
- The `connectionsService.list()` function returns only:
  `platform, type, username, status, configured, connectedAt,
  lastUsedAt, scopes`.
- The `credentialsCipher` column is NEVER selected by services. Only
  `src/workers/publish-worker.ts` and
  `src/server/services/connections.ts` (during validation) read it,
  via `prisma.connection.findUnique({ select: { credentialsCipher:
  true, ... } })` and immediately pass to `TokenVault.decrypt`.

### R3 — Publish validates ownership + ACTIVE connections

- `postCard.userId === session.user.id` (else 404).
- For every requested platform, that user's `Connection` with
  `status === ACTIVE` exists (else 400 with `invalidPlatforms`).
- This validation is server-side, on every publish. No trusting the
  client.

### R4 — Webhook / Discord / Telegram validation calls happen server-side only

- The browser never receives echoed credentials back.
- After `POST /api/connections/discord { webhookUrl }`, the response
  is `{ channelName, guildName }` — never the webhookUrl.
- After `POST /api/connections/telegram { botToken, channel }`, the
  response is `{ channelTitle }` — never the bot token.

### R5 — Rate limits per FR-016 (Redis counters)

- 100 req/min/user global.
- 10 req/min/IP on `/api/auth/*` and `/api/oauth/*`.
- 10 req/min/user on `/api/postcards/:id/publish`.
- 429 with `Retry-After` header.

### R6 — OAuth state cookie: httpOnly, sameSite=lax, signed, 10-min TTL, single-use

- Set on `/api/oauth/:platform/start`.
- Validated on `/api/oauth/:platform/callback`.
- Deleted on read (single-use).
- Signed with `NEXTAUTH_SECRET` (HMAC-SHA256).
- 10-min TTL — short enough to limit replay, long enough for a user
  to log in to the platform + consent.

---

## 4. Error Handling Matrix (exhaustive — UI must implement each)

| Failure | HTTP | User sees | Audit |
|---|---|---|---|
| Invalid form input | 400 | inline field errors below each field | — |
| Not logged in | 401 | redirect to `/login?returnTo=<path>` | — |
| Not owner | 404 (preferred) or 403 | "Not found" + back link | — |
| Missing resource | 404 | "Not found" + back link | — |
| Duplicate publish (same `requestId`) | 409 | "Already publishing this card" + link to status board | — |
| OAuth state mismatch | 400 | "Security check failed — please reconnect" | `TOKEN_FAIL` |
| OAuth state cookie missing/expired | 400 | "Security check failed — try again" | `TOKEN_FAIL` |
| OAuth code exchange failed (platform 4xx) | 502 | "{Platform} didn't complete the handshake — try again" | `TOKEN_FAIL` |
| Invalid Dev.to / Hashnode API key | 400 | "Key rejected by {Platform} — check and re-paste" (platform's error surfaced verbatim) | — |
| Invalid Discord webhook URL | 400 | "Discord rejected this webhook — check the URL or recreate it in your server settings" | — |
| Invalid Telegram bot token | 400 | "Bot token invalid — get a fresh one from @BotFather" (reason: `BAD_TOKEN`) | — |
| Telegram bot not admin | 400 | "Make your bot an admin of the channel first" (reason: `NOT_ADMIN`) | — |
| Telegram channel not found | 400 | "Channel not found — check the @username" (reason: `BAD_CHANNEL`) | — |
| Invalid Bluesky handle / app password | 400 | "Bluesky rejected these credentials — create the app password in Settings → App passwords" | — |
| Platform unconfigured (Tier B) | 400 | (UI shows "Coming soon — setup pending" without calling API) | — |
| Publish AUTH failure | — | target `FAILED` + "Reconnect this platform" (Connection → `REVOKED`) | `PUBLISH` (one per post) |
| Publish RATE failure (transient) | — | "Platform is rate-limiting — auto-retrying" | — |
| Publish RATE failure (terminal, 3 attempts) | — | "Platform is rate-limiting — try later" + Retry button | — |
| Publish VALIDATION failure | — | platform's own message verbatim (e.g., "Subreddit banned") | — |
| Publish NETWORK failure (transient) | — | "Network issue — auto-retrying" | — |
| Publish NETWORK failure (terminal) | — | "Network issue — try again" + Retry button | — |
| X quota exhausted | — | target `SKIPPED` + "X quota for this month is used — other platforms unaffected" | — |
| Network offline (client-side) | — | toast "You're offline — actions will fail" | — |
| Session expired mid-action | 401 | redirect to `/login?returnTo=<current path>` | — |
| Redis / queue down | 500 | "Publish queued but delayed — check History" (job is durable, will run when Redis back) | — |
| DB down | 500 | "We're having trouble — try again" + sentry alert | — |
| Unhandled server error | 500 | "Something went wrong — we've been notified" + sentry alert | — |
| Rate limit hit | 429 | "Too many requests — wait {Retry-After}s" | — |
| Email already registered (signup) | 409 | "Email already registered — log in?" with link | — |
| Reset token invalid / expired | 400 | "Reset link expired — request a new one" | — |

---

## 5. Edge Cases (must be handled + tested)

### 5.1 Content edge cases

- **Empty `techStack` or >10 tags**: block with message "Add 1–10 tech
  tags."
- **Title exactly at limit (120)**: allowed; +1 char → 400.
- **Description with emoji / unicode / ZWJ sequences**: formatter
  counts graphemes for X (280) and Bluesky (300). Test with `"👨‍👩‍👧"` (a
  family ZWJ sequence) — must count as 1 grapheme, not 7 code units.
- **Description >5000 chars**: 400 with field error.
- **Massive markdown description** (just under 5000): formatter
  truncation strategy (FR-011) guarantees limits per platform;
  preview shows the truncated result truthfully.

### 5.2 Concurrency / race edge cases

- **Double-click Amplify**: idempotency via `requestId` → one Post.
  Second click sees `409 DUPLICATE_REQUEST` → UI shows "Already
  publishing — view status" link.
- **Two tabs Amplify same card**: same as double-click — first POST
  wins; second gets 409 with link to existing post.
- **User disconnects platform between click and worker run**: worker
  re-reads `Connection` at execution; null → SKIPPED "connection
  removed". Never crashes.
- **Token revoked on platform between posts**: AUTH class failure →
  Connection REVOKED badge in UI; target FAILED with reconnect hint.
- **Same platform reconnected with different account**: upsert; old
  ciphertext overwritten; `platformUsername` updated; audit `CONNECT`
  (not `DISCONNECT`).
- **Race on X quota increment**: two concurrent publishes both
  checking `QuotaUsage`. Use `prisma.$transaction` with row-level lock
  (`SELECT ... FOR UPDATE` via raw SQL or `update` with conditional
  `where: { used: { lt: budget } }`). One succeeds in incrementing;
  the other sees updated count and either succeeds (if still under
  budget) or SKIPPED.

### 5.3 Platform-specific edge cases

- **Reddit subreddit invalid / banned / private**: adapter surfaces
  platform's VALIDATION error verbatim ("This subreddit is private"
  / "Subreddit not found"). PostTarget FAILED.
- **Discord webhook deleted after connect**: AUTH failure on next
  publish → Connection REVOKED; user sees "Reconnect this platform"
  hint.
- **Telegram bot removed from channel (admin revoked)**: `getChat`
  returns 403 → AUTH class failure → Connection REVOKED; user sees
  "Make your bot an admin of the channel first".
- **Bluesky app password revoked**: `createSession` would have
  succeeded at connect time, but later publishes fail with 401 → AUTH
  → Connection REVOKED.
- **Dev.to API key rate-limited during validation**: 429 → RATE class
  failure at connect time → user sees "Dev.to is rate-limiting — try
  again in a minute".

### 5.4 Scale / performance edge cases

- **50+ posts history**: pagination 20/page; no layout shift (skeleton
  during fetch; same row heights).
- **100+ post cards**: pagination 12/page on dashboard; same.
- **Slow 3G**: skeletons everywhere; publish polling degrades
  gracefully (3s intervals on 3G are fine).
- **Image upload > 5MB**: client-side rejection (no API call);
  server-side rejection (defensive, magic-byte check) if client
  bypassed.

### 5.5 Account lifecycle edge cases

- **Account deleted while jobs queued**: workers check `User` existence
  at execution; null user → SKIPPED "user deleted"; audit `ACCOUNT_DELETE`
  already logged.
- **Account deleted with active sessions**: server invalidates
  sessions (delete session rows if using DB strategy, or rely on JWT
  expiry if using JWT strategy). We use NextAuth DB sessions in MVP,
  so deletion cascades.
- **Re-activate a deleted email**: signup with same email after
  deletion → fresh User row (no soft-delete in MVP, so the old row is
  gone; new row has new id).

### 5.6 OAuth edge cases

- **OAuth state cookie expired**: 400 `BAD_STATE` on callback.
- **OAuth state mismatch (tampering)**: 400 `BAD_STATE`, audit
  `TOKEN_FAIL`, no Connection row.
- **OAuth code reused (replay)**: platform API rejects (code is
  single-use); we surface 502 `OAUTH_EXCHANGE_FAILED`.
- **OAuth redirect URI mismatch**: platform rejects before reaching
  us; user sees platform's error.
- **User denies consent on platform**: platform redirects back with
  `?error=access_denied` (no `code`); our callback handles this →
  user sees "Connection cancelled — try again if you'd like."

---

## 6. Threat Checklist (review before final demo)

### 6.1 OWASP Top 10 mapping

| OWASP risk | Mitigation in NetAmplify | Test |
|---|---|---|
| A01: Broken Access Control | R1–R4 above; 404 over 403; per-resource 403 test | Integration: cross-user 403 test per resource |
| A02: Cryptographic Failures | AES-256-GCM vault; bcrypt ≥10; HTTPS in prod; HSTS; no plaintext credentials anywhere | CI scanner test (DB dump + logs + responses) |
| A03: Injection | Prisma parameterized queries (no raw SQL); Zod on every input; markdown rendered sanitized (no raw HTML) | Unit: malformed markdown doesn't render script tags |
| A04: Insecure Design | Threat-model each FR (this doc); fail-fast on missing env; defense-in-depth (R1–R6) | Review checklist |
| A05: Security Misconfiguration | CSP allowing only `self` + platform OAuth redirect domains; HSTS; `X-Frame-Options: DENY`; `nosniff`; no default credentials; `.env.example` has placeholders | `next.config.mjs` headers; CI asserts |
| A06: Vulnerable & Outdated Components | `npm audit` in CI; Dependabot alerts; Renovate (stretch) | CI: `npm audit --production` zero high/critical |
| A07: Identification & Auth Failures | NextAuth sessions; bcrypt ≥10; no user enumeration on reset; rate limit auth 10/min/IP | Integration: reset returns 204 always |
| A08: Software & Data Integrity Failures | Lockfile committed; no `--no-verify` bypass; signed commits (stretch) | Pre-commit hook |
| A09: Security Logging & Monitoring Failures | Audit log per FR-017; structured logs per `16-OBSERVABILITY.md`; log scanner in CI | Unit: each action produces audit row |
| A10: Server-Side Request Forgery | Platform URLs hardcoded in adapters (no user-controlled URL fetch); Discord webhook URL is the only user-supplied URL we fetch, and it's validated against a strict allowlist (`https://discord.com/api/webhooks/...`) | Unit: SSRF test for Discord webhook |

### 6.2 Pre-demo checklist (T-21)

- [ ] No credentials in logs (scanner test) / responses / client bundles
- [ ] CSP allowing only `self` + platform OAuth redirects; HSTS;
      frame-ancestors `'none'`
- [ ] Zod on every route; markdown rendered sanitized (no raw HTML)
- [ ] bcrypt ≥10; NextAuth secrets from env; no secret in
      `.env.example` values
- [ ] Dependency audit (`npm audit --production`) clean or justified
- [ ] DB dump grep test for token patterns in CI
- [ ] OAuth redirect URIs exact-match registered URIs in Reddit / X /
      LinkedIn app settings
- [ ] Rate limit works (burst test yields 429)
- [ ] Account deletion cascades everything; audit `ACCOUNT_DELETE`
      row kept
- [ ] Export JSON contains no credential ciphertext
- [ ] Lighthouse ≥90 (perf, a11y, best-practice)
- [ ] `axe-core` clean on every screen
- [ ] All FRs have at least one test (unit / integration / E2E)
- [ ] Manual smoke (Discord + Reddit real posts) — evidence in
      PROGRESS.md

### 6.3 Secrets management

- All secrets via env vars; no hardcoded secrets in code.
- `.env.example` has placeholders only (`generate-with-openssl-rand-base64-32`).
- `.env.local` is gitignored.
- Prod secrets in Vercel env / Doppler / AWS Secrets Manager (per
  `14-DEPLOYMENT.md`).
- Rotate `TOKEN_ENCRYPTION_KEY`: post-MVP (MVP: one key; rotation
  requires dual-key support in the vault).
- Rotate `NEXTAUTH_SECRET`: rotating invalidates all sessions —
  schedule for low-traffic window.

### 6.4 CSP (Content Security Policy)

```
default-src 'self';
script-src 'self' 'unsafe-inline';   /* Next.js needs unsafe-inline for
                                        dev; prod: nonce-based */
style-src 'self' 'unsafe-inline';    /* Tailwind needs unsafe-inline */
img-src 'self' data: https://*.githubusercontent.com https://res.cloudinary.com;
font-src 'self' data:;
connect-src 'self' https://oauth.reddit.com https://bsky.social;
frame-ancestors 'none';
form-action 'self';
base-uri 'self';
object-src 'none';
upgrade-insecure-requests;
```

Notes:
- `script-src 'unsafe-inline'` is required for Next.js dev mode; in
  prod, use nonce-based CSP (`script-src 'self' 'nonce-...'`).
- `connect-src` allows platform OAuth API hosts for any client-side
  fetches (we don't do any; this is defensive).
- `img-src` allows GitHub avatars (for OAuth identity display) and
  Cloudinary (for prod image uploads).
- `frame-ancestors 'none'` — no iframing our app anywhere.

### 6.5 Rate limit details

- **In-memory (MVP)**: Redis atomic INCR + EXPIRE.
- **Sliding window** (post-MVP): for MVP, fixed window per minute is
  fine.
- **Per-IP**: `rate-limit:<ip>:<minute>` → INCR → if >10 on auth,
  429. TTL 60s.
- **Per-user**: `rate-limit:user:<userId>:<minute>` → INCR → if >100
  global / >10 publish, 429. TTL 60s.
- **Retry-After**: seconds until the current minute window ends.

### 6.6 Input sanitization

- All inputs go through Zod (server-side). Zod rejects:
  - Strings too long / too short.
  - Invalid URLs (must be `https://` for URLs).
  - Invalid email format.
  - Invalid enums.
- Markdown description: stored as-is (sanitized on render via
  `react-markdown` + `remark-gfm` with NO raw HTML allowed).
  - `react-markdown` doesn't render raw HTML by default; we don't add
    `rehype-raw`. So `<script>` in markdown is shown as text, not
    rendered.
- User-supplied URLs (repoUrl, liveUrl, webhookUrl, etc.):
  - Zod `z.string().url()` ensures valid URL.
  - For Discord webhook: `startsWith('https://discord.com/api/webhooks/')`.
  - For GitHub: `startsWith('https://github.com/')`.
  - For portfolio: any `https://` URL.

### 6.7 Output sanitization

- API responses: never include `credentialsCipher`.
- Error messages: sanitized via `src/lib/errors/mapper.ts` — strip
  anything matching the secret regex, strip internal paths (e.g.,
  `src/server/services/...`), strip stack traces.
- Logs: structured JSON; never log raw request bodies for credential
  routes; never log decrypted content; scanner test in CI.

---

## 7. Security review process (per PR)

1. Author fills the per-PR security checklist (from §6.2):
   ```
   - [ ] No new `any` introduced
   - [ ] All new inputs Zod-validated
   - [ ] All new queries owner-scoped (or N/A — explain)
   - [ ] No credentials in new logs / responses
   - [ ] New components pass `axe-core` (if UI)
   - [ ] Tests cover new logic branches incl. error paths
   - [ ] Dependency change (if any): approved in PR description
   ```
2. Reviewer (human) verifies each box.
3. CI runs the scanner tests + lint + typecheck + unit + integration +
   build.
4. If any box unchecked OR any CI red: PR is NOT merged.

---

> End of security doc. Next: `08-CODING-STANDARDS.md` — mandatory
> code conventions with examples.
