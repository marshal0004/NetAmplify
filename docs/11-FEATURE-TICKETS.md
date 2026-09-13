# NetAmplify — Feature Ticket List

> Each ticket = one agent session. Paste the ticket + "follow
> CLAUDE.md; tests; Definition of Done; update PROGRESS.md; commit;
> STOP." into your AI coding agent.
>
> Companion docs: `10-ROADMAP.md` (week-by-week), `02-SRS.md` (FRs),
> `03-ARCHITECTURE.md` (folder structure), `08-CODING-STANDARDS.md`
> (DoD).

---

## Ticket format (every ticket has these fields)

```
T-<NN> <short-name> [<priority>] dep:<dependencies>
Description: ...
Files touched: ...
Acceptance criteria (AC):
  - ...
Tests required:
  - ...
Definition of Done (per CLAUDE.md §4):
  - [ ] Zero TS errors
  - [ ] Lint clean
  - [ ] Unit + integration + E2E (as applicable) pass
  - [ ] UI has loading + error + empty states (if UI)
  - [ ] Server-side Zod on every input
  - [ ] Ownership enforced (403 test) — if user-scoped
  - [ ] PROGRESS.md updated
  - [ ] Conventional commit `feat(T-NN): <subject>`
```

---

## Week 1 — Foundation (T-01…T-06)

### T-01 Scaffold & CI [MUST] dep: —

**Description**
Build the repo per `03-ARCHITECTURE.md` §5 folder structure:
- Next.js 14 (App Router) + TypeScript (strict, `noUncheckedIndexedAccess`).
- Tailwind CSS + shadcn/ui (install the components listed in `06-FRONTEND-SPEC.md` §8).
- Prisma init with the FULL schema from `04-DATABASE.md` (all 8 models + 4 enums).
- `docker-compose.yml` (dev: postgres:16 + redis:7) and `docker-compose.test.yml` (test: separate ports).
- ESLint (Next.js + strict + Tailwind plugin) + tsconfig strict.
- `src/lib/config/env.ts` typed env module (fail-fast at boot).
- `src/lib/config/platforms.ts` with the platform table from `03-ARCHITECTURE.md` §7.
- `src/lib/errors/codes.ts`, `src/lib/errors/envelope.ts`, `src/lib/errors/mapper.ts`.
- `src/app/api/health/route.ts` returning `{ db: "up", redis: "up" }` or 503.
- Landing page per `06-FRONTEND-SPEC.md` Screen 1 (static, no auth).
- `tests/setup.ts`, `vitest.config.ts`, `playwright.config.ts`, `eslint.config.mjs`.
- `.gitignore`, `.env.example` (placeholders only), `README.md` (quick start).
- `.github/workflows/ci.yml` per `09-TESTING-STRATEGY.md` §5 (lint → typecheck → unit → integration → build → e2e).

**Files touched**
- Root config: `package.json`, `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `eslint.config.mjs`, `docker-compose.yml`, `docker-compose.test.yml`, `.gitignore`, `.env.example`, `README.md`, `Dockerfile`.
- Prisma: `prisma/schema.prisma` (full schema from `04-DATABASE.md`).
- Source: `src/app/(marketing)/page.tsx` (landing), `src/app/layout.tsx`, `src/app/globals.css`, `src/app/api/health/route.ts`, `src/lib/config/env.ts`, `src/lib/config/platforms.ts`, `src/lib/errors/*`, `src/server/db.ts`, `src/server/redis.ts`.
- Tests: `tests/setup.ts`, `tests/integration/health.test.ts`.
- CI: `.github/workflows/ci.yml`.

**Acceptance criteria (AC)**
- `npm run dev` shows landing page at `localhost:3000` (hero + 3-step + platform row + trust blurb + footer).
- `GET /api/health` returns `{ db: "up", redis: "up" }` with docker-compose up.
- `npm run lint && npm run typecheck && npm run test && npm run build` all green.
- CI pipeline green on first PR.
- `grep -r ': any' src/ | wc -l` returns 0.
- `grep -r 'process\.env' src/ | grep -v 'src/lib/config/env.ts'` returns 0 (env accessed only via typed module).
- Folder structure matches `03-ARCHITECTURE.md` §5 exactly.
- `prisma migrate dev --name init` runs cleanly.
- `.env.example` has all env vars from `03-ARCHITECTURE.md` §6 with placeholder values (no real secrets).

**Tests required**
- Integration: `tests/integration/health.test.ts` — health returns up/up with docker-compose up, down/down with it down.

---

### T-02 Auth [MUST] dep:T-01

**Description**
NextAuth v4 credentials provider:
- `POST /api/auth/signup` — email + password (≥8, bcrypt cost 10) + name → 201 + auto-login.
- `GET/POST /api/auth/[...nextauth]` — NextAuth login/logout/session/csrf.
- `POST /api/auth/reset-request` — always 204 (no enumeration), email sent if account exists.
- `POST /api/auth/reset-confirm` — token + newPassword → 204 or 400 INVALID_TOKEN.
- `src/lib/auth/config.ts` (NextAuth options), `src/lib/auth/guards.ts` (requireSession).
- Middleware: redirect `/dashboard/**` to `/login?returnTo=<path>` if no session.
- Rate limit `/api/auth/*` at 10/min/IP (FR-016).
- `PasswordReset` table migration (id, userId, tokenHash, expiresAt, usedAt).

**Files touched**
- `src/lib/auth/config.ts`, `src/lib/auth/guards.ts`, `src/lib/auth/reset-token.ts`.
- `src/server/services/auth.ts`, `src/server/services/email.ts` (Resend wrapper).
- `src/app/api/auth/signup/route.ts`, `src/app/api/auth/reset-request/route.ts`, `src/app/api/auth/reset-confirm/route.ts`.
- `src/app/api/auth/[...nextauth]/route.ts`.
- `src/app/(auth)/login/page.tsx`, `src/app/(auth)/signup/page.tsx`, `src/app/(auth)/reset/page.tsx`.
- `src/components/forms/login-form.tsx`, `signup-form.tsx`, `reset-form.tsx`.
- `src/lib/middleware/rate-limit.ts`.
- `prisma/migrations/<ts>_add_password_reset_table/`.
- Tests: `tests/unit/services/auth.test.ts`, `tests/integration/auth.test.ts`, `tests/e2e/signup-flow.spec.ts`.

**Acceptance criteria (AC)**
- FR-001 acceptance: register → logout → login E2E passes; wrong password → inline error; unauth `/dashboard/**` → redirect `/login`.
- Reset request returns 204 always (no user enumeration — test with nonexistent email).
- Reset confirm with expired/used token → 400 INVALID_TOKEN.
- Rate limit: 11 rapid POSTs to `/api/auth/login` with wrong password → 10 return 401, 11th returns 429 with `Retry-After`.

**Tests required**
- Unit: bcrypt hash/compare, password strength validator, reset-token generator + validator.
- Integration: signup happy path, duplicate email → 409, login → 200, reset-request always 204, reset-confirm happy + expired.
- E2E: signup → profile (redirect) → logout → login.

---

### T-03 Profile [MUST] dep:T-02

**Description**
- `Profile` model (already in schema from T-01).
- `GET /api/profile` — returns session user's profile (joined with `User.name`).
- `PATCH /api/profile` — partial update, Zod shared.
- Settings form in `src/app/(dashboard)/dashboard/settings/page.tsx` (Profile tab).
- Zod schema in `src/lib/validation/schemas.ts` → `profilePatchSchema`.

**Files touched**
- `src/app/api/profile/route.ts`.
- `src/server/services/profile.ts`.
- `src/lib/validation/schemas.ts` (add `profilePatchSchema`).
- `src/app/(dashboard)/dashboard/settings/page.tsx` (Profile tab only; other tabs are T-19).
- `src/components/forms/profile-form.tsx`.
- Tests: `tests/unit/services/profile.test.ts`, `tests/integration/profile.test.ts`, `tests/e2e/profile-flow.spec.ts` (part of Week-1 E2E T-06).

**Acceptance criteria (AC)**
- FR-002 acceptance: persists across sessions; invalid URL → field-level server error; graduationYear outside 2015–2035 → 400 with field error.
- Cross-user GET → 404 (Profile is 1:1 with User, so this is effectively "no other user's profile exists").
- Form renders all fields with labels + char counters where applicable.

**Tests required**
- Unit: `profilePatchSchema` accepts valid, rejects invalid; partial PATCH merge.
- Integration: GET/PATCH happy path; cross-user 404; field validation.

---

### T-04 PostCard CRUD [MUST] dep:T-02

**Description**
- `PostCard` model (already in schema from T-01).
- `GET /api/postcards?page&pageSize` — list session user's cards, paginated, newest first.
- `POST /api/postcards` — create.
- `GET /api/postcards/:id` — read (404 if not owned).
- `PATCH /api/postcards/:id` — partial update.
- `DELETE /api/postcards/:id` — delete (cascade to Posts/PostTargets).
- Dashboard grid (`src/app/(dashboard)/dashboard/page.tsx`) with post card cards.
- Composer (`/dashboard/postcards/new`, `/dashboard/postcards/:id/edit`) with:
  - Basics section (title + summary, char counters).
  - Story section (markdown editor + preview toggle + char counter).
  - Tech tags section (chips input, 1–10, max 24 chars).
  - Links section (repoUrl, liveUrl, URL validation).
- View page (`/dashboard/postcards/:id`) with rendered markdown + Amplify button (disabled until T-15).

**Files touched**
- `src/app/api/postcards/route.ts`, `src/app/api/postcards/[id]/route.ts`.
- `src/server/services/postcards.ts`.
- `src/lib/validation/schemas.ts` (add `postCardCreateSchema`, `postCardPatchSchema`).
- `src/app/(dashboard)/dashboard/page.tsx` (stats strip stub; real stats in T-17).
- `src/app/(dashboard)/dashboard/postcards/new/page.tsx`, `[id]/page.tsx`, `[id]/edit/page.tsx`.
- `src/components/forms/postcard-composer.tsx`, `tech-tag-input.tsx`, `markdown-editor.tsx`.
- `src/components/ui/post-card-card.tsx` (the card in the grid).
- Tests: `tests/unit/services/postcards.test.ts`, `tests/integration/postcards.test.ts`, `tests/e2e/postcard-crud.spec.ts` (part of T-06).

**Acceptance criteria (AC)**
- FR-003 acceptance: full CRUD; cross-user → 404; empty required fields → 400 with fieldErrors; techStack <1 or >10 → 400; description >5000 → 400.
- Delete cascades to Posts + PostTargets (integration test).
- Dashboard grid renders 12 cards per page; "New Post Card" button creates; empty state shows when no cards.
- Composer: char counters live; markdown preview toggle works; tag chips add/remove.

**Tests required**
- Unit: `postCardCreateSchema`, `postCardPatchSchema` validation.
- Integration: full CRUD happy path; cross-user 404; field validation; cascade delete.

---

### T-05 PostCard image (optional 1 image) [SHOULD] dep:T-04

**Description**
- Image upload: 1 image per PostCard, optional.
- `POST /api/postcards/:id/image` (multipart/form-data) → `{ imageUrl }`.
- 5MB max + jpg/png/webp validation (client-side + server-side magic-byte check).
- Local storage `/public/uploads/<userId>/<cuid>.<ext>` in dev.
- Cloudinary interface in `src/lib/upload/cloudinary.ts` (config-only swap; no real Cloudinary calls in MVP unless `CLOUDINARY_*` env set).

**Files touched**
- `src/app/api/postcards/[id]/image/route.ts`.
- `src/lib/upload/local.ts`, `src/lib/upload/cloudinary.ts`, `src/lib/upload/index.ts` (interface selector).
- `src/components/forms/image-upload.tsx`.
- `src/lib/validation/schemas.ts` (add `imageUploadSchema`).
- Tests: `tests/integration/image-upload.test.ts`.

**Acceptance criteria (AC)**
- FR-003 media rules: oversize (>5MB) rejected; wrong type (gif) rejected; valid jpg/png/webp accepted.
- Server-side magic-byte check rejects files with wrong Content-Type.
- Image URL persisted in `PostCard.imageUrl`.
- Removing image (DELETE) clears the field + deletes the file (dev: from disk).

**Tests required**
- Integration: oversize rejection, wrong type rejection, happy path, DELETE.

---

### T-06 Week-1 E2E [MUST] dep:T-01..T-05

**Description**
Playwright journey: signup → profile → create post card (with image if T-05 done) → dashboard shows it → edit → save → delete.

**Files touched**
- `tests/e2e/week-1-flow.spec.ts`.

**Acceptance criteria (AC)**
- Single E2E spec passes in CI (Chromium).
- Covers: signup, profile update, postcard create + edit + delete.
- Asserts: toast on save, dashboard grid updates, empty state after delete.

**Tests required**
- The E2E spec itself is the test.

---

## Week 2 — Trust Layer + Connections (T-07…T-12)

### T-07 TokenVault [MUST] dep:T-01

**Description**
- `src/lib/vault/token-vault.ts` — AES-256-GCM encrypt/decrypt.
- `src/lib/config/env.ts` (already from T-01, but verify `TOKEN_ENCRYPTION_KEY` validation: 32 bytes after base64 decode).
- Ciphertext format: `base64(iv) : base64(ciphertext) : base64(authTag)`.
- Branded type `DecryptedCredential` scoped to workers + connection service.

**Files touched**
- `src/lib/vault/token-vault.ts`.
- `src/types/branded.ts` (add `DecryptedCredential`).
- Tests: `tests/unit/vault/token-vault.test.ts`.

**Acceptance criteria (AC)**
- FR-009 acceptance: round-trip works for all credential shapes; ciphertext ≠ plaintext; tampered → throws; missing key → throws at boot; wrong-shape key → throws.
- Vault is the only module that uses `crypto.createCipheriv` / `createDecipheriv`.

**Tests required**
- Unit: round-trip, ciphertext ≠ plaintext, tampered throws, missing key throws, wrong-shape key throws (per `09-TESTING-STRATEGY.md` §2.1).

---

### T-08 Adapter framework + registry + config [MUST] dep:T-07

**Description**
- `src/lib/platforms/types.ts` — `OAuthAdapter` + `SimpleAdapter` interfaces per `03-ARCHITECTURE.md` §4.
- `src/lib/platforms/registry.ts` — `PLATFORM_REGISTRY` map + `getAdapter()` + `isConfigured()` + `isTierA()`.
- Stub adapters for all 8 platforms (only `configured()` returns false initially; full implementation in T-09..T-11).
- `src/lib/config/platforms.ts` (already from T-01; verify limits/budgets/retries from `03-ARCHITECTURE.md` §7).
- `src/lib/formatters/types.ts` — `FormattedPayload` discriminated union (full implementation in T-13).

**Files touched**
- `src/lib/platforms/types.ts`, `src/lib/platforms/registry.ts`.
- `src/lib/platforms/{reddit,discord,devto,telegram,bluesky,hashnode,twitter,linkedin}/adapter.ts` (stubs).
- `src/lib/formatters/types.ts` (interface only).
- Tests: `tests/unit/platforms/registry.test.ts`.

**Acceptance criteria (AC)**
- Registry drives a connections availability unit test: for each platform, `isConfigured()` returns true/false based on env vars.
- `getAdapter(platform)` returns the right adapter instance.
- `isTierA('REDDIT')` → true; `isTierA('TWITTER')` → false.

**Tests required**
- Unit: registry lookup, configured() per env var presence, isTierA() correctness.

---

### T-09 Reddit OAuth connect [MUST] dep:T-08

**Description**
- `src/app/api/oauth/[platform]/start/route.ts` — gen PKCE + state, set signed httpOnly cookie, 302 to Reddit authorize URL.
- `src/app/api/oauth/[platform]/callback/route.ts` — validate state, exchange code, fetch identity, encrypt, upsert Connection, audit CONNECT, redirect to checklist.
- `src/lib/auth/pkce.ts` — `code_verifier` + `code_challenge` (S256) generators.
- `src/lib/auth/state-cookie.ts` — httpOnly signed cookie helpers (10-min TTL, single-use).
- `src/lib/platforms/reddit/adapter.ts` — full OAuth adapter (`getAuthUrl`, `exchangeCode`, `getIdentity`, `publish` stub — full publish in T-14).
- `src/lib/platforms/reddit/client.ts` — low-level fetch wrappers (Reddit OAuth endpoints).
- Mocks: unit tests use `vi.spyOn(globalThis, 'fetch')`.

**Files touched**
- `src/app/api/oauth/[platform]/start/route.ts`, `src/app/api/oauth/[platform]/callback/route.ts`.
- `src/lib/auth/pkce.ts`, `src/lib/auth/state-cookie.ts`.
- `src/lib/platforms/reddit/adapter.ts`, `src/lib/platforms/reddit/client.ts`.
- `src/server/services/connections.ts` (add `connectReddit()`).
- Tests: `tests/unit/platforms/reddit/adapter.test.ts`, `tests/unit/auth/pkce.test.ts`, `tests/integration/oauth-reddit.test.ts`.

**Acceptance criteria (AC)**
- FR-004 acceptance: happy path connects + shows "Connected as @handle"; tampered state → 400 + no row; callback for unconfigured platform → 404; response contains no tokens.
- State cookie: 10-min TTL, single-use (deleted on read), httpOnly, sameSite=lax, signed with `NEXTAUTH_SECRET`.
- Scopes: `identity`, `submit` (minimal).

**Tests required**
- Unit: PKCE generators, state-cookie signer, Reddit adapter `getAuthUrl` / `exchangeCode` / `getIdentity` with mocked fetch.
- Integration: full start → callback flow with mocked Reddit API; tampered state → 400; expired state → 400; unconfigured → 400.

---

### T-10 Discord webhook + Dev.to + Hashnode keys [MUST] dep:T-08

**Description**
- `POST /api/connections/discord { webhookUrl }` → validate via GET webhook URL → encrypt → upsert → return `{ channelName, guildName }`.
- `POST /api/connections/devto { apiKey }` → validate via `GET /api/me` → encrypt → upsert → return `{ username }`.
- `POST /api/connections/hashnode { pat }` → validate via GraphQL `me { username }` → encrypt → upsert → return `{ username }`.
- `src/lib/platforms/discord/adapter.ts`, `devto/adapter.ts`, `hashnode/adapter.ts` — full Simple adapters (`validateCredentials`, `publish` stub).
- Platform errors surfaced verbatim (e.g., "Key rejected by Dev.to — check and re-paste").

**Files touched**
- `src/app/api/connections/discord/route.ts`, `src/app/api/connections/devto/route.ts`, `src/app/api/connections/hashnode/route.ts`.
- `src/lib/platforms/{discord,devto,hashnode}/adapter.ts` + `client.ts`.
- `src/server/services/connections.ts` (add `connectDiscord()`, `connectDevto()`, `connectHashnode()`).
- Tests: `tests/unit/platforms/{discord,devto,hashnode}/adapter.test.ts`, `tests/integration/connections-{discord,devto,hashnode}.test.ts`.

**Acceptance criteria (AC)**
- FR-005 + FR-006 acceptance: valid → connected with metadata returned; invalid → 400 with platform's exact message; network error → 502.
- Response never echoes the credential (scanner test green).

**Tests required**
- Unit: each adapter `validateCredentials` with mocked fetch returning valid/invalid/network.
- Integration: each POST happy path, invalid credential, network error, re-connect.

---

### T-11 Telegram bot + Bluesky app password [MUST] dep:T-08

**Description**
- `POST /api/connections/telegram { botToken, channel }` → `getMe` (validate token) + `getChat` (validate bot is admin) → encrypt → upsert → return `{ channelTitle }`.
- `POST /api/connections/bluesky { handle, appPassword }` → `createSession` → encrypt (handle, appPassword, accessJwt, refreshJwt, did) → upsert → return `{ did }`.
- Error reasons for Telegram: BAD_TOKEN, NOT_ADMIN, BAD_CHANNEL.
- Bluesky adapter uses `https://bsky.social/xrpc/com.atproto.server.createSession`.

**Files touched**
- `src/app/api/connections/telegram/route.ts`, `src/app/api/connections/bluesky/route.ts`.
- `src/lib/platforms/telegram/adapter.ts`, `src/lib/platforms/bluesky/adapter.ts` (+ client.ts).
- `src/server/services/connections.ts` (add `connectTelegram()`, `connectBluesky()`).
- Tests: `tests/unit/platforms/{telegram,bluesky}/adapter.test.ts`, `tests/integration/connections-{telegram,bluesky}.test.ts`.

**Acceptance criteria (AC)**
- FR-007 + FR-008 acceptance: Telegram BAD_TOKEN / NOT_ADMIN / BAD_CHANNEL distinct errors; Bluesky invalid pair → "Bluesky rejected these credentials — create the app password in Settings → App passwords".

**Tests required**
- Unit: Telegram adapter 4 outcomes (valid / BAD_TOKEN / NOT_ADMIN / BAD_CHANNEL); Bluesky adapter valid / invalid / network.
- Integration: each POST happy path + each error class.

---

### T-12 Connect Checklist UI + Disconnect [MUST] dep:T-09..T-11

**Description**
- `src/app/(dashboard)/dashboard/connections/page.tsx` — Connect Checklist screen per `06-FRONTEND-SPEC.md` Screen 4.
- `src/components/connections/connection-card.tsx` — 3 states (Not connected / Connected / Setup pending).
- `src/components/connections/trust-expander.tsx` — "Why is this safe?" expanders from `12-TRUST-COPY.md` §1 (verbatim).
- `src/components/connections/connect-checklist.tsx` — grid + progress bar.
- `DELETE /api/connections/:platform` — hard-delete + audit DISCONNECT + mark in-flight targets SKIPPED.
- Disconnect confirmation: Dialog "Disconnect {Platform}? Future publishes won't include it."
- Revoke detection: when adapter call fails with AUTH class (in T-14 worker), mark Connection REVOKED.

**Files touched**
- `src/app/(dashboard)/dashboard/connections/page.tsx`.
- `src/components/connections/*`.
- `src/app/api/connections/[platform]/route.ts` (DELETE).
- `src/server/services/connections.ts` (add `disconnect()`).
- Tests: `tests/integration/disconnect.test.ts`, `tests/e2e/connect-checklist.spec.ts`.

**Acceptance criteria (AC)**
- FR-010 acceptance: after disconnect, publish never attempts that platform (400 `invalidPlatforms`); DB has zero residual rows for that user+platform; in-flight target → SKIPPED.
- Progress bar shows "3/6 connected" (or 8 if Tier B configured).
- "Why is this safe?" expanders render verbatim from `12-TRUST-COPY.md` §1.
- Setup-pending state for unconfigured Tier B (amber, disabled, "Coming soon" tooltip).
- Scanner test: zero credentials in any response (FR-009 scanner).

**Tests required**
- Integration: DELETE → 204; subsequent publish with that platform → 400; in-flight target → SKIPPED.
- E2E: connect Discord (mocked) → see "Connected" → Disconnect → confirm → checklist updates.

---

## Week 3 — The Money Flow (T-13…T-18)

### T-13 Format Engine + preview endpoint [MUST] dep:T-04

**Description**
- `src/lib/formatters/{reddit,discord,devto,telegram,bluesky,hashnode,twitter,linkedin}.ts` — 8 pure formatters per FR-011.
- `src/lib/formatters/index.ts` — `formatFor(platform, input)` registry.
- `src/lib/formatters/_shared.ts` — `truncate()`, `graphemeCount()` (Intl.Segmenter), `hashtagLine()`.
- `GET /api/postcards/:id/preview?platform=X&subreddit=` — live preview endpoint.
- Golden files in `tests/unit/formatters/__fixtures__/` per platform.

**Files touched**
- `src/lib/formatters/*.ts`.
- `src/app/api/postcards/[id]/preview/route.ts`.
- Tests: `tests/unit/formatters/*.test.ts`, `tests/unit/formatters/__fixtures/*`, `tests/unit/formatters/property.test.ts`, `tests/unit/formatters/determinism.test.ts`, `tests/integration/preview.test.ts`.

**Acceptance criteria (AC)**
- FR-011 acceptance: golden-file tests per platform; property test output ≤ limit for randomized inputs; determinism (100x same input → identical output); grapheme counting (test with `👨‍👩‍👧`).
- Live preview endpoint returns formatted output + charCount + limit (per platform).
- Truncation strategy: never title; description → summary; ellipsis before link; tags only if room.

**Tests required**
- Unit: golden files + edge cases per platform.
- Property: randomized inputs (fast-check), assert length ≤ limit.
- Determinism: 100x same input.
- Integration: `GET /api/postcards/:id/preview` returns correct shape per platform.

---

### T-14 Publish service + queue + workers [MUST] dep:T-12, T-13

**Description**
- `src/lib/queue/setup.ts` — BullMQ Queue + Worker init (connection from `REDIS_URL`).
- `src/lib/queue/workers.ts` — Worker processor (calls adapter, persists status).
- `src/app/api/postcards/[id]/publish/route.ts` — POST (validate, transaction, enqueue).
- `src/server/services/publish.ts` — `createPost`, `retryTarget`, `listPosts`, `getPost`.
- `src/workers/publish-worker.ts` — Worker entrypoint (started via `instrumentation.ts`).
- Failure classification per `03-ARCHITECTURE.md` §7 (AUTH / RATE / VALIDATION / NETWORK / QUOTA).
- Exponential backoff: 10s / 60s / 300s for RATE + NETWORK only.
- `requestId` idempotency: server upserts on `Post.requestId` unique.
- Worker idempotency: if status !== QUEUED on pickup, no-op.

**Files touched**
- `src/lib/queue/setup.ts`, `src/lib/queue/workers.ts`.
- `src/app/api/postcards/[id]/publish/route.ts`.
- `src/server/services/publish.ts`.
- `src/workers/publish-worker.ts`.
- `src/instrumentation.ts` (Next.js instrumentation hook to start worker in dev + prod).
- Tests: `tests/integration/publish.test.ts`, `tests/integration/retry.test.ts`, `tests/unit/services/publish.test.ts`.

**Acceptance criteria (AC)**
- FR-012 integration tests incl. partial-failure isolation + call counts; requestId idempotency; ownership 403 path; unconfigured platform 400.
- Failure classification: AUTH → Connection REVOKED + target FAILED; RATE / NETWORK → 3 attempts with backoff then FAILED; VALIDATION → FAILED with platform message; QUOTA → SKIPPED.
- Worker idempotency: job running twice (Redis restart) → second run no-op.

**Tests required**
- Integration: happy path (3 mocked adapters all SUCCESS), partial failure (one AUTH fails, others SUCCESS), idempotency (same requestId), ownership (404), unconfigured (400), quota guard (budget=2 → 3rd SKIPPED), retry (FAILED → Retry → SUCCESS, success target NOT called again).
- Unit: publish service logic (validation, transaction, enqueue).

---

### T-15 Publish screen (core UX) [MUST] dep:T-14

**Description**
- `src/app/(dashboard)/dashboard/postcards/[id]/publish/page.tsx` — Publish screen per `06-FRONTEND-SPEC.md` Screen 6.
- `src/components/publish/platform-checklist.tsx` — only connected platforms selectable, Reddit reveals subreddit input.
- `src/components/publish/live-preview-panel.tsx` — debounced (300ms) call to `/preview` with char counter.
- `src/components/publish/status-board.tsx` — per-target status chips + permalink + Retry.
- `src/components/publish/amplify-button.tsx` — "🚀 Amplify to N platforms" (N live count).
- `src/lib/hooks/use-post-status.ts` — polling hook (3s, abort-on-unmount, max 5 min).
- Partial-success banner if any FAILED.

**Files touched**
- `src/app/(dashboard)/dashboard/postcards/[id]/publish/page.tsx`.
- `src/components/publish/*`.
- `src/lib/hooks/use-post-status.ts`.
- Tests: `tests/e2e/publish-flow.spec.ts`.

**Acceptance criteria (AC)**
- FR-012 UI acceptance via Playwright (mocked adapters):
  - Tick 3 platforms → Amplify → status board appears → all SUCCESS within 30s.
  - Partial failure → banner + Retry button on FAILED row.
  - Polling stops when all terminal; aborts on unmount.
  - Live preview shows formatted output + `charCount/limit` counter (red if over).
  - Reddit reveals subreddit input; defaults to last-used (saved per user).

**Tests required**
- E2E: full publish journey with mocked adapters (per `09-TESTING-STRATEGY.md` §4.2).

---

### T-16 Retry + History [MUST] dep:T-15

**Description**
- `POST /api/posts/:id/targets/:targetId/retry` — retry FAILED target only, attempts < 3, not AUTH-class.
- `GET /api/posts?page&platform&status` — paginated history list (20/page).
- `GET /api/posts/:id` — single post + targets (poll endpoint).
- `src/app/(dashboard)/dashboard/history/page.tsx` — History screen per `06-FRONTEND-SPEC.md` Screen 7.
- Filters: platform select, status select. Pagination 20.

**Files touched**
- `src/app/api/posts/[id]/targets/[targetId]/retry/route.ts`.
- `src/app/api/posts/route.ts`, `src/app/api/posts/[id]/route.ts`.
- `src/server/services/publish.ts` (add `retryTarget`, `listPosts`, `getPost`).
- `src/app/(dashboard)/dashboard/history/page.tsx`.
- Tests: `tests/integration/retry.test.ts`, `tests/integration/posts-list.test.ts`, `tests/e2e/retry-flow.spec.ts`.

**Acceptance criteria (AC)**
- FR-013 acceptance: retry does not touch SUCCESS targets (call-count assert).
- FR-014 acceptance: 50+ seeded posts render without layout shift; filters work; pagination 20/page.
- Retry guards: not FAILED → 409; attempts ≥ 3 → 409 MAX_RETRIES; AUTH-class → 409 with reconnect hint.

**Tests required**
- Integration: each retry guard path; retry happy path; list pagination; filters.
- E2E: forced failure → Retry → SUCCESS (assert success target NOT called again).

---

### T-17 X quota guard + global rate limiting + audit [MUST] dep:T-14

**Description**
- `src/lib/quota/x-monthly.ts` — QuotaUsage logic (check + increment in transaction with row-level lock).
- `src/lib/middleware/rate-limit.ts` — Redis INCR + EXPIRE, 100/min/user global, 10/min/IP on auth, 10/min/user on publish.
- Audit actions wired everywhere: LOGIN, LOGIN_FAIL, CONNECT, DISCONNECT, PUBLISH, RETRY, TOKEN_FAIL, ACCOUNT_DELETE.
- `GET /api/stats/summary` — basic stats (posts count, success rate, per-platform counts).

**Files touched**
- `src/lib/quota/x-monthly.ts`.
- `src/lib/middleware/rate-limit.ts`.
- `src/server/services/audit.ts` (add `log()` + ensure all actions emit).
- `src/app/api/stats/summary/route.ts`.
- `src/app/(dashboard)/dashboard/page.tsx` (wire stats strip).
- Tests: `tests/integration/quota.test.ts`, `tests/integration/rate-limit.test.ts`, `tests/integration/audit.test.ts`.

**Acceptance criteria (AC)**
- FR-016 acceptance: burst test yields 429 with Retry-After; normal flows never hit it.
- FR-017 acceptance: each publish produces audit row; each retry; each connect/disconnect.
- FR-018 acceptance: budget=2 test config → 3rd X post SKIPPED; others SUCCESS; month-boundary test (new month → reset).

**Tests required**
- Integration: quota (budget=2 sequence, month-boundary, race condition); rate-limit (burst); audit (each action produces row, scanner test green).

---

### T-18 Week-3 E2E + manual smoke [MUST] dep:T-15..T-17

**Description**
- Full mocked E2E journey: signup → profile → connect (mocked) → create card → amplify → status board → history.
- `scripts/smoke.ts` — real-post to your private Discord + test subreddit (manual, never in CI).
- Smoke evidence (URLs + screenshots) in `docs/13-PROGRESS.md`.

**Files touched**
- `tests/e2e/week-3-flow.spec.ts`.
- `scripts/smoke.ts`.
- `docs/13-PROGRESS.md` (Smoke Evidence section).

**Acceptance criteria (AC)**
- E2E green in CI.
- Manual smoke: real Discord post URL + real Reddit post URL + screenshot in PROGRESS.md.

**Tests required**
- The E2E spec is the test.
- Smoke is not a test (manual); evidence is human-verified.

---

## Week 4 — Harden + Demo (T-19…T-22)

### T-19 Trust & Security panel + account deletion / export [MUST] dep:T-12

**Description**
- `src/app/(dashboard)/dashboard/settings/page.tsx` — Security & Connections tab per `12-TRUST-COPY.md` §2 (verbatim "How we protect you").
- Per-connection: platform icon, handle, scopes granted (OAuth), connectedAt, lastUsedAt, lastValidatedAt, big Disconnect button.
- `DELETE /api/account` — typed confirmation "DELETE", cascade delete, audit ACCOUNT_DELETE, redirect to landing.
- `GET /api/account/export` — JSON download of all user data (no credentialsCipher).

**Files touched**
- `src/app/(dashboard)/dashboard/settings/page.tsx` (add Security & Connections + Danger Zone tabs).
- `src/app/api/account/route.ts`, `src/app/api/account/export/route.ts`.
- `src/server/services/account.ts`.
- Tests: `tests/integration/account.test.ts`, `tests/e2e/account-deletion.spec.ts`.

**Acceptance criteria (AC)**
- FR-015 acceptance: live Disconnect works and disappears from checklist; account deletion test shows zero residual rows across all user tables; export JSON contains no ciphertext patterns.
- Audit ACCOUNT_DELETE row kept (with userId for forensics) after deletion.

**Tests required**
- Integration: delete account → zero rows for userId in User, Profile, PostCard, Connection, Post, PostTarget; AuditLog rows kept (incl ACCOUNT_DELETE).
- Integration: export JSON contains no credential patterns.
- E2E: settings → disconnect → checklist updates → delete account (typed confirm) → redirect to landing.

---

### T-20 Polish pass [MUST] dep:all

**Description**
- Every screen: loading + empty + error per `07-SECURITY-ACCESS.md` §4 matrix.
- Responsive: mobile-first per `06-FRONTEND-SPEC.md` §4.1.
- A11y: `axe-core` clean on every screen; Lighthouse ≥90 on dashboard.
- Toasts: aria-live, role=status/alert.
- Skeletons for every async surface.
- Focus-visible rings on all interactive elements.
- Color contrast AA.

**Files touched**
- All screen files (touch-up).
- `tests/e2e/a11y.spec.ts` (axe-core checks).
- `playwright.config.ts` (add axe-core plugin).

**Acceptance criteria (AC)**
- Every error matrix row in `07-SECURITY-ACCESS.md` §4 verified visually (manual screenshot per row).
- Lighthouse ≥90 (perf, a11y, best-practice) on dashboard.
- `axe-core` zero violations on every screen.

**Tests required**
- E2E: axe-core per screen.
- Lighthouse CI (stretch): in a separate CI job.

---

### T-21 Security audit [MUST] dep:T-19

**Description**
- Run `07-SECURITY-ACCESS.md` §6 checklist end-to-end.
- `npm audit --production` — zero high/critical (or justified).
- CSP / HSTS / `X-Frame-Options: DENY` / `nosniff` headers in `next.config.mjs`.
- DB dump grep test (`scripts/scan-db-dump.sh`) in CI.
- Log scanner (`scripts/scan-logs.sh`) for token patterns in AuditLog + app logs.
- Response scanner test (`tests/integration/credential-scanner.test.ts`).

**Files touched**
- `next.config.mjs` (security headers).
- `scripts/scan-db-dump.sh`, `scripts/scan-logs.sh`.
- `tests/integration/credential-scanner.test.ts`.
- `.github/workflows/ci.yml` (add scanner jobs).
- `docs/13-PROGRESS.md` (audit checklist with each box checked).

**Acceptance criteria (AC)**
- `07-SECURITY-ACCESS.md` §6.2 checklist ALL checked.
- `npm audit --production` zero high/critical (or justified in PR description).
- `curl -I https://netamplify.vercel.app/` shows correct security headers.
- DB dump grep test green in CI.
- Log scanner green.
- Response scanner green.

**Tests required**
- Scanner tests as above.

---

### T-22 Demo prep [MUST] dep:T-20

**Description**
- Seed demo user (`demo@netamplify.dev` / `demo-pass-123`) with full profile + 6 Tier A connections + 3 Post Cards.
- Rehearse the demo script (`10-ROADMAP.md` "Demo Script") 3 times.
- Record backup video (4-min demo) in case WiFi dies.
- Screenshot pack (10 screenshots showing the full flow).
- LinkedIn / X status slide (current app-review status).

**Files touched**
- `prisma/seed.ts`.
- `demo/backup-video.mp4` (not in repo; store locally or in cloud drive).
- `demo/screenshots/` (10 PNGs).
- `demo/status-slide.md` (LinkedIn/X status).

**Acceptance criteria (AC)**
- `npm run db:seed` runs cleanly.
- Demo script runs clean twice consecutively in rehearsal (note in PROGRESS).
- Backup video recorded.
- Screenshot pack saved (10 screenshots, named `01-login.png` through `10-history.png`).
- LinkedIn / X status slide prepared.

**Tests required**
- Seed script: deterministic (no `Math.random`); runs cleanly with `npm run db:seed`.
- Demo rehearsal: human-verified.

---

## Bonus (only if Week 2 has slack)

### T-B1 X adapter + connect (OAuth2 PKCE) — AC: FR-004 pattern for Twitter.

**Description**
- `src/lib/platforms/twitter/adapter.ts` — full OAuth adapter (PKCE S256).
- Scopes: `tweet.read`, `tweet.write`, `users.read` (X API v2 free tier).
- `src/app/api/connections/twitter/route.ts` (uses OAuth flow, not simple connect).
- Quota guard (FR-018) applies — `X_MONTHLY_POST_BUDGET` config.
- X refresh token rotation (X uses OAuth 2.0 PKCE with refresh tokens).

**Files touched**
- `src/lib/platforms/twitter/adapter.ts`, `src/lib/platforms/twitter/client.ts`.
- `src/app/api/oauth/twitter/start/route.ts` (uses generic `oauth/[platform]` if T-09 is generic).
- `src/lib/quota/x-monthly.ts` (already from T-17).
- Tests: `tests/unit/platforms/twitter/adapter.test.ts`, `tests/integration/connections-twitter.test.ts`.

**Acceptance criteria (AC)**
- FR-004 pattern for Twitter: happy path connects, shows "Connected as @handle"; tampered state → 400; unconfigured → "Setup pending".
- Quota guard: budget=2 test config → 3rd X post SKIPPED.
- Refresh token rotation: when access token expires, refresh via refresh token; if refresh fails → Connection REVOKED.

**Tests required**
- Unit: Twitter adapter with mocked fetch (valid / invalid / refresh).
- Integration: connect Twitter happy path; quota guard; refresh flow.

---

### T-B2 LinkedIn adapter + connect — AC: same; gracefully shows "review pending".

**Description**
- `src/lib/platforms/linkedin/adapter.ts` — full OAuth adapter.
- Scopes: `w_member_social` (posting) + `r_liteprofile` (identity).
- LinkedIn posts on behalf of the person (not org).
- LinkedIn access tokens expire in 60 days; refresh via refresh token (LinkedIn supports this).
- "Dev mode" / "limited mode" until app review: posts visible only to the user + connections.

**Files touched**
- `src/lib/platforms/linkedin/adapter.ts`, `src/lib/platforms/linkedin/client.ts`.
- `src/app/api/oauth/linkedin/start/route.ts` (generic if T-09 generic).
- Tests: `tests/unit/platforms/linkedin/adapter.test.ts`, `tests/integration/connections-linkedin.test.ts`.

**Acceptance criteria (AC)**
- Same as T-B1 for connect flow.
- Graceful degrade: if LinkedIn app review pending, post returns VALIDATION-class failure with "LinkedIn app review pending — your post may not be visible to the public" hint.

**Tests required**
- Unit + integration similar to T-B1.

---

## How to use this list

1. Pick the current week from `10-ROADMAP.md`.
2. Pick the next ticket in dependency order from this list.
3. Paste into your AI coding agent:
   ```
   Execute T-NN per docs/11-FEATURE-TICKETS.md. Follow CLAUDE.md;
   write tests; meet Definition of Done; update docs/13-PROGRESS.md;
   conventional commit `feat(T-NN): <subject>`; STOP.
   ```
4. After each ticket: review PR (per `08-CODING-STANDARDS.md` §9).
5. After each week: "Act as a strict senior reviewer. Audit everything
   built this week against the FRs and `07-SECURITY-ACCESS.md`
   checklist. Verdict per FR: PASS or violation+fix. Apply fixes,
   re-run suite."

---

> End of feature tickets. Next: `12-TRUST-COPY.md` — verbatim
> trust + security copy for UI + viva.
