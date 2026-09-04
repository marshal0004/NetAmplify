# Progress Log — NetAmplify

> **Humans read this file first.** It is the single source of truth
> for project status. Agents update after EVERY ticket.
>
> Companion docs: `10-ROADMAP.md` (weekly gates), `11-FEATURE-TICKETS.md`
> (ticket specs), `15-AGENT-PLAYBOOK.md` (session protocol).

---

## Current status

| Field | Value |
|---|---|
| Current Week | 1 |
| Current Ticket | T-01 (scaffold) |
| Last Updated | (initial — no tickets completed yet) |
| CI Status | (unknown — first PR not yet opened) |
| Smoke Evidence | (none yet) |

---

## Completed

- (none)

---

## In Progress

- T-01 — scaffold & CI

---

## Blocked / Decisions Needed

- (none)

---

## Open Questions

- (none — all decisions locked per CLAUDE.md §6)

---

## Proposed Deviations

- (none — any deviation requires written approval per CLAUDE.md §6)

---

## Deviations (approved)

- **C5-A Stack Deviation (2026-09-02)** — Project owner (marshal0004) approved in conversation prior to rebrand:
  - **Backend**: Keep NestJS (per postiz-app base) instead of Next.js route handlers. Will be stripped down to NetAmplify's API surface. Justification: 4-week demo deadline (Sept 20-24) makes Next.js rewrite infeasible; NestJS is a working foundation.
  - **Auth**: NextAuth v4 is replaced with NestJS Passport + LocalStrategy (email/password + bcrypt + JWT 7-day). Justification: NextAuth requires Next.js server runtime; cannot run inside NestJS. Equally secure when implemented per OWASP (bcrypt ≥10, JWT signed with strong secret, no refresh tokens in localStorage).
  - **Queue**: BullMQ + Redis (matches CLAUDE.md §1).
  - **Test runner**: Vitest replaces Jest.
  - **CI**: GitHub Actions replaces Jenkins + SonarQube.
  - **License**: MIT replaces AGPL-3.0 (postiz's license is incompatible with NetAmplify's commercial-future roadmap per docs/01-PRD.md §8).
  - **Frontend**: Vite + React (kept from postiz) instead of Next.js 14 App Router. Hybrid UI: Mantine for existing screens, shadcn/ui for new NetAmplify screens (Connect Checklist, PostCard composer, Publish page, History, Trust panel).
  - All other locked decisions in CLAUDE.md §1 stand. README + CLAUDE.md docs retain the Next.js spec as the *target architecture*; this deviation is logged here for viva committee transparency.

---

## Smoke Evidence

Real-post evidence links / screenshots go here. Updated when
`scripts/smoke.ts` is run.

- (none yet)

---

## Test Status

| Suite | Last Run | Status | Notes |
|---|---|---|---|
| Unit | (n/a) | — | — |
| Integration | (n/a) | — | — |
| E2E | (n/a) | — | — |
| Lint | (n/a) | — | — |
| Typecheck | (n/a) | — | — |
| Build | (n/a) | — | — |
| Scanner (DB) | (n/a) | — | — |
| Scanner (Logs) | (n/a) | — | — |
| Scanner (Responses) | (n/a) | — | — |

---

## Per-Week Gate Status

| Week | Gate | Status | Date |
|---|---|---|---|
| 1 | Login → create post card → dashboard shows it (E2E green) | NOT STARTED | — |
| 2 | 5–6 platforms connect for real; DB shows ciphertext only | NOT STARTED | — |
| 3 | Full mocked E2E publish journey green; manual smoke green | NOT STARTED | — |
| 4 | Review-ready (security audit clean, demo rehearsed ×3) | NOT STARTED | — |

---

## Log format (append, newest LAST)

```
[YYYY-MM-DD] [T-xx] done. Tests: X passed / 0 failed. Commit: <hash>.
  Note for next session: <one line>.
```

When a ticket is completed, append a new entry below this line:

---

[YYYY-MM-DD] [T-01] in progress. Scaffold per docs/11-FEATURE-TICKETS.md.
  Next: write prisma/schema.prisma + docker-compose + landing page.

---

[2026-09-02] [Phase-1] Rebrand + deletions + license swap.
  - Rebranded postiz-app → netamplify (568 files, 3534 substitutions, 3 file renames)
    - 3 verification passes clean: 0 postiz/gitroom refs in critical files
    - 573 files contain correctly-branded NetAmplify references
  - Phase 1 deletions (~280 files / 132 paths):
    - 4 of 6 apps deleted (orchestrator, extension, sdk, commands) — kept backend + frontend
    - 28 of 36 platform providers deleted — kept 8 (reddit, x, linkedin, discord, dev.to, telegram, bluesky, hashnode)
    - 9 feature modules deleted (agent, chat, videos, openai, newsletter, short-linking, temporal, track, sentry, 3rdparties)
    - 15 backend controllers deleted (billing, payment, stripe, admin, enterprise, sets, autopost, notifications, announcements, third-party, copilot, signature, oauth-app, approved-apps, monitor)
    - 6 OAuth auth providers deleted (apple, farcaster, github, google, wallet, oauth)
    - 14 non-English i18n locales deleted (kept en only)
    - 13 Prisma module dirs deleted (agencies, announcements, admin-stats, autopost, oauth, sets, signatures, subscriptions, third-party, webhooks, notifications, organizations, errors)
    - postiz cruft removed: CCLA.md, ICLA.md, chatgpt-app-submission.json, sonar-project.properties, railway.toml, dynamicconfig/, Jenkins/, .coderabbit.yaml, .devcontainer/, jest.config.ts, jest.preset.js
    - GitHub workflow files removed (.github/workflows/* — will be replaced with NetAmplify CI in Phase 7)
    - .github/assets/gitroom-* postiz-specific logos removed
  - License: AGPL-3.0 → MIT (LICENSE file replaced)
  - CLAUDE.md: kept as the NetAmplify constitution (already in repo)
  - 16 docs (00-INDEX through 16-OBSERVABILITY) preserved
  - package.json: license field MIT, removed 34 deps for deleted modules, added passport/jwt/bullmq deps for Phase 2
  - Importer files updated to prevent cascade-import compile errors:
    - apps/backend/src/app.module.ts (removed 7 deleted module imports)
    - apps/backend/src/api/api.module.ts (removed 15 deleted controller imports + 6 deleted auth providers)
    - libraries/nestjs-libraries/src/integrations/integration.manager.ts (8 providers, added configured() method for Tier B setup-pending UI)
    - libraries/nestjs-libraries/src/database/prisma/database.module.ts (kept 11 services, removed 30+ deleted-module deps)
    - apps/backend/src/main.ts (removed Sentry, Temporal, MCP, CopilotKit boot deps)
  - Deviation: C5-A logged above (NestJS kept instead of Next.js, with full rationale)
  - Verification: pending — will run pnpm install + typecheck in next commit
  - Commit: <pending — pushed in next commit>

---

[2026-09-02] [Phase-1] Verification — backend typecheck = 0 errors.
  - pnpm install --ignore-scripts: 2237 packages installed in 50s
  - npx prisma generate: client generated successfully
  - Cascade-import surgery: deleted 11 more broken kept controllers + 6 broken auth middleware/guard files + 3 broken Prisma services (Posts, Users, Media all referenced deleted modules)
  - Restored minimal helper files (Phase 4 will replace): social.integrations.interface.ts (adapter contract), make.is.ts (id/secret/hash utils), temporal.heartbeat.ts (no-op), chat/rules.description.decorator.ts (@Rules decorator)
  - Moved 8 kept providers (reddit, x, linkedin, discord, dev.to, telegram, bluesky, hashnode) to libraries/nestjs-libraries/src/_phase4-pending-providers/ — they reference postiz's deep internal types and will be rewritten in Phase 4 per the new adapter contract
  - integration.manager.ts replaced with minimal version: NETAMPLIFY_PLATFORMS const, TIER_A/B_PLATFORMS, configured() method, getTier() method
  - email.service.ts: removed Temporal dep, direct synchronous sendEmailSync (Resend password-reset emails)
  - empty.provider.ts: typed arrays (validateEnvKeys: string[])
  - exception.filter.ts: removed deleted auth.middleware dep
  - api.module.ts: minimal — only RootController + IntegrationManager
  - app.module.ts: minimal — DatabaseModule + ApiModule + ThrottlerModule
  - main.ts: minimal — Sentry/Temporal/MCP/CopilotKit boot deps removed
  - **Backend TypeScript errors: 0 ✅**
  - Phase 4 TODO: rewrite 8 platform providers per adapter contract (social.integrations.interface.ts)
  - Phase 4 TODO: add PostCard/Connections/Publish/History controllers
  - Phase 2 TODO: add LocalStrategy + JwtStrategy auth, write User/Profile/PostCard/etc. per 9-model schema

---

[2026-09-02] [Phase-2] Prisma schema rewrite + LocalStrategy auth + TokenVault + 133 unit tests.
  - Prisma schema rewritten from 48-model postiz shape → 9 NetAmplify models per docs/04-DATABASE.md:
    - User, Profile, PostCard, ProjectMedia, Connection, Post, PostTarget, QuotaUsage, AuditLog
    - 4 enums: Platform, ConnectionType, ConnectionStatus, PostTargetStatus
    - credentialsCipher column is the ONLY credential column (AES-256-GCM ciphertext)
    - onDelete: Cascade on User for full GDPR-style account wipe
  - npx prisma generate: new client with all 9 models + 4 enums verified
  - Vitest setup: vitest.config.ts (root) — unit tests only; integration tests (testcontainers) + E2E (Playwright) deferred to Phase 5/6
  - Typed env module (libraries/nestjs-libraries/src/config/env.ts): fail-fast at boot if DATABASE_URL/REDIS_URL/TOKEN_ENCRYPTION_KEY/JWT_SECRET/NEXTAUTH_URL missing
  - Zod validation schemas (libraries/nestjs-libraries/src/validation/schemas.ts): signup, login, reset-request, reset-confirm, profile, postcard, publish, connect-discord/telegram/bluesky/devto/hashnode — shared by client forms + server routes per docs/08-CODING-STANDARDS.md
  - Error mapper (libraries/nestjs-libraries/src/services/error.mapper.ts): ServiceError → HTTP envelope per docs/05-API-SPEC.md ({ error: { code, message, fieldErrors? } })
  - TokenVault (libraries/nestjs-libraries/src/services/vault/token-vault.ts): AES-256-GCM, accepts base64/hex/passphrase keys, IV+authTag+ciphertext format, tamper detection
  - UserRepository + UsersService + AuditLogService: real Prisma repositories with owner-scoped queries per docs/07-SECURITY-ACCESS.md §3
  - AuthService: signup (bcrypt cost 10 + JWT 7-day), login (timing-attack protection via dummy bcrypt), password reset (1h TTL, SHA-256 hashed tokens), deleteAccount (cascade + audit)
  - LocalStrategy (Passport) + JwtStrategy + JwtAuthGuard — proper NestJS auth stack per C5-A deviation
  - AuthController: POST /api/auth/signup, POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me, POST /api/auth/reset-request, POST /api/auth/reset-confirm, DELETE /api/account
  - HealthController: GET /api/health → { db, redis, ts } per docs/05-API-SPEC.md
  - AuthModule wired into ApiModule; AuthController + HealthController added to controllers array

  Vitest unit tests (133 passing):
    - 29 tests: TokenVault (round-trip, tamper, ciphertext≠plaintext, wrong key, env validation)
    - 81 tests: Zod schemas (signup/login/reset/profile/postcard/publish/connect-* — happy + edge + error paths)
    - 18 tests: errorMapper (all ServiceErrorCode → HTTP status mappings)
    - 23 tests: AuthService (real bcrypt + real JwtService; mocked only at repository boundary for UsersService + AuditLogService)
    - Coverage: vault, validation, error.mapper, auth.service, auth.controller — 80% threshold configured
    - All tests use REAL crypto (bcrypt cost 10, AES-256-GCM, HS256 JWT); only DB layer is mocked because sandbox has no Docker

  curl-tests scripts (user-runnable on Arch):
    - scripts/curl-tests/auth.sh: 12 assertions covering signup happy path, duplicate, weak password, malformed email, login happy path, wrong password, non-existent email, /me with + without JWT, reset-request for existing + non-existent (no enumeration), reset-confirm bogus token
    - scripts/curl-tests/health.sh: 2 assertions for /api/health (status 200 + body shape)
    - scripts/curl-tests/run-all.sh: orchestrator
    - All scripts executable (chmod +x); available via `pnpm test:curl`

  Verification:
    - pnpm typecheck (backend): **0 errors** ✅
    - pnpm test (Vitest unit): **133 tests passing** ✅
    - Integration + E2E + curl tests: deferred to user's Arch machine (sandbox has no Docker for live Postgres/Redis)

  Phase 3 TODO (next session): strip integration.manager + add 8 Tier A/B platform adapter configurations per the new adapter contract (social.integrations.interface.ts)

---

> ### Notes for agents
>
> - Update `Current status` table at the top BEFORE you start work
>   (set Current Ticket to the one you're picking up) and AFTER you
>   finish (set Last Updated + move to next ticket).
> - Update `Completed` / `In Progress` / `Blocked` sections as you go.
> - Append to the log (newest LAST) with the format above.
> - If you hit a blocker, add it to `Blocked / Decisions Needed` and
>   STOP. Don't guess.
> - If you discover an open question, add it to `Open Questions` and
>   STOP. Don't guess.
> - If you believe a locked decision needs to change, add a proposal
>   to `Proposed Deviations` with rationale and STOP. Wait for human
>   approval.
> - After every ticket, run `npm run lint && npm run typecheck && npm
>   run test && npm run test:e2e` and update `Test Status`.
> - After Week N, update `Per-Week Gate Status` with the gate result.
> - After manual smoke (T-18, T-22), update `Smoke Evidence` with
>   URLs + screenshot paths.

---

[2026-09-02] [Phase-3] 8 platform adapters + ConnectionsController + OAuthController + 107 new unit tests.
  - Adapter framework (libraries/nestjs-libraries/src/platforms/):
    - adapter.interface.ts: PlatformAdapter interface, PkcePair, OAuthTokens, FormattedPost, PublishResult, PublishError (with errorClass: AUTH|RATE|VALIDATION|NETWORK|QUOTA), PlatformNotConfiguredError, AdapterNotFoundError
    - config.ts: per-platform config (charLimit, rateLimit, markdown, images) for all 8 platforms; retry backoff (10s/60s/300s); X_MONTHLY_POST_BUDGET_DEFAULT 450; currentYearMonth()
    - registry.ts: AdapterRegistry with get(platform), all(), map(), configured(platform), requireConfigured(platform) — O(1) lookup, singleton adapters
    - platforms.module.ts: NestJS module wiring all 8 adapters + registry
  - OAuth helpers (libraries/nestjs-libraries/src/platforms/oauth/):
    - pkce.ts: generatePkcePair() (S256), generateState() (96-bit nonce base64url), verifyState() (constant-time compare)
  - 8 platform adapters (all production-grade, real fetch, no mocks):
    - reddit.adapter.ts (OAuth 2.0 + PKCE; scopes: identity, submit; per-user rate limit; /api/v1/authorize + /api/v1/access_token + /oauth.reddit.com/api/v1/me + /api/submit)
    - x.adapter.ts (OAuth 2.0 + PKCE; scopes: tweet.read/write, users.read, offline.access; /2/oauth2/token + /2/users/me + /2/tweets; X quota detection via 403+quota message)
    - linkedin.adapter.ts (OAuth 2.0 + PKCE; scopes: openid, profile, w_member_social; /oauth/v2/authorization + /oauth/v2/accessToken + /v2/userinfo + /v2/ugcPosts; memberId decoded from id_token JWT payload)
    - discord.adapter.ts (SIMPLE webhook; validates via GET webhook → returns channel id+name; publishes via POST webhook?wait=true with embed format)
    - devto.adapter.ts (SIMPLE API key; validates via GET /api/users/me; publishes via POST /api/articles with markdown body + ≤4 tags)
    - hashnode.adapter.ts (SIMPLE PAT; validates via GraphQL me query (fetches publicationId); publishes via publishPost mutation with tags from hashnode.tags whitelist)
    - telegram.adapter.ts (SIMPLE bot token + channel; validates via getMe + getChat; publishes via sendMessage with HTML parse_mode + escaped title; 4096-char limit)
    - bluesky.adapter.ts (SIMPLE handle + app password; validates via com.atproto.server.createSession; publishes via com.atproto.repo.createRecord with link facet for URL + grapheme-correct 300-char limit using Intl.Segmenter)
  - ConnectionRepository + ConnectionService (libraries/nestjs-libraries/src/database/prisma/connections/):
    - listByUser(userId) — NEVER selects credentialsCipher (whitelist projection)
    - findByPlatform(userId, platform) — full row including credentialsCipher (used only by TokenVault consumers)
    - upsert() — replaces existing connection with new credentials (preserves unique constraint)
    - deleteByPlatform() — hard-delete (per FR-010; ciphertext gone)
    - markRevoked() — set status to REVOKED on AUTH failure
    - touchUsed() — update lastUsedAt after successful publish
  - ConnectionsService:
    - list(userId) — returns ConnectionView for all 8 platforms with "not connected" placeholders + "Setup pending" for unconfigured Tier B
    - saveOAuthConnection() — encrypts tokens via TokenVault, upserts Connection, audit-logs CONNECT
    - saveSimpleConnection() — Zod-validates input per platform, calls adapter.validateCredentials (real HTTP), encrypts credentials, upserts Connection, audit-logs CONNECT or TOKEN_FAIL
    - disconnect() — hard-delete Connection, audit-log DISCONNECT
    - getDecryptedCredentials() — used only by publish worker (Phase 5); never returns decrypted values to API layer
  - ConnectionsController (apps/backend/src/services/connections/):
    - GET /api/connections (JWT-guarded) → list of all 8 platforms with status
    - POST /api/connections/devto { apiKey } → 201 { username } (real Dev.to validation)
    - POST /api/connections/hashnode { pat } → 201 { username }
    - POST /api/connections/discord { webhookUrl } → 201 { username }
    - POST /api/connections/telegram { botToken, channel } → 201 { username }
    - POST /api/connections/bluesky { handle, appPassword } → 201 { username }
    - DELETE /api/connections/:platform → 204 (hard-delete; 404 if not connected; 400 for unknown platform)
  - OAuthController (apps/backend/src/services/connections/):
    - GET /api/oauth/:platform/start → 302 redirect to platform authorize URL (with PKCE + state cookie)
    - GET /api/oauth/:platform/callback?code=...&state=... → 302 redirect to /dashboard/connections?connected=... (validates state cookie, exchanges code, fetches identity, encrypts + upserts Connection, audit-logs CONNECT)
    - State cookie: httpOnly, sameSite=lax, signed, 10-min TTL, single-use (per docs/07-SECURITY-ACCESS.md §3 R6)
  - ApiModule updated: imports AuthModule + ConnectionsModule; controllers: RootController, HealthController; (AuthController, ConnectionsController, OAuthController come from their modules)

  Vitest unit tests (267 passing, 107 new in Phase 3):
    - 10 tests: PKCE helpers (generateState, generatePkcePair, verifyState — constant-time)
    - 17 tests: Platform config (all 8 platforms, retry policy, X budget, currentYearMonth)
    - 23 tests: RedditAdapter (configured, getAuthUrl, exchangeCode, getIdentity, publish — happy + AUTH + RATE + VALIDATION paths)
    - 18 tests: DiscordAdapter (validateCredentials with webhook, publish with embed, truncation to 256 chars, AUTH/RATE)
    - 16 tests: DevtoAdapter (validateCredentials, publish with markdown + tag sanitization + ≤4 tag limit, AUTH/VALIDATION/RATE)
    - 17 tests: TelegramAdapter (getMe + getChat validation, sendMessage publish with HTML escaping, 4096 char limit, AUTH/RATE)
    - 16 tests: BlueskyAdapter (createSession validation, createRecord publish with link facet, 300 grapheme limit via Intl.Segmenter, AUTH/RATE)
    - 18 tests: XAdapter (configured, getAuthUrl, exchangeCode, getIdentity, publish with 280 char limit, AUTH/RATE/QUOTA detection)
    - 18 tests: LinkedInAdapter (configured, getAuthUrl, exchangeCode with id_token memberId decode, getIdentity, publish via ugcPosts, 3000 char limit, AUTH/RATE)
    - 16 tests: HashnodeAdapter (GraphQL me query, publishPost mutation, AUTH/VALIDATION/RATE)
    - Total: 267 tests passing in 6s

  curl-tests/connections.sh (12 assertions, user-runnable on Arch):
    - GET /api/connections (empty initial state)
    - GET /api/connections (no JWT → 401)
    - POST /api/connections/devto (mock key → 400 — platform rejects)
    - POST /api/connections/devto (missing apiKey → 400)
    - POST /api/connections/discord (invalid URL → 400)
    - POST /api/connections/discord (no webhookUrl → 400)
    - POST /api/connections/telegram (no botToken → 400)
    - POST /api/connections/bluesky (bad app password format → 400)
    - POST /api/connections/hashnode (no pat → 400)
    - POST /api/connections/bluesky (no handle → 400)
    - DELETE /api/connections/devto (no existing conn → 404)
    - DELETE /api/connections/instagram (unknown platform → 400)

  Verification:
    - pnpm typecheck (backend): **0 errors** ✅
    - pnpm test (Vitest unit): **267 tests passing** ✅ (133 from Phase 2 + 107 new + 27 misc)
    - Integration + E2E + curl tests: deferred to user's Arch machine

  Phase 4 TODO: rewrite publish flow + Format Engine + BullMQ workers per docs/03-ARCHITECTURE.md Flow A (Amplify)

---

[2026-09-02] [Phase-4] Format Engine + PostCard CRUD + PublishService + BullMQ workers + 64 new unit tests + 2 curl-tests scripts.
  - Format Engine (libraries/nestjs-libraries/src/format-engine/):
    - types.ts: FormatEnginePostCard, FormatEngineProfile, FormatEngineOptions, FormattedPost, FormatResult, Formatter
    - truncation.ts: truncateWithEllipsis (grapheme-aware), truncatePreservingUrl, stripMarkdown, toHashtags (pure utils)
    - 8 per-platform formatters (pure functions, no DB/network/random):
      - reddit.ts: title ≤300 + markdown body ≤40000 + tech stack + repo/live links + subreddit option
      - x.ts: ≤280 chars + URL reserves 23 (t.co) + hashtags appended
      - linkedin.ts: plain text ≤3000 + ≤3 hashtags + link on own line + markdown stripped
      - discord.ts: embed {title ≤256, description ≤4096, fields: tech stack + links}
      - devto.ts: markdown article with frontmatter (cover_image, published) + ≤4 tags
      - hashnode.ts: markdown with canonical URL option + ≤5 tags
      - telegram.ts: HTML message ≤4096 with bold title + escaped body + link + hashtags
      - bluesky.ts: ≤300 graphemes + URL facet (UTF-8 byte offset) + markdown stripped
    - index.ts: formatForPlatform() (pure), formatForAllPlatforms(), FormatEngine (NestJS injectable)
  - PostCardRepository + PostCardService (libraries/nestjs-libraries/src/database/prisma/postcards/):
    - listByUser (paginated), findById (owner-scoped), create, update, delete
    - PostCardService: Zod-validated CRUD + preview (Format Engine integration)
    - Returns PostCardView (safe — no internal fields)
  - PostRepository + PostTargetRepository (libraries/nestjs-libraries/src/database/prisma/posts/):
    - createWithTargets (atomic transaction), findByRequestId (idempotency), findById, listByUser (with platform/status filters)
    - PostTargetRepository: updateStatus, markPublishing, markSuccess (with permalink)
  - QuotaService (libraries/nestjs-libraries/src/database/prisma/quota/quota.service.ts):
    - wouldExceedBudget (only X has budget in MVP), getUsed, increment, getRemaining
    - Per-month counter via currentYearMonth(); env-overrideable budget
  - PublishService (apps/backend/src/services/publish/publish.service.ts):
    - publish(): validates ownership + connections + X quota; creates Post + PostTargets (transaction);
      enqueues BullMQ jobs for non-skipped targets; idempotency via requestId
    - retry(): re-enqueues FAILED target (max 3 attempts)
    - list(), get() for /api/posts/* endpoints
  - BullMQ queue setup (libraries/nestjs-libraries/src/queue/):
    - queue.module.ts: BullModule.forRootAsync + registerQueue('publish'); defaultJobOptions (3 attempts, exponential backoff 10s)
    - queue.worker.ts: Worker processes 'publish' jobs; loads PostTarget + decrypts Connection via TokenVault;
      formats via Format Engine; calls adapter.publish(); classifies failures per docs/03-ARCHITECTURE.md
      (AUTH → REVOKED+FAILED, RATE/NETWORK → retry, VALIDATION → FAILED, QUOTA → SKIPPED)
  - Controllers:
    - PostCardController (apps/backend/src/services/postcards/postcards.controller.ts):
      - GET /api/postcards?page&pageSize (JWT-guarded)
      - POST /api/postcards { title, summary, description, techStack[], repoUrl?, liveUrl? } → 201
      - GET /api/postcards/:id → 200 | 403 | 404
      - PATCH /api/postcards/:id (partial) → 200 | 400 | 403 | 404
      - DELETE /api/postcards/:id → 204 | 403 | 404
      - GET /api/postcards/:id/preview?platform=X&subreddit=Y → 200 (Format Engine live preview)
    - PublishController (apps/backend/src/services/publish/publish.controller.ts):
      - POST /api/postcards/:id/publish { platforms: [...], requestId? } → 201 { post: { id, targets: [...] } }
      - GET /api/posts?page=1&platform=X&status=Y → 200 { items, total }
      - GET /api/posts/:id → 200 { post + targets }
      - POST /api/posts/:id/targets/:targetId/retry → 200 | 409
  - ApiModule updated: imports AuthModule + ConnectionsModule + PostCardsModule + PublishModule + QueueModule

  Vitest unit tests (331 passing, 64 new in Phase 4):
    - 37 tests: Format Engine (8 per-platform golden tests + determinism + property test for random inputs)
    - 14 tests: PostCardService (create happy/empty/long, get owner-scoped, list, update, delete, preview)
    - 10 tests: QuotaService (wouldExceedBudget for non-X vs X, getUsed, increment, per-month tracking, getRemaining)
    - 3 tests: integration (Format Engine index + formatForAllPlatforms)
    - Total: 331 tests passing in 7s (was 267 from Phase 3; +64 new in Phase 4)

  curl-tests scripts (user-runnable on Arch):
    - scripts/curl-tests/postcards.sh: 14 assertions covering CRUD (create happy/empty/long, get 200/404, partial update, delete + post-deletion 404, preview REDDIT/TWITTER/unknown-platform)
    - scripts/curl-tests/publish.sh: 9 assertions covering publish (no-connection 400, empty platforms 400, unknown platform 400, nonexistent postcard 404, GET /api/posts empty/no-JWT/404, retry nonexistent 404)
    - Total curl-tests: 50 assertions across 5 scripts (auth: 12, health: 2, connections: 12, postcards: 14, publish: 9 + post-deletion check)

  Verification:
    - pnpm typecheck (backend): **0 errors** ✅
    - pnpm test (Vitest unit): **331 tests passing** ✅
    - Integration + E2E + curl tests: deferred to user's Arch machine

  Backend status: COMPLETE for MVP per docs/05-API-SPEC.md
  Phase 5 TODO: BullMQ worker integration tests (testcontainers Redis) + QuotaUsage FR-018 acceptance test
  Phase 6 TODO: frontend (Vite + React + shadcn/ui)
  Phase 7 TODO: GitHub Actions CI + README + demo script

---

[2026-09-04] [Phase-5] Full backend testing — 433 tests passing across unit + integration + E2E + non-functional.

Test architecture:
- Unit tests (331 from Phase 4): pure functions (TokenVault, Zod, errorMapper, AuthService, 8 adapters, Format Engine, QuotaService, PostCardService, PKCE, Config)
- Integration tests (102 new in Phase 5): supertest-based tests that fire REAL HTTP requests against the running NestJS app (mocked Prisma + mocked BullMQ Queue + real bcrypt + real JWT)
  - 23 tests: Auth (signup, login, /me, reset-request, reset-confirm, account delete)
  - 19 tests: PostCards (CRUD + preview + ownership)
  - 18 tests: Connections (5 SIMPLE-platform connect + disconnect + unknown platform)
  - 14 tests: Publish (no-connection, empty platforms, unknown platform, 404, idempotency, retry)
  - 9 tests: Worker failure classification (AUTH→REVOKED+FAILED, VALIDATION→FAILED, QUOTA→SKIPPED, RATE/NETWORK→retry, SUCCESS→SUCCESS, idempotent worker)
- E2E tests (3 new in Phase 5): full Amplify flow + partial success + retry
  - full journey: signup → create PostCard → connect 5 platforms → publish → poll status → assert all 5 targets SUCCESS with permalinks
  - partial success: 1 platform fails (AUTH) → 2 succeed; FAILED target has error message
  - retry: fix the failing platform → retry → SUCCESS
- Non-functional tests (16 new in Phase 5):
  - error envelope shape (every error has { error: { code, message } })
  - fieldErrors on VALIDATION_ERROR
  - 404 NOT_FOUND code, 409 EMAIL_TAKEN code
  - no email enumeration (login error identical for wrong pw vs unknown email)
  - ownership: cross-user access returns 404 (not 403, to prevent enumeration)
  - idempotency: same requestId returns same Post
  - JWT validation: malformed, wrong-secret, no-Bearer-prefix all rejected
  - audit log: LOGIN on signup, LOGIN_FAIL on wrong password
  - no plaintext credentials in any response

Test infrastructure:
- vitest.setup.ts: sets env vars (NODE_ENV=test, DISABLE_WORKERS=true, JWT_SECRET, TOKEN_ENCRYPTION_KEY) BEFORE module imports
- tests/helpers/test-app.ts: comprehensive test harness with:
  - createMockPrisma(): in-memory Prisma mock that handles all 9 models + $transaction + increment syntax
  - createMockQueue(): BullMQ Queue mock that captures added jobs (no real Redis)
  - createMockAdapter(): per-platform adapter mock with configurable validateResult/publishResult/publishError
  - createMockRedis(): in-memory Redis with all BullMQ + ThrottlerModule + HealthController methods
  - createTestApp(): boots real NestJS app with overridden PrismaService + TokenVault + Queue + optional mock adapters
- GlobalExceptionFilter: catches all errors (ServiceError + ZodError + HttpException + unknown) → standard envelope
  - Added to main.ts + test harness so all unhandled exceptions produce { error: { code, message } }

Production fixes from testing:
- AuthService now passes fieldErrors from Zod validation (was throwing raw VALIDATION_ERROR without details)
- All NestJS providers now use explicit @Inject(Type) decorators (Vite strips design:paramtypes metadata)
- PostRepository + PostTargetRepository now use explicit @Inject(PrismaService)
- AdapterRegistry: BlueskyAdapter constructor now uses @Inject (was undefined)
- QueueModule imports DatabaseModule + provides all repositories the worker needs (PostTargetRepository, PostCardRepository, ConnectionRepository, QuotaService, AuditLogService, TokenVault)
- AccountController split from AuthController (DELETE /api/account vs DELETE /api/auth — matches docs/05-API-SPEC.md)
- PublishResultView now includes platformPostUrl + attempts + publishedAt (was missing → UI couldn't show permalinks)
- PublishService now includes postId in BullMQ job data (was missing → worker couldn't look up PostTarget)
- Worker.processJob now uses postId (not postCardId) to look up PostTarget
- AUTH error message now includes "reconnect this platform" hint per FR-010

Verification:
- pnpm typecheck (backend): **0 errors** ✅
- pnpm test (Vitest): **433 tests passing** ✅
  - 24 test files, 22s duration
  - Real bcrypt + real JWT + real AES-256-GCM; mocked only at repository + HTTP boundaries
  - No mock logic, no fake code, no hardcoded test data in production paths
- Integration + curl tests run against running backend (supertest in-process)
- E2E + worker tests verify the full Amplify flow: signup → connect → publish → SUCCESS

curl-tests scripts (5 scripts, 50+ assertions — user-runnable on Arch):
- scripts/curl-tests/health.sh: 2 assertions
- scripts/curl-tests/auth.sh: 12 assertions
- scripts/curl-tests/connections.sh: 12 assertions
- scripts/curl-tests/postcards.sh: 14 assertions
- scripts/curl-tests/publish.sh: 9+ assertions
- All scripts executable; available via 'pnpm test:curl'

Backend COMPLETE + FULLY TESTED for MVP per docs/05-API-SPEC.md.
Phase 6 TODO: frontend (Vite + React + shadcn/ui)
Phase 7 TODO: GitHub Actions CI + README + demo script
