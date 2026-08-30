# NetAmplify — Agent Constitution
> "Post once. Get seen everywhere."

A student creates a Post Card once; NetAmplify formats it per-platform and
publishes it to Reddit, Discord, Dev.to, Telegram, Bluesky, Hashnode
(+ X, LinkedIn when connected) using the USER'S OWN credentials.
**We NEVER see or store any platform password. Ever.**

---

## 0. How to use this file
This file is the **constitution** for every AI coding agent (Claude Code, Cursor,
Continue, etc.) that works on NetAmplify. It is the first file you read at the
start of every session, and the file you re-check against before any commit.

Read order on first session of a new ticket:
1. This file (`CLAUDE.md`)
2. `docs/00-INDEX.md` — orientation
3. `docs/15-AGENT-PLAYBOOK.md` — how to operate per session
4. The ticket you are working on in `docs/11-FEATURE-TICKETS.md`
5. Any docs the ticket references (e.g., `04-DATABASE.md`, `05-API-SPEC.md`)
6. `docs/13-PROGRESS.md` — what the last agent did

You may NOT skip any of these. If a doc is missing or inconsistent, STOP and
ask the human before writing code.

---

## 1. Tech Stack (LOCKED — changing anything here requires my written approval)

| Layer | Choice | Version | Notes |
|---|---|---|---|
| Runtime | Node.js | 20 LTS | required by Next 14 |
| Framework | Next.js | 14.x App Router | route handlers as API |
| Language | TypeScript | 5.x strict, `strictNullChecks`, `noUncheckedIndexedAccess` | ZERO `any`, ZERO non-null `!` outside tests |
| Styling | Tailwind CSS | 3.4+ | design tokens in `tailwind.config.ts` |
| UI kit | shadcn/ui | latest | Radix + Tailwind; we OWN the components (no version-lock) |
| ORM | Prisma | 5.x | Postgres provider |
| DB | PostgreSQL | 16 | docker-compose for dev/test |
| Cache/queue | Redis | 7 | docker-compose for dev/test |
| Queue lib | BullMQ | 4.x | per-target jobs, exponential backoff |
| Auth | NextAuth.js | v4 (credentials provider) | Google OAuth CUT from MVP |
| Validation | Zod | 3.x | single source of truth, client+server |
| Unit tests | Vitest | 1.x | ≥90% on vault/formatters/services |
| E2E tests | Playwright | 1.x | CI + manual |
| Markdown | `react-markdown` + `remark-gfm` | — | sanitized (no raw HTML) |
| Grapheme counting | `grapheme-splitter` or Intl.Segmenter | — | X / Bluesky truncation must be grapheme-correct |
| HTTP client | native `fetch` (Node 20 has it) | — | no `axios` unless ticket T-B requires it |
| Uploads | local disk (dev) + Cloudinary interface (prod-ready) | — | interface is the seam; swap is config-only |
| Email | transactional provider (Resend / Postmark) | — | only for password-reset emails in MVP |

No other dependencies may be added without explicit human approval (see Rule 2).

---

## 2. Commands (LOCKED)

```bash
# Development
npm run dev                       # Next.js dev server (port 3000)
npm run build                      # production build
npm run lint                       # ESLint (Next + strict + Tailwind plugin)
npm run typecheck                  # tsc --noEmit
npm run test                       # Vitest unit + integration
npm run test:e2e                   # Playwright (separate so CI can run in own job)
npm run test:watch                 # Vitest watch for dev loop

# Database
npx prisma migrate dev             # apply migrations to dev DB
npx prisma migrate dev --name <x> # create a new migration
npx prisma studio                  # inspect dev DB
npx prisma generate                # regenerate client (after schema edit)

# Infrastructure
docker compose up -d                                  # postgres + redis (dev)
docker compose -f docker-compose.test.yml up -d       # postgres + redis (test)

# Smoke (ONLY place real platform calls happen)
npm run smoke                      # scripts/smoke.ts — manual, never in CI
```

Every command above MUST be green before a commit. CI runs them in the same
order. A red pipeline = the ticket is NOT done.

---

## 3. Non-Negotiable Rules (numbered — agents cite by number in PRs)

1. **Scope.** Work ONLY on the current ticket(s) from `docs/11-FEATURE-TICKETS.md`
   for the current week in `docs/10-ROADMAP.md`. Never build ahead. Never build
   "nice to have" extras. If you discover something adjacent, write a ticket
   stub in `docs/11-FEATURE-TICKETS.md` and STOP.

2. **Dependencies.** NEVER install a new dependency (npm package, even a dev
   one) without asking me first. Post the proposed package, reason, and a
   one-line alternative I might prefer; wait for "approved".

3. **Credentials.** NEVER store a platform password. OAuth flows exchange codes
   for tokens; API-key / webhook / bot-token / app-password flows store
   user-pasted credentials. ALL credentials go through the TokenVault
   (`src/lib/vault/token-vault.ts`) as AES-256-GCM ciphertext. Plaintext exists
   only in-memory inside workers / connect-validation, never in DB, logs,
   responses, or client bundles.

4. **Platform isolation.** All platform API access happens ONLY inside
   `src/lib/platforms/` adapters. UI components, route handlers, services,
   and workers MUST NOT import platform SDKs or call platform APIs directly —
   they go through the adapter interface in `src/lib/platforms/registry.ts`.

5. **Ownership scoping.** Every Prisma read/write of a user-owned model
   (`PostCard`, `Connection`, `Post`, `Profile`, `AuditLog`) MUST include
   `where: { userId: <session.user.id>, ... }`. The `:id` in a URL locates the
   row; ownership comes from the session. A user must never read/modify
   another user's data, even by direct API call. Enforced by review checklist
   AND a 403 test per resource.

6. **Pure formatters.** Formatters in `src/lib/formatters/` are pure functions:
   no DB, no network, no `Date.now()`, no `Math.random()`. Deterministic input
   → identical output, always. This is what makes golden-file tests possible.

7. **Mocked tests.** Platform APIs are ALWAYS mocked in tests. Real posts
   happen ONLY when I run the manual smoke script (`scripts/smoke.ts`).
   Integration tests use the adapter interface as the seam; mock at that
   boundary, not at `fetch`.

8. **License hygiene.** Do NOT copy code from Postiz or any AGPL/GPL project.
   Read official platform API docs and write our own implementation. If you
   are unsure whether a snippet is "inspired by" or "copied from", STOP and
   ask. See `docs/16-OBSERVABILITY.md` §6 and the LICENSE section in the repo.

9. **Ticket hygiene.** After every ticket, in this order:
   1. `npm run lint && npm run typecheck && npm run test && npm run test:e2e`
   2. Fix ALL failures (no skipping, no `// TODO` for failing tests)
   3. Update `docs/13-PROGRESS.md` with the log entry template
   4. Conventional commit: `feat(T-xx): <subject>` / `fix(T-xx): ...` /
      `test(T-xx): ...` / `docs: ...` / `chore: ...`
   5. STOP. Do not start the next ticket in the same session unless I say so.

10. **Config, not magic numbers.** Hardcoded caps from
    `docs/03-ARCHITECTURE.md` platform table (char limits, retry counts, X
    monthly quota, rate-limit thresholds) live in `src/lib/config/platforms.ts`
    and `src/lib/config/limits.ts`. Logic imports from there; tests can override
    these constants.

11. **Error surfaces.** Never leak raw DB errors or raw platform API errors to
    the client. Map them via the error mapper (`src/lib/errors/mapper.ts`)
    to the error envelope in `docs/05-API-SPEC.md`. Platform messages that
    ARE surfaced to the user (e.g., "Bluesky rejected these credentials")
    must pass through a sanitizer that strips tokens, URLs with creds, and
    internal paths.

12. **Logging discipline.** Log with `{ route, userId, requestId, latencyMs,
    outcome }`. NEVER log credentials, decrypted content, full request bodies
    for credential routes, or anything matching the secret regex in
    `docs/16-OBSERVABILITY.md` §3. A scanner test runs in CI; a single match
    fails the build.

13. **TypeScript discipline.** Strict mode. No `any` (use `unknown` + narrow).
    No non-null `!` outside tests. Prefer `Result<T, E>` discriminated unions
    for service returns. Use branded types for IDs (`type UserId = string &
    { __brand: 'UserId' }`) — see `docs/08-CODING-STANDARDS.md` §3.

14. **Accessibility.** Every interactive element has a visible label, a
    keyboard-reachable path, and AA contrast. New components must pass
    `axe-core` in the relevant Playwright test. See `docs/06-FRONTEND-SPEC.md`
    §A11y.

15. **Git hygiene.** One logical change per commit. Branch name:
    `t<NN>-<kebab-slug>` (e.g., `t07-token-vault`). PR title matches commit
    subject. Squash-merge is allowed. No `--no-verify` to bypass hooks.

---

## 4. Definition of Done (every ticket, ALL boxes checked)

- [ ] Zero TypeScript errors (`npm run typecheck` clean)
- [ ] Zero ESLint errors or warnings (`npm run lint` clean)
- [ ] Unit tests pass — every logic branch including error paths
- [ ] Integration tests pass — including ownership 403 path
- [ ] E2E test for the ticket's user-facing flow is green
- [ ] UI has loading + error + empty states for every async surface
- [ ] Server-side Zod validation on every input
- [ ] Ownership enforced (`userId` scoping) — verified by a 403 test
- [ ] No credential patterns in any API response (scanner test green)
- [ ] No new `any` introduced (`grep -r ': any' src/ | wc -l` not increased)
- [ ] `docs/13-PROGRESS.md` updated with the log entry
- [ ] Conventional commit message with ticket ID
- [ ] Manual smoke (only if ticket touches adapters) — evidence in PROGRESS
- [ ] A11y: new components pass `axe-core` in the relevant Playwright test

A ticket is NOT done until every box above is checked. Partial completion is
not a state — it is "in progress" with a note in PROGRESS.md explaining what
remains.

---

## 5. Out of Scope (MVP) — do NOT build

The following are explicitly excluded from v1. Building any of them requires
a written scope change. If a ticket seems to imply one, STOP and ask.

- Instagram / Facebook publishing (Meta verification — roadmap slide only)
- AI rewriting (tone, summaries, hashtags) — post-MVP `C2`
- Scheduling / queueing for future publish times — post-MVP `C1`
- Analytics beyond post status counts — post-MVP `C3`
- Payments / billing / subscription tiers — freemium later
- Teams / organizations / shared connections
- Recruiter browsing / discovery feed — post-MVP `C5`
- Mobile app (React Native or otherwise)
- Google OAuth (cut from MVP — see `docs/07-SECURITY-ACCESS.md` §1)
- Email verification flows beyond a basic 1-hour reset token
- Scraping of any platform
- Auto-follow / DM automation / engagement bot
- Real-time WebSocket push (we poll; WebSocket is post-MVP)

---

## 6. Locked Decisions (immutable without written approval)

| Decision | Locked Value |
|---|---|
| Platforms — Tier A (build first) | Reddit (OAuth), Discord (webhook), Dev.to (API key), Telegram (bot token), Bluesky (app password), Hashnode (PAT) |
| Platforms — Tier B (bonus attempts) | X (OAuth, free tier), LinkedIn (OAuth, dev-mode attempt; fallback slide if review pending) |
| Excluded | Instagram / Facebook (Meta verification — roadmap slide only) |
| Timeline | 4-week compressed MVP → final review demo |
| Trust model | OAuth 2.0 + PKCE / API keys / webhooks / bot tokens — **zero passwords ever**, encrypted vault, revocable |
| Connection UX | One-time Connect Checklist (per-platform), then "compose → tick → Amplify" forever |
| Payments | None in MVP; users post from own accounts = free for them & us; future freemium |
| Postiz | Reference only — **no code copying (AGPL-3.0)** |
| Post volume math | Student posts 2–3×/day → far under X free tier at MVP scale |
| Stack | See §1 above; no swaps without approval |

---

## 7. What to do when you're stuck

- **Ambiguous spec?** Open a `## Open Questions` section at the bottom of
  `docs/13-PROGRESS.md`, write the question, and STOP. Do NOT guess.
- **Test fails for a reason you can't fix in 15 minutes?** STOP, write the
  failing assertion + the error + your hypothesis in PROGRESS.md, commit with
  `wip(T-xx): <one-line>`, and STOP. I will triage.
- **Tempted to refactor code outside the ticket?** Don't. Write a ticket stub
  in `docs/11-FEATURE-TICKETS.md` with the refactor proposal and continue your
  current ticket.
- **Tempted to "improve" a locked decision?** Don't. Open a `## Proposed
  Deviations` section at the bottom of PROGRESS.md with the rationale; I will
  review and either approve or reject.

---

## 8. Agent session protocol (re-read at the start of every ticket)

```
1. Read CLAUDE.md (this file) and docs/13-PROGRESS.md.
2. Read the ticket you're working on in docs/11-FEATURE-TICKETS.md.
3. Read every doc the ticket references.
4. Skim docs/15-AGENT-PLAYBOOK.md — the operating manual.
5. State the ticket's acceptance criteria back to me in your first message.
6. Wait for "approved".
7. Implement, following CODING-STANDARDS + Definition of Done.
8. Run lint + typecheck + tests + e2e; fix ALL failures.
9. Update docs/13-PROGRESS.md.
10. Conventional commit `feat(T-xx): <subject>`.
11. STOP. Reply with: what changed, what tests pass, what's next.
```

This protocol is what makes a 4-week MVP shippable. Skipping any step is the
fastest way to ship spaghetti.

---

> "Post once. Get seen everywhere." Now go build it, one ticket at a time.
