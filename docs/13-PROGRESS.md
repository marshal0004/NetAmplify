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

- (none)

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
