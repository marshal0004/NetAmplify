# NetAmplify — Agent Playbook (operating manual)

> This doc is the **operating manual** for AI coding agents (Claude
> Code, Cursor, Continue, etc.) that work on NetAmplify. Read it on
> the first session of any ticket, and skim it on every session.
>
> Companion docs: `CLAUDE.md` (constitution), `13-PROGRESS.md`
> (status), `11-FEATURE-TICKETS.md` (your ticket), `08-CODING-STANDARDS.md`
> (DoD).

---

## 1. Why this doc exists

`CLAUDE.md` is the constitution — what's locked, what's forbidden,
what the Definition of Done is. This doc is the **playbook** — how to
operate per session, how to read context, how to write commits, when
to STOP.

If `CLAUDE.md` answers "what?", this doc answers "how?".

---

## 2. The session protocol (every ticket session)

```
Step 1: ORIENT (3 minutes)
  ├─ Read CLAUDE.md (skim — refresh rules)
  ├─ Read docs/13-PROGRESS.md (FULL — what the last agent did)
  ├─ Read docs/11-FEATURE-TICKETS.md (your ticket)
  ├─ Read every doc your ticket references
  ├─ Skim docs/15-AGENT-PLAYBOOK.md (this doc)
  └─ Skim docs/13-PROGRESS.md Open Questions + Proposed Deviations

Step 2: CONFIRM (1 minute)
  ├─ State your ticket's acceptance criteria back to the human
  ├─ Wait for "approved"
  └─ Do NOT start coding before approval

Step 3: IMPLEMENT (the bulk of the session)
  ├─ One file at a time; one logical change per commit
  ├─ Run lint + typecheck + unit tests after each file
  ├─ Don't build ahead — stay in scope of your ticket
  └─ Update docs/13-PROGRESS.md "In Progress" line daily

Step 4: VERIFY (end of session)
  ├─ npm run lint && npm run typecheck && npm run test && npm run test:e2e
  ├─ Fix ALL failures (no skipping, no TODOs)
  ├─ Update docs/13-PROGRESS.md (full log entry)
  └─ Conventional commit: feat(T-xx): <subject>

Step 5: STOP
  ├─ Reply: what changed, what tests pass, what's next
  ├─ Do NOT start the next ticket in the same session
  └─ Wait for "execute T-0Y"
```

---

## 3. What to read first (per session)

| Order | Doc | Why |
|---|---|---|
| 1 | `CLAUDE.md` | Constitution; rules; DoD |
| 2 | `docs/13-PROGRESS.md` | What the last agent did; current ticket; open questions |
| 3 | `docs/15-AGENT-PLAYBOOK.md` (this) | Operating manual |
| 4 | `docs/11-FEATURE-TICKETS.md` → your ticket | What to build |
| 5 | Each doc your ticket references | Deeper context (FRs, schema, API) |

If you skip any of these, you will miss critical context. The #1 cause
of bad AI agent work on this project is skipping docs.

---

## 4. Where to find what

| You want to know... | Read... |
|---|---|
| What I'm building this ticket | `docs/11-FEATURE-TICKETS.md` → your ticket |
| What the last agent did | `docs/13-PROGRESS.md` → "Completed" + log entries |
| The DB schema | `docs/04-DATABASE.md` → `prisma/schema.prisma` |
| The API endpoint I'm calling | `docs/05-API-SPEC.md` |
| The UI design | `docs/06-FRONTEND-SPEC.md` → your screen |
| The acceptance criteria for an FR | `docs/02-SRS.md` → your FR |
| The system design / flow | `docs/03-ARCHITECTURE.md` → your flow |
| The error message I should show | `docs/12-TRUST-COPY.md` §7 |
| The trust copy I should paste | `docs/12-TRUST-COPY.md` §1, §2, §5, §6 |
| The threat model | `docs/07-SECURITY-ACCESS.md` §6 |
| The code convention | `docs/08-CODING-STANDARDS.md` |
| The test pattern | `docs/09-TESTING-STRATEGY.md` |
| What week we're in | `docs/10-ROADMAP.md` → current week |
| How to deploy | `docs/14-DEPLOYMENT.md` |
| What logs / metrics to emit | `docs/16-OBSERVABILITY.md` |

---

## 5. Rules of engagement (non-negotiable)

### 5.1 Scope
- Work ONLY on the current ticket(s) per `docs/11-FEATURE-TICKETS.md`.
- NEVER build ahead. NEVER build "nice to have" extras.
- If you discover adjacent work, write a ticket stub at the bottom of
  `docs/11-FEATURE-TICKETS.md` and STOP.

### 5.2 Dependencies
- NEVER install a new dependency without asking first. Post the
  proposed package + reason + alternative; wait for "approved".
- This includes dev dependencies. ESLint plugins, TypeScript
  helpers, etc. — all require approval.

### 5.3 Credentials
- NEVER store a platform password.
- NEVER log credentials, decrypted content, or anything matching the
  secret regex (`16-OBSERVABILITY.md` §3).
- NEVER access `process.env` directly — use `env` from
  `src/lib/config/env.ts`.
- NEVER return decrypted credentials from a service. Only the worker
  and connection-validation see plaintext, in-memory, transient.

### 5.4 Ownership
- Every Prisma read/write of a user-owned model MUST include `userId`
  in `where`. No exceptions.
- A user must never read/modify another user's data, even by direct
  API call.

### 5.5 Formatters
- Formatters are pure: no DB, no network, no `Date.now()`, no
  `Math.random()`.
- Same input → identical output, always.

### 5.6 Tests
- Platform APIs are ALWAYS mocked in tests. The ONLY place real
  platform calls happen is `scripts/smoke.ts`, run manually.
- Don't use `setTimeout` to wait — use the polling helper.
- Don't use `Math.random` in factories — use `counter++`.

### 5.7 Errors
- Never leak raw DB or platform errors to the client.
- Use the error mapper (`src/lib/errors/mapper.ts`).
- Log structured (route, userId, requestId, latencyMs, outcome).

### 5.8 TypeScript
- Strict mode. No `any` (use `unknown` + narrow). No non-null `!`
  outside tests.
- Prefer `Result<T, E>` discriminated unions for service returns.
- Use branded types for IDs.

### 5.9 Accessibility
- Every interactive element has a label, keyboard path, focus ring,
  AA contrast.
- New components pass `axe-core` in the relevant Playwright test.

### 5.10 Git
- One logical change per commit.
- Branch: `t<NN>-<kebab-slug>` (e.g., `t07-token-vault`).
- Commit: `feat(T-xx): <subject>` / `fix(T-xx): ...` / `test(T-xx):
  ...` / `docs: ...` / `chore: ...`.
- NEVER `--no-verify` to bypass hooks.
- Squash-merge is allowed.

---

## 6. Communication protocol with the human

### 6.1 First message of the session

```
I'm picking up T-<NN> — <short-name>.

Acceptance criteria:
  - <AC 1>
  - <AC 2>
  - ...

Files I plan to touch:
  - <file 1>
  - <file 2>
  - ...

Tests I'll write:
  - <test 1>
  - <test 2>
  - ...

Reading: CLAUDE.md, docs/13-PROGRESS.md, docs/11-FEATURE-TICKETS.md#T-<NN>,
<other docs>.

Ready to start on "approved".
```

### 6.2 During the session

- After each file: "Wrote `<file>`. Running typecheck + lint + unit."
- On a test failure: "Test `<name>` failing on `<assertion>`. Root
  cause: `<hypothesis>`. Fix: `<plan>`. Proceeding."
- On a decision point: "Reached a decision point: <describe>. Option A
  / Option B. I'm choosing A because <reason>. Approve?"
- On a blocker: "BLOCKED: <describe>. Need: <what I need from you>.
  Stopping here."

### 6.3 End of session

```
T-<NN> complete.

What changed:
  - <file 1>: <one-line>
  - <file 2>: <one-line>
  - ...

Tests:
  - lint: ✅
  - typecheck: ✅
  - unit: ✅ (X passed / 0 failed)
  - integration: ✅ (Y passed / 0 failed)
  - e2e: ✅ (Z passed / 0 failed)

Commit: <hash>
PROGRESS.md updated: yes

What's next: T-<NN+1> — <next ticket short name>.
```

---

## 7. When to STOP (immediately)

Stop the session and reply "Stopping — need human input" if:

1. **Ambiguous spec**: the ticket references an FR that's not clear.
   Write the ambiguity to `docs/13-PROGRESS.md` "Open Questions" and
   STOP.

2. **Test fails for a reason you can't fix in 15 minutes**: write the
   failing assertion + error + hypothesis to PROGRESS.md, commit with
   `wip(T-xx): <one-line>`, and STOP.

3. **Tempted to refactor code outside the ticket**: don't. Write a
   ticket stub at the bottom of `docs/11-FEATURE-TICKETS.md` with the
   refactor proposal and continue your current ticket.

4. **Tempted to "improve" a locked decision**: don't. Open a
   `Proposed Deviations` section in PROGRESS.md with the rationale;
   STOP and wait.

5. **A dependency is missing**: don't `npm install` it. Reply:
   "Proposed dependency: `<package>@<version>`. Reason: `<why>`.
   Alternative: `<maybe a different package or DIY>`. Approve?" STOP
   and wait.

6. **You finished your ticket**: STOP. Don't start the next one.
   Reply per §6.3 above.

7. **You hit the end of the day / a token limit**: STOP. Update
   PROGRESS.md "In Progress" line + log entry. Commit (even if WIP).
   Reply: "Session ending. WIP committed at `<hash>`. Next session
   continues from there."

---

## 8. How to handle common situations

### 8.1 "The ticket references an FR-xxx that doesn't exist"

Stop. Add to Open Questions: "FR-xxx referenced by T-NN doesn't exist
in docs/02-SRS.md." STOP. (Don't guess which FR it meant.)

### 8.2 "The schema needs a new column"

If the ticket says "add field X" → follow the ticket. If you discover
a need mid-implementation → write a ticket stub at the bottom of
`docs/11-FEATURE-TICKETS.md` proposing the schema change and continue
your current ticket without the new column. The new column is a
separate ticket.

### 8.3 "I need to refactor code from another ticket"

Don't. Write a ticket stub proposing the refactor at the bottom of
`docs/11-FEATURE-TICKETS.md`. Continue your current ticket working
around the existing code.

### 8.4 "The test suite is slow (>5 min)"

Acceptable for MVP. Don't optimize unless the ticket is "make tests
faster" (there is no such ticket in MVP).

### 8.5 "I want to add a feature not in the FR list"

Write a ticket stub at the bottom of `docs/11-FEATURE-TICKETS.md`
proposing the feature with priority (MUST / SHOULD / COULD). Continue
your current ticket. The new feature is a separate ticket (or post-MVP
if MUST is full).

### 8.6 "I broke a test in another area"

Fix it before continuing. If you can't fix it in 15 minutes, write to
PROGRESS.md "Open Questions" and STOP.

### 8.7 "I need to skip a test with `it.skip`"

Don't. Fix the test, or fix the code that breaks it. Skipping a test
to merge is forbidden.

### 8.8 "The user wants me to skip the questions"

If the user says "skip questions / just do it / don't ask" at the
start of a session, you may proceed without the confirmation step
(§6.1). But STILL:
- Read all the docs (no skipping §3).
- Stop on blockers (no skipping §7).
- Update PROGRESS.md (no skipping §4 of CLAUDE.md rule 9).

---

## 9. Anti-patterns (forbidden behaviors)

### 9.1 "I'll just guess"

You will guess wrong. STOP and ask.

### 9.2 "I'll just write the next ticket too"

Don't. One ticket = one session. STOP after your ticket.

### 9.3 "I'll just refactor a bit while I'm here"

Don't. Refactor = a separate ticket. Your current ticket stays in
scope.

### 9.4 "I'll just install this package"

No. Per CLAUDE.md rule 2, NEVER install without approval.

### 9.5 "I'll just commit this WIP"

WIP commits are OK (`wip(T-xx): <one-line>`) IF you're at the end of
a session. They are NOT OK as a way to "save progress" mid-session —
finish the work or stop properly.

### 9.6 "I'll just skip this test for now"

No. Fix the test or the code. Skipping is forbidden.

### 9.7 "I'll just `any` this — I know the type"

No. Use `unknown` + narrow. `any` is forbidden (CLAUDE.md rule 13).

### 9.8 "I'll just `process.env.X` here — I know it's set"

No. Use `env.X` from `src/lib/config/env.ts`. Direct `process.env`
access is forbidden by ESLint rule (CLAUDE.md rule 11).

### 9.9 "I'll just log this for debugging"

Sure, but: structured (route, userId, requestId); NEVER credentials;
NEVER decrypted content; level-appropriate (debug / info / warn /
error). Remove debug logs before commit unless they're useful in
prod.

### 9.10 "I'll just hardcode this limit"

No. Use the value from `src/lib/config/platforms.ts` (per CLAUDE.md
rule 10). If a new limit is needed, add it there.

---

## 10. Definition of Done (re-check before commit)

From `CLAUDE.md` §4:

- [ ] Zero TypeScript errors (`npm run typecheck` clean)
- [ ] Zero ESLint errors or warnings (`npm run lint` clean)
- [ ] Unit tests pass — every logic branch including error paths
- [ ] Integration tests pass — including ownership 403 path
- [ ] E2E test for the ticket's user-facing flow is green
- [ ] UI has loading + error + empty states for every async surface
- [ ] Server-side Zod validation on every input
- [ ] Ownership enforced (`userId` scoping) — verified by a 403 test
- [ ] No credential patterns in any API response (scanner test green)
- [ ] No new `any` introduced
- [ ] `docs/13-PROGRESS.md` updated with the log entry
- [ ] Conventional commit message with ticket ID
- [ ] Manual smoke (only if ticket touches adapters) — evidence in
      PROGRESS
- [ ] A11y: new components pass `axe-core` in the relevant Playwright
      test

If ANY box unchecked, the ticket is NOT done. Don't commit. Don't
reply "done". Don't move to the next ticket.

---

## 11. Pairing with a human reviewer

After your ticket, a human (or senior agent) will review the PR. They
will check:

- Code review checklist (`08-CODING-STANDARDS.md` §9)
- Per-PR security checklist (`07-SECURITY-ACCESS.md` §7)
- Definition of Done (`CLAUDE.md` §4)

If they request changes:
- Make the changes.
- Re-run all tests.
- Reply with the changes made.
- Re-request review.

If they reject the ticket:
- Don't argue. Apply the feedback or escalate to the human.

---

## 12. Self-audit (run before "T-NN complete" message)

Before you reply "T-NN complete", audit yourself:

```
[ ] Did I read all required docs at the start?
[ ] Did I state the AC and wait for approval?
[ ] Did I work only on the ticket scope?
[ ] Did I install any new dependency? (if yes — was it approved?)
[ ] Did I write tests for every logic branch?
[ ] Did I run lint + typecheck + tests + e2e?
[ ] Are all tests green? (no skipped, no .todo)
[ ] Is PROGRESS.md updated?
[ ] Is the commit message conventional with the ticket ID?
[ ] Did I STOP after the ticket? (not starting the next one)
```

If any unchecked, fix it before replying "complete".

---

## 13. What to do if the human says "STOP"

If the human says "stop" mid-session:
1. Save your work (commit WIP if you're mid-change).
2. Update PROGRESS.md with where you stopped.
3. Reply: "Stopped. WIP at <hash>. Open threads: <list>."

Don't argue, don't push back, don't try to "just finish this one
thing". Stop.

---

## 14. Closing thoughts

This project is a 4-week MVP for a final-year review. The build pack
is the contract between you and the human. Stick to it. Don't be
creative about scope, dependencies, or architecture — be creative
about implementation within scope.

The goal is a shipped, secure, demo-able product at end of Week 4.
Not a perfect product. Not a feature-rich product. A shipped one.

> "Post once. Get seen everywhere." Now go build it, one ticket at a
> time. STOP when done.

---

> End of agent playbook. Next: `16-OBSERVABILITY.md` — logs, metrics,
> error tracking, secrets scanning.
