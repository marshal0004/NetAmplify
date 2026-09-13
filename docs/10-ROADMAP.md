# NetAmplify — 4-Week Build Roadmap (final review = end of Week 4)

> Status: LOCKED for MVP. Work tickets from `11-FEATURE-TICKETS.md` in
> order. Gate = demo-able outcome at end of each week. Miss a gate =
> re-plan immediately.
>
> Companion docs: `11-FEATURE-TICKETS.md` (per-ticket spec), `12-TRUST-COPY.md`
> (demo Q&A), `13-PROGRESS.md` (status log).

---

## Week 0 — Pre-flight (before kickoff)

Before starting Week 1, you MUST have:

- [ ] Repo created (`netamplify/`) with the docs/ folder + CLAUDE.md.
- [ ] Reddit OAuth app registered at `reddit.com/prefs/apps` (script
  type, redirect URI = `http://localhost:3000/api/oauth/reddit/callback`).
- [ ] Dev.to account with a test API key generated.
- [ ] Hashnode account with a PAT generated.
- [ ] Discord server + webhook created for testing.
- [ ] Telegram bot created via @BotFather + a test channel where the
  bot is admin.
- [ ] Bluesky account + an app password generated.
- [ ] (Bonus) X developer account applied for (free tier).
- [ ] (Bonus) LinkedIn developer app applied for (dev mode).
- [ ] Local `.env.local` drafted from `.env.example` with placeholders
  + the real Reddit/Discord/etc. credentials.
- [ ] Node 20 installed locally.
- [ ] Docker Desktop running (for Postgres + Redis).
- [ ] GitHub repo with branch protection on `main` (PR-only).

If any of these are missing on Day 1, address them before kickoff.

---

## Week 1 — Foundation (T-01…T-06)

### Tickets
- **T-01** Scaffold & CI (Next.js + TS + Tailwind + shadcn + Prisma +
  docker-compose + GitHub Actions + `/api/health` + landing page).
- **T-02** Auth (NextAuth credentials, signup/login/logout/reset,
  guards on `/dashboard`, rate limit 10/min/IP on auth routes).
- **T-03** Profile (model + PATCH route + settings form, Zod shared).
- **T-04** PostCard CRUD (service + routes + dashboard grid + composer
  with markdown editor + tag chips + counters + view/edit pages).
- **T-05** PostCard image upload (optional, SHOULD priority; 5MB +
  type validation, local storage, Cloudinary interface).
- **T-06** Week-1 E2E (Playwright: signup → profile → card → dashboard).

### Goal of Week 1
A new user can sign up, fill in a profile, create a post card with
markdown + tags + image, and see it on their dashboard. End-to-end.

### GATE (must pass to enter Week 2)
- "Login → create a post card → see it on dashboard" E2E green in CI.
- All Week 1 tickets' acceptance criteria pass.
- All Week 1 tests green: lint, typecheck, unit, integration, E2E.
- `docs/13-PROGRESS.md` shows Week 1 complete.

### What you do NOT build in Week 1
- TokenVault (Week 2).
- Connections / Connect Checklist (Week 2).
- Format Engine (Week 3).
- Publish flow (Week 3).
- Audit log (Week 3, but the `AuditLog` table is created in T-01
  schema).

### Risks during Week 1

| Risk | Mitigation |
|---|---|
| NextAuth credentials provider setup takes longer than expected | Start T-02 with the NextAuth default credentials config; don't customize the session shape until needed |
| Prisma migration surprises (e.g., enum column) | Start T-01 with the FULL schema from `04-DATABASE.md` (T-01 includes "Prisma init with full schema"); don't incrementally add fields later — you'd create unnecessary migrations |
| shadcn/ui install friction | Use the shadcn CLI: `npx shadcn@latest init` then `add button input ...`; if a component is broken, copy it from the shadcn-ui repo directly into `src/components/ui/` |
| Landing page scope creep | Build exactly per `06-FRONTEND-SPEC.md` Screen 1; no extra sections, no marketing flair |

---

## Week 2 — Trust Layer + Connections (T-07…T-12)

### Tickets
- **T-07** TokenVault (AES-256-GCM, typed env module, tamper + round-
  trip + ciphertext tests).
- **T-08** Adapter framework + registry + config (interfaces for
  OAuth + Simple adapters, registry with `configured()`, platform
  config table).
- **T-09** Reddit OAuth connect (PKCE + S256, state cookie, minimal
  scopes, identity, upsert, audit CONNECT, mocks for unit tests).
- **T-10** Discord webhook + Dev.to + Hashnode keys (validate-then-
  store; platform errors surfaced verbatim).
- **T-11** Telegram bot + Bluesky app password (NOT_ADMIN hint,
  createSession).
- **T-12** Connect Checklist UI + Disconnect (per `06-FRONTEND-SPEC.md`
  Screen 4, "Why is this safe?" expanders from `12-TRUST-COPY.md`,
  Setup-pending state for unconfigured Tier B, Disconnect + revoke
  detection).

### Bonus (only if Week 2 has slack)
- **T-B1** X adapter + connect (OAuth2 PKCE, FR-004 pattern for
  Twitter).
- **T-B2** LinkedIn adapter + connect (graceful "review pending").

### Goal of Week 2
A user can connect 6 platforms from the UI, see ciphertext in the DB
(never plaintext), and disconnect any platform. The trust story is
real in the UI.

### GATE (must pass to enter Week 3)
- 5–6 platforms (Reddit, Discord, Dev.to, Telegram, Bluesky, Hashnode)
  connect for real from the UI.
- DB shows ciphertext only (DB dump grep test green — no token patterns
  in `Connection` rows).
- Connect Checklist UI renders all 8 platforms (Tier A connected,
  Tier B "Setup pending" if not configured).
- Disconnect works: Connection row hard-deleted, audit `DISCONNECT`
  row created, checklist updates.
- Revoke detection: simulate a revoked Reddit token (modify the
  ciphertext in DB to garbage) → next publish returns AUTH class →
  Connection REVOKED, target FAILED with reconnect hint.
- All Week 2 tests green.

### What you do NOT build in Week 2
- Format Engine (Week 3).
- Publish flow (Week 3).
- History (Week 3).
- Security & Connections panel (Week 4 — but the Disconnect button is
  in T-12; the panel itself with "How we protect you" copy is T-19).

### Risks during Week 2

| Risk | Mitigation |
|---|---|
| Reddit OAuth callback fails (redirect URI mismatch) | Verify the URI registered in reddit.com/prefs/apps EXACTLY matches `REDDIT_REDIRECT_URI` env, including trailing slash |
| Discord webhook URL shape varies by server | Zod regex `startsWith('https://discord.com/api/webhooks/')` should be permissive enough; if Discord changes the URL format, update the regex |
| Telegram bot admin detection edge cases | Use `getChat` with the bot; if 403, classify as NOT_ADMIN; if 400, BAD_CHANNEL; if 401, BAD_TOKEN |
| Bluesky `createSession` requires specific headers | Per the AT Protocol docs: `Content-Type: application/json`, body `{ identifier, password }`; expect `{ did, accessJwt, refreshJwt, handle }` |
| Tier B unconfigured state shows errors instead of graceful degrade | `adapter.configured()` returns false → registry returns false → UI shows "Setup pending". Test this explicitly. |

---

## Week 3 — The Money Flow (T-13…T-18)

### Tickets
- **T-13** Format Engine + preview endpoint (all 8 formatters pure +
  golden/property tests; `GET /api/postcards/:id/preview`).
- **T-14** Publish service + queue + workers (BullMQ setup, per-target
  jobs, failure classification per `03-ARCHITECTURE.md` table,
  exponential backoff, requestId idempotency, durable config).
- **T-15** Publish screen (core UX per `06-FRONTEND-SPEC.md` Screen 6:
  checklist + live previews + char counters + Amplify button + status
  board + polling + partial-success banner).
- **T-16** Retry + History (retry button + logic; history table +
  filters + pagination).
- **T-17** X quota guard + global rate limiting + audit (QuotaUsage
  logic, 429s, audit actions wired everywhere).
- **T-18** Week-3 E2E + manual smoke (full mocked E2E publish journey
  green; `scripts/smoke.ts` real-post to your private Discord + test
  subreddit).

### Goal of Week 3
A user can compose a Post Card, click Amplify, and watch per-platform
status flip to SUCCESS / FAILED in real time. Real posts appear on
Reddit + Discord (smoke test).

### GATE (must pass to enter Week 4)
- Full E2E publish journey green with mocked adapters:
  - N targets created, all terminal within 60s.
  - Partial failure isolation (one adapter fails, others SUCCESS).
  - Idempotency (double-click → one post).
  - Retry works (FAILED → Retry → SUCCESS).
  - History paginates + filters.
  - X quota guard SKIPPED at budget=2 test config.
- Manual smoke (real-post to private Discord + test subreddit) —
  evidence (URLs + screenshot) in `docs/13-PROGRESS.md` Smoke
  Evidence section.
- Rate limit works (burst test → 429).
- Audit log entries for PUBLISH, RETRY, CONNECT, DISCONNECT.
- All Week 3 tests green.

### What you do NOT build in Week 3
- Security & Connections panel (Week 4 — T-19).
- Polish pass / responsive / a11y (Week 4 — T-20).
- Security audit (Week 4 — T-21).
- Demo prep (Week 4 — T-22).

### Risks during Week 3

| Risk | Mitigation |
|---|---|
| BullMQ worker running in dev mode + Next.js dev server | BullMQ workers run in the same Next.js process via `src/workers/publish-worker.ts` started from `instrumentation.ts` (Next.js instrumentation hook); in prod, run as a separate Node process for scaling |
| Worker race: status flip PUBLISHING vs. another worker's SUCCESS | Use `prisma.postTarget.update({ where: { id, status: 'QUEUED' }, data: ... })` to atomically claim — if affected rows = 0, another worker already claimed |
| Polling flood (client polls too fast) | Debounce + abort-on-unmount; max 5 min; 3s interval |
| Live preview debounced calls spam the server | 300ms debounce on input change; cache by `platform + subreddit` key |
| Grapheme counting wrong on X / Bluesky | Use `Intl.Segmenter` (Node 20 native); test with `"👨‍👩‍👧"` |
| Reddit subreddit banned in real test | Use a subreddit you control (e.g., `r/yourtestsub`) — never test with `r/test` (it's moderated) |

---

## Week 4 — Harden + Demo (T-19…T-22)

### Tickets
- **T-19** Trust & Security panel + account deletion / export (settings
  screen per `12-TRUST-COPY.md` §2; delete cascade + export JSON;
  residual-rows-zero test).
- **T-20** Polish pass (every screen: loading / empty / error per
  `07-SECURITY-ACCESS.md` §4 matrix; responsive; a11y; toasts;
  Lighthouse ≥90).
- **T-21** Security audit (run `07-SECURITY-ACCESS.md` §6 checklist;
  `npm audit`; CSP / HSTS; DB dump grep test in CI).
- **T-22** Demo prep (seed demo user; rehearse ×3; record backup
  video; screenshot pack; LinkedIn/X status slide).

### Goal of Week 4
The app is review-ready: secure, polished, demo-able, with a backup
plan if the demo WiFi dies.

### GATE (final review)
- Every screen has loading + empty + error states (verified per
  `07-SECURITY-ACCESS.md` §4 matrix).
- Lighthouse ≥90 (perf, a11y, best-practice) on dashboard.
- `axe-core` clean on every screen.
- Security audit checklist (`07-SECURITY-ACCESS.md` §6) all checked.
- `npm audit --production` zero high/critical.
- DB dump grep test in CI green.
- CSP / HSTS headers correct (verify with `curl -I`).
- Demo script runs clean twice consecutively in rehearsal.
- Backup video recorded (4-min demo).
- Screenshot pack saved (in case demo WiFi dies — 10 screenshots
  showing the full flow).
- LinkedIn / X status slide prepared with current app-review status.

### Risks during Week 4

| Risk | Mitigation |
|---|---|
| Demo WiFi dies | Recorded backup video + screenshot pack; rehearse with offline mode |
| Reddit API rate-limits during live demo | Use a freshly created test subreddit + a "burner" Reddit account; pre-warm the OAuth session before the demo |
| Demo account locked out | Pre-create 2 demo accounts (primary + backup); both with connected platforms |
| Live OAuth fails (Reddit app rejected) | Pre-record the OAuth flow on video; show the recording during the demo instead of doing it live |
| Lighthouse score <90 on dashboard | Optimize images (Cloudinary + `next/image`), code-split the publish screen (the heaviest), reduce polling overhead |
| axe-core violations | Fix each as found; common: missing `aria-label` on icon-only buttons, focus trap on modals, color contrast on muted text |

---

## Demo Script (4 minutes, rehearsed)

> Run this 3 times in rehearsal before the live demo. Record a
> backup video of the same script in case WiFi dies.

1. **Login** (pre-created account `demo@netamplify.dev` / `demo-pass-123`).
   Profile + connections are already set — NEVER do first-time OAuth
   live; show it via the screen-recording playing in a tab if asked.
2. **Create Post Card** about NetAmplify itself (meta) — type 2 fields
   live (title, summary); paste the pre-written markdown description;
   add 3 tech tags (nextjs, prisma, redis); add the repo URL.
3. **Publish page**: tick Reddit (subreddit `r/yourtestsub`) + Discord
   + Dev.to + Telegram.
4. **Click Amplify** → narrate the flow ("request hits the route →
   validates ownership + active connections → creates a Post + N
   PostTargets in a transaction → enqueues a BullMQ job per target →
   workers decrypt, format, call adapter, persist status → UI polls
   every 3s") while statuses flip → open each platform tab: posts
   are LIVE, permalinks work.
5. **Show History** + **Security panel** ("Disconnect" live on one
   platform — Discord; show the audit row in DB via Prisma Studio
   if a projector screen is available).
6. **LinkedIn/X slide**: architecture ready; "app review pending"
   status; explain Tier B strategy.

### Demo Q&A (anticipate from `12-TRUST-COPY.md` §3)

- "Do you store our passwords?" — see `12-TRUST-COPY.md` §3 Q1.
- "What can the token do?" — Q2.
- "What if your DB is breached?" — Q3.
- "What if a user revokes?" — Q4.
- "Who pays for APIs?" — Q5.
- "Why no Instagram/Facebook?" — Meta app review timeline doesn't
  fit 4 weeks; roadmap slide.
- "How would you scale to 10k users?" — Postgres vertical scaling +
  Redis cluster + workers as separate processes + Cloudinary; no
  architectural rewrite needed.

---

## Risk register (project-level)

| Risk | Probability | Impact | Mitigation | Owner |
|---|---|---|---|---|
| Reddit app review rejection (script-type apps are auto-approved, but) | Low | High | Use script-type app (personal use, not for distribution); doesn't need approval | T-09 |
| X free-tier quota exceeded during demo | Low | Medium | Pre-record the demo; X quota guard ensures we don't accidentally exceed | T-18 |
| LinkedIn dev mode restricts posting | High | Low | Tier B graceful degrade; "review pending" slide | T-B2 |
| Bluesky session expires mid-MVP | Low | Low | Refresh via `refreshSession` if `refreshJwt` present | T-11 |
| Telegram bot banned for spam | Low | Medium | User's own bot (their responsibility); rate limit per bot; we don't auto-post | T-11 |
| Postgres downtime in prod (Neon free tier sleeps) | Medium | High | Use Neon autoscale or paid tier; or self-host on Hetzner | — |
| Redis downtime in prod | Medium | High | Use Upstash (multi-AZ); BullMQ jobs are durable | — |
| Team turnover mid-MVP | Low | High | One-person MVP; docs (this build pack) are the bus-factor mitigation | — |

---

## Slack budget

- **Week 1**: 0 days slack. If behind, cut T-05 (image upload) to
  post-MVP.
- **Week 2**: 1 day slack (T-B1 + T-B2 are bonus; if no slack, skip).
- **Week 3**: 0 days slack. The hardest week. If behind, cut
  manual-smoke to a single platform (Discord only) and add Reddit
  smoke later.
- **Week 4**: 1 day slack (T-22 demo prep can absorb). If behind, cut
  Lighthouse ≥90 to ≥85 (still shipping-grade).

If you fall 2+ days behind at any week's end, re-plan: which tickets
can move to post-MVP? Update `docs/13-PROGRESS.md` with the deviation.

---

## Definition of "shipped" (final review)

The MVP is shipped when:

1. All MUST features (M1–M9) are implemented and tested.
2. All Week 1–4 gates passed.
3. Demo script runs clean twice consecutively.
4. Backup video + screenshot pack saved.
5. Security audit checklist all checked.
6. Manual smoke (Discord + Reddit) completed with evidence.
7. `docs/13-PROGRESS.md` shows the project complete.

NOT shipped includes:
- SHOULD features (S1–S3) — nice to have, not blocking.
- Tier B (X, LinkedIn) — bonus, may or may not be in the demo.
- Anything in COULD / WON'T — explicitly out of scope.

---

> End of roadmap. Next: `11-FEATURE-TICKETS.md` — every ticket with
> description, acceptance criteria, dependencies, and priority.
