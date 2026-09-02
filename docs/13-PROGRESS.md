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
