# Documentation Index — NetAmplify v1.1

> Read these docs **in this order** on the first session of any ticket.
> Files are numbered because reading order matters: later docs reference earlier ones.

---

## Read order (mandatory)

| # | File | What it answers | When to re-read |
|---|---|---|---|
| — | `../CLAUDE.md` | Constitution, stack, commands, rules, DoD, scope | Every session |
| 00 | `00-INDEX.md` | This file — orientation + glossary | When you forget a term |
| 01 | `01-PRD.md` | What & why, users, app flow, success metrics | When scoping or writing copy |
| 02 | `02-SRS.md` | Numbered requirements FR-001..FR-018 + NFRs | Every ticket — to find its FR |
| 03 | `03-ARCHITECTURE.md` | System design, flows, adapters, env, platform limits | When touching flows or adapters |
| 04 | `04-DATABASE.md` | Prisma schema — source of truth for data | When touching models or queries |
| 05 | `05-API-SPEC.md` | Every endpoint: in / out / errors | When building or calling an API |
| 06 | `06-FRONTEND-SPEC.md` | Design system, screens, states, integrations | When building any UI |
| 07 | `07-SECURITY-ACCESS.md` | Auth, roles, isolation rules, error matrix, edge cases | Every ticket that touches data or auth |
| 08 | `08-CODING-STANDARDS.md` | Mandatory code conventions + examples | When writing any code |
| 09 | `09-TESTING-STRATEGY.md | What and how to test, CI, factories | Every ticket (you write tests) |
| 10 | `10-ROADMAP.md` | 4-week plan → final review demo | To know which week/tickets are active |
| 11 | `11-FEATURE-TICKETS.md` | Build checklist — one ticket = one prompt = one session | Every session (your ticket lives here) |
| 12 | `12-TRUST-COPY.md` | Exact trust/security copy for UI + viva answers | When writing UI copy or rehearsing demo |
| 13 | `13-PROGRESS.md` | Living status log (agent updates after every ticket) | Every session (what the last agent did) |
| 14 | `14-DEPLOYMENT.md` | Production deployment + ops runbook | Week 4 + any infra ticket |
| 15 | `15-AGENT-PLAYBOOK.md` | AI agent operating manual — session protocol | Every session (operating rules) |
| 16 | `16-OBSERVABILITY.md` | Logs, metrics, error tracking, secrets scanning | Every ticket that emits logs or metrics |

---

## Glossary (canonical definitions — referenced by other docs)

### Content model

- **Post Card** — Canonical content unit. Fields: `title`, `summary`,
  `description` (markdown), `techStack[]`, `repoUrl`, `liveUrl`, optional
  `imageUrl`. A Post Card is NOT a published post — it is the source from
  which posts are formatted.
- **Profile** — User-facing identity: name, headline (≤140), college,
  graduationYear, githubUrl, portfolioUrl. Used by formatters to credit
  the author and link back to their work.
- **Tech tag** — A single string label (e.g., `nextjs`, `prisma`).
  1–10 tags per Post Card. Used by formatters to derive hashtags on X /
  LinkedIn and tags on Dev.to / Hashnode.

### Connection model

- **Connection** — A user's linked platform credential (OAuth tokens, API
  key, webhook URL, bot token, or app password). Stored encrypted as
  `credentialsCipher` (one ciphertext blob per Connection). Has status
  `ACTIVE` / `REVOKED` / `ERROR`. One Connection per user per platform
  (enforced by `@@unique([userId, platform])`).
- **Connect Checklist** — One-time per-user screen to connect platforms,
  one by one. After it's done, the user reuses connections forever.
- **Tier A** — Platforms live in MVP: `REDDIT`, `DISCORD`, `DEVTO`,
  `TELEGRAM`, `BLUESKY`, `HASHNODE`.
- **Tier B** — Bonus attempts: `TWITTER`, `LINKEDIN`. Work if our app
  credentials are approved; UI degrades gracefully to "Setup pending"
  otherwise.

### Publishing model

- **Amplify** — The one-click publish action. Creates a `Post` + one
  `PostTarget` per selected platform, enqueues a BullMQ job per target.
- **Post** — One Amplify event. Belongs to a Post Card. Has multiple
  PostTargets (one per platform). Carries a `requestId` for idempotency.
- **PostTarget** — One platform attempt within a Post. Has its own
  status lifecycle: `QUEUED` → `PUBLISHING` → `SUCCESS` | `FAILED` |
  `SKIPPED`. Carries `platformPostUrl`, `error`, `errorClass`, `attempts`.
- **Format Engine** — Pure functions transforming one Post Card → N
  platform-specific payloads, respecting each platform's char limits and
  truncation strategy. Lives in `src/lib/formatters/`. No DB, no network,
  no `Date.now()`.
- **Adapter** — The ONLY module allowed to call a platform API. Lives in
  `src/lib/platforms/<platform>/`. Implements either the OAuth-adapter or
  Simple-adapter contract (see `03-ARCHITECTURE.md` §Adapter Contracts).
- **Registry** — `src/lib/platforms/registry.ts`. Maps `Platform` enum →
  adapter instance + metadata (`kind`, `scopes?`, `configured()`). Drives
  the "Setup pending" UI for Tier B.
- **Failure class** — `AUTH` / `RATE` / `VALIDATION` / `NETWORK` / `QUOTA`.
  Worker classifies every adapter failure into one of these and persists
  it on the `PostTarget.errorClass` column. See `03-ARCHITECTURE.md` §Failure
  Classification.

### Security model

- **TokenVault** — AES-256-GCM encrypt/decrypt service in
  `src/lib/vault/token-vault.ts`. Only ciphertext touches the DB; plaintext
  exists only in-memory inside workers / connect-validation. Key from
  `TOKEN_ENCRYPTION_KEY` env (32-byte base64).
- **PKCE** — Proof Key for Code Exchange. OAuth 2.0 extension used for
  Reddit / X / LinkedIn. `code_verifier` (random) + `code_challenge`
  (S256 hash) sent on `/start`, verifier sent on `/callback`. State cookie
  stores `{ state, verifier, returnTo }`.
- **State cookie** — `httpOnly`, `sameSite=lax`, signed, 10-min TTL,
  single-use (deleted on read). Prevents CSRF on OAuth callbacks.
- **Disconnect** — Hard-delete the `Connection` row (ciphertext gone).
  Audit `DISCONNECT` logged. Future publishes targeting that platform
  return `400 invalidPlatforms`.
- **Revoke** — On the platform side (e.g., Reddit user revokes our app
  from `reddit.com/settings/apps`). Our adapter call fails with AUTH;
  we mark the Connection `REVOKED` and surface "Reconnect this platform".

### Operational model

- **Smoke test** — `scripts/smoke.ts`. The ONLY place real platform posts
  happen. Run manually before demo. Never in CI.
- **Idempotency key** — `requestId` on `Post`. Client-generated UUID.
  Prevents double-click / two-tab Amplify from creating two posts. Server
  upserts on `requestId` and returns the existing Post if seen.
- **Quota guard** — `QuotaUsage` table tracks per-platform monthly counts.
  When X month count exceeds `X_MONTHLY_POST_BUDGET`, the X target is set
  to `SKIPPED` (not `FAILED`) with a clear message.
- **Audit log** — `AuditLog` row for security-relevant actions: LOGIN,
  LOGIN_FAIL, CONNECT, DISCONNECT, PUBLISH, RETRY, TOKEN_FAIL,
  ACCOUNT_DELETE. NEVER logs credentials or decrypted content.

---

## Cross-reference: where each concept lives

| Concept | Spec doc | Code location |
|---|---|---|
| Post Card fields | `02-SRS.md` FR-003 · `04-DATABASE.md` | `prisma/schema.prisma` · `src/server/services/postcards.ts` |
| Format Engine | `02-SRS.md` FR-011 · `03-ARCHITECTURE.md` | `src/lib/formatters/*.ts` |
| Adapter contract | `03-ARCHITECTURE.md` §Adapter Contracts | `src/lib/platforms/*/adapter.ts` |
| TokenVault | `02-SRS.md` FR-009 · `07-SECURITY-ACCESS.md` §1 | `src/lib/vault/token-vault.ts` |
| OAuth flow | `03-ARCHITECTURE.md` Flow B | `src/app/api/oauth/[platform]/{start,callback}/route.ts` |
| Simple-credential flow | `03-ARCHITECTURE.md` Flow C | `src/app/api/connections/[platform]/route.ts` |
| Publish flow | `03-ARCHITECTURE.md` Flow A | `src/server/services/publish.ts` · `src/workers/publish-worker.ts` |
| Quota guard | `02-SRS.md` FR-018 · `03-ARCHITECTURE.md` §Platform Config | `src/lib/quota/x-monthly.ts` |
| Error envelope | `05-API-SPEC.md` §Error envelope | `src/lib/errors/mapper.ts` |
| Status chips | `06-FRONTEND-SPEC.md` §Components | `src/components/ui/status-chip.tsx` |
| Trust copy | `12-TRUST-COPY.md` (verbatim) | `src/components/connections/trust-expander.tsx` |
| Audit log | `02-SRS.md` FR-017 · `16-OBSERVABILITY.md` §4 | `src/server/services/audit.ts` |

---

## Doc versioning rules

- Docs are versioned with the repo: a PR that changes a doc must update the
  doc's `v1.x` header if it changes meaning (not just typos).
- `docs/13-PROGRESS.md` is the only file that changes every session.
- `docs/00-INDEX.md` MUST stay in sync with the file list in `../CLAUDE.md`
  §6 (locked file tree).
- If you add a new doc (e.g., `17-X.md`), update this index AND the file tree
  in `CLAUDE.md` AND add a one-line read-order note.

---

## "I'm lost" — quick recovery

If you start a session and don't know what to do:

1. Read `../CLAUDE.md` §8 (agent session protocol).
2. Read `docs/13-PROGRESS.md` — the last entry tells you the current ticket
   and the next step.
3. Read `docs/11-FEATURE-TICKETS.md` — find the current ticket.
4. Read `docs/15-AGENT-PLAYBOOK.md` — the operating manual.

If PROGRESS says "STOP — waiting for human", do NOT proceed. Reply with
"Ready when you are" and wait.
