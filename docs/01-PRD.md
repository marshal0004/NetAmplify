# NetAmplify — Product Requirements Document (v1.0)

> Status: LOCKED for MVP. Changes require written approval. See `CLAUDE.md` §6.
> Companion docs: `02-SRS.md` (requirements), `03-ARCHITECTURE.md` (how),
> `12-TRUST-COPY.md` (user-facing trust copy).

---

## 1. Problem Statement

### 1.1 The pain, in plain English

Students and fresh graduates build strong technical projects — full-stack
clones, ML experiments, system-design demos — but the work sits in private
GitHub repos. The audiences that matter for placements — recruiters on
LinkedIn, communities on Reddit and Discord, dev networks on X, Bluesky,
and Dev.to — each demand manual, differently-formatted reposting.

A student who ships a project on Saturday faces a Sunday chore:

- **Reddit**: needs a title (≤300), markdown body, a subreddit choice,
  community-flair expectations, and timing aligned to subreddit activity.
- **Discord**: needs an embed with title, description, tech-stack fields,
  and a link — but every server has different channels and tone.
- **Dev.to / Hashnode**: need a full markdown article with front-matter,
  tags (≤4 on Dev.to), a cover image, and a TL;DR.
- **Telegram**: needs an HTML message with a title link and tags, posted
  to a channel the student has admin access to.
- **Bluesky**: needs a ≤300-grapheme post with an external-card facet.
- **X**: needs ≤280 chars, smart hashtag use, and a URL (which counts as
  23 chars regardless of length).
- **LinkedIn**: needs plain text, line breaks preserved, ≤3 hashtags, and
  a link on its own line.

A single project cross-posted to 6 platforms takes 30–45 minutes of
reformatting. Students under-post, post inconsistently, or skip platforms
entirely. Recruiters never see the talent.

### 1.2 One-line problem

Students must post the same work everywhere manually — slow, repetitive,
inconsistent — so they under-post and lose visibility.

---

## 2. Target Users

### P1 — "The Final-Year Student" (PRIMARY)

- **Demographics**: 20–23, CS / IT / ECE undergrad, 2–4 public or private
  GitHub projects.
- **Goal**: internships and placements; "proof of work" visible to
  recruiters and senior devs.
- **Tech comfort**: high. Comfortable with git, GitHub, basic markdown.
  Less comfortable with social-content craft.
- **Pain**: reformatting for 4 platforms takes 30+ minutes; they post
  irregularly because of the friction. They have copy-paste fatigue.
- **Success looks like**: ship a project → click one button → it's
  everywhere, formatted right, with permalinks to share with recruiters.
- **Won't say it but means it**: "I want to look like I'm building in
  public without becoming a content creator."

### P2 — "The Fresh Graduate / Job Seeker"

- **Demographics**: 22–24, applying to 50+ openings, portfolio of 3–6
  projects.
- **Goal**: visible momentum — every project shipped gets seen by the
  networks that lead to referrals.
- **Pain**: spends 2 hours a week on "social media mechanics" instead
  of interviewing or building.
- **Success looks like**: a weekly posting habit sustained without
  willpower drain.

### P3 — "The Club Lead / Ambassador" (secondary)

- **Demographics**: 19–22, runs a college dev club Discord (50–500
  members).
- **Goal**: announce member projects and events to a wider audience.
- **Pain**: cross-posting the same announcement to Discord + Reddit +
  Telegram is repetitive.
- **Success looks like**: announce once to the club, amplify to the
  broader web in one click.

### Non-users (MVP — do NOT design for them)

- Recruiters (no recruiter browsing in MVP — `C5` post-MVP).
- Companies / social-media marketers.
- Content creators with high posting frequency (>10 posts/day).
- Mobile-only users (web app is desktop-first in MVP).

---

## 3. Product Vision

**One post card → every developer platform, correctly formatted, in one
click. For students, by default free, forever trustworthy: we never touch
passwords.**

The north-star metric is **total successful cross-posts published per
week** across all users and all platforms. Every cross-post is a student
visible somewhere that matters.

### 3.1 Why "free + trustworthy" is the wedge

The MVP market is students who will not pay and will not trust a tool that
asks for their Reddit password. Our entire trust posture — OAuth for
OAuth-capable platforms, user-generated API keys / webhooks / bot tokens
for the rest, AES-256-GCM encryption at rest, valet-key scope principle,
one-click revocation — is the product. If we lose trust, we lose the
wedge; if we keep it, we have a moat no generic scheduler can copy.

### 3.2 Why "one click" is the second wedge

The existing solution is "open 6 tabs, reformat, paste, post". Our job is
to compress that to "compose once, click once". Anything that doesn't
reduce the number of clicks is out of scope for v1.

---

## 4. Core Features (MoSCoW)

### MUST (MVP) — ship or fail

| ID | Feature | Why |
|---|---|---|
| **M1** | Email/password signup + login (NextAuth) | Identity, no friction, no Google-OAuth scope creep |
| **M2** | Minimal profile (name, headline, college, grad year, links) | Formatters need it for credit + linkback |
| **M3** | Post Card composer (title, summary, markdown description, tech tags, links) | The "one" in "post once" |
| **M4** | Connect Checklist — one-time, per-platform credential connection: OAuth (Reddit, X\*, LinkedIn\*), API key (Dev.to, Hashnode), webhook (Discord), bot token (Telegram), app password (Bluesky) | The trust story made concrete |
| **M5** | Format Engine — deterministic per-platform formatting with live preview | Compress 30 min of reformatting into a click |
| **M6** | One-click Amplify → parallel publishing with per-platform status board | The "click once" promise |
| **M7** | Retry failed targets; posting history with permalinks | Partial failures are the norm; users need recovery |
| **M8** | Encrypted credential vault + disconnect/revoke handling | Trust foundation |
| **M9** | Trust & Security settings panel (scopes shown, revoke buttons, safety copy) | Visible trust; converts the skeptical |

### SHOULD — ship if time permits, no schedule slip

| ID | Feature | Why |
|---|---|---|
| **S1** | Live per-platform preview on publish page (real formatter output) | Reduces user error before publish |
| **S2** | Basic stats strip (posts, success rate, per-platform counts) | Mild gamification + visibility |
| **S3** | Image attachment to Post Cards (1 image, propagated where supported) | Visuals dramatically improve engagement |

### COULD — post-MVP

- **C1** Scheduling (post at a chosen time).
- **C2** AI tone rewriting per platform (formal for LinkedIn, casual for
  X, technical for Dev.to).
- **C3** Richer analytics (impressions, clicks, engagement).
- **C4** Instagram / Facebook publishing (post Meta verification).
- **C5** Recruiter discovery feed (opt-in, students get DMs).

### WON'T (v1) — explicit non-goals

- Payments / billing / subscription tiers.
- Teams / organizations / shared connections.
- Mobile apps (responsive web only in MVP).
- Auto-follow / DM automation / engagement bot.
- Scraping of any platform.
- Real-time WebSocket push (we poll; WebSocket post-MVP).
- Google OAuth (cut from MVP — see `07-SECURITY-ACCESS.md` §1).

---

## 5. App Flow (complete user journey)

> Every step below maps to a screen or API call in `05-API-SPEC.md` and
> `06-FRONTEND-SPEC.md`. Numbers in brackets are FR / FR-0xx references
> from `02-SRS.md`.

### 5.1 First-time user (signup → first Amplify)

1. **Landing** (`/`) — hero "Post once. Get seen everywhere." · 3-step
   how-it-works · platform logo row · security blurb ("We never see your
   passwords") · CTA "Get started".
2. **Signup** (`/signup`) — email, password (≥8), name. Inline validation.
   On submit → 201 → auto-login → redirect to `/dashboard?onboarding=1`.
   [FR-001]
3. **First-run dashboard** — empty state with a 3-step onboarding strip:
   `[1 Create profile]` → `[2 Connect platforms]` → `[3 Amplify first
   project]`. Each step links to its page; each step turns green when
   done. [FR-002]
4. **Profile** (`/dashboard/settings` → Profile tab) — name (from signup,
   editable), headline (≤140), college, graduationYear (2015–2035),
   githubUrl, portfolioUrl. Save → toast. [FR-002]
5. **Connect Checklist** (`/dashboard/connections`) — grid of platform
   cards. Each card shows: icon, status, Connect / Disconnect button,
   and a "Why is this safe?" expander (copy from `12-TRUST-COPY.md` §1).
   - **Reddit** → "Connect" → full-page redirect to `reddit.com` login →
     consent ("NetAmplify wants to submit posts on your behalf") → back
     → "Connected as @handle". [FR-004]
   - **Discord** → user pastes webhook URL from their server settings →
     we validate it live and show "Will post to #channel-name in
     <server name>". [FR-006]
   - **Dev.to / Hashnode** → user pastes API key / PAT from their
     settings page → we validate by fetching their username → show
     "Connected as @user". [FR-005]
   - **Telegram** → user creates their own bot via @BotFather, adds it
     as channel admin, pastes bot token + channel @username → we
     validate via `getMe` + `getChat` → show "Connected → @channel". [FR-007]
   - **Bluesky** → user creates an App Password in Bluesky settings,
     pastes handle + app password → we validate via `createSession` →
     show "Connected → @handle". [FR-008]
   - **X / LinkedIn (Tier B)**: Connect buttons render. If our app
     credentials are not configured in env, card shows amber "Coming
     soon — setup pending" with a tooltip explaining app-review status.
     No error. [FR-004]
   - Progress bar "3/6 connected". User proceeds with ≥1 platform.
6. **Dashboard** (`/dashboard`) → "New Post Card" button → composer.
   [FR-003]
7. **Composer** (`/dashboard/postcards/new`) — sections:
   - **Basics**: title (≤120), summary (≤200), description (markdown,
     ≤5000) with live char counter and preview toggle.
   - **Tech tags**: chips input, 1–10 tags, max 24 chars each, kebab-case
     hint.
   - **Links**: repoUrl, liveUrl (validated URLs), optional image upload
     (1 image, 5 MB, jpg/png/webp). [S3]
   - Save → toast → redirect to Post Card view page.
8. **Post Card view** (`/dashboard/postcards/:id`) — full card with
   rendered markdown, tags, links. Big "🚀 Amplify" button.
9. **Publish page** (`/dashboard/postcards/:id/publish`):
   - **Left**: the Post Card summary.
   - **Right**: platform checklist (only connected platforms
     selectable). Reddit target reveals a subreddit input (prefilled
     from the last-used subreddit for this user). Each platform shows a
     live preview of EXACT formatted output with char counter
     ("231/280" for X). [S1]
   - **Bottom bar**: "🚀 Amplify to N platforms" (N is live count of
     selected platforms).
10. **Click Amplify** → status board appears inline: per platform
    `QUEUED` (gray) → `PUBLISHING` (blue pulse) → `SUCCESS` (green,
    permalink button) or `FAILED` (red, error tooltip, Retry button).
    Partial success is allowed — one platform failing never blocks
    others. [FR-012]
11. **History** (`/dashboard/history`) — paginated table of Posts,
    newest first, filter by platform / status, permalinks, Retry
    failed targets (max 3 attempts). [FR-013, FR-014]
12. **Settings** (`/dashboard/settings` → Security & Connections tab):
    every connection with granted scope, connected date, last used,
    big Disconnect button; "How we protect you" section (copy from
    `12-TRUST-COPY.md` §2); account deletion (typed confirmation
    "DELETE", wipes everything via cascade + audit log). [FR-015]

### 5.2 Returning user (login → repeat Amplify)

1. **Login** (`/login`) — email, password. On submit → 201 → redirect
   `/dashboard`. [FR-001]
2. Dashboard shows stats strip + Post Card grid. Existing cards have
   "Amplify again" and "Edit" buttons.
3. Click a Post Card → view → "Amplify" → publish page (preselected
   platforms = last-used set for this card) → Amplify → status board.

### 5.3 Disconnect / revoke

- User clicks "Disconnect" on a platform → confirm dialog → DELETE
  Connection row → audit `DISCONNECT` → checklist updates. Future
  publishes targeting that platform return 400 `invalidPlatforms`.
- User revokes on the platform side (e.g., Reddit settings) → next
  publish with that platform → adapter call fails with AUTH → we mark
  Connection `REVOKED` and PostTarget `FAILED` with "Reconnect this
  platform" hint. User sees a banner in the Security panel.

---

## 6. Success Metrics (MVP / final review)

### 6.1 User-facing success metrics

- **Time-to-first-Amplify**: signup → first successful Amplify in < 5
  minutes for a new user (measured by the timestamp gap in AuditLog
  between LOGIN and first PUBLISH).
- **Cross-post reach**: one Amplify reaches ≥3 platforms, all terminal
  states < 60 seconds from the Amplify click.
- **Publish success rate**: ≥95% on connected, valid credentials,
  measured over the final week of the MVP window.
- **Trust**: zero plaintext credentials in DB, logs, or API responses
  (test-enforced; scanner test in CI).
- **Demo**: live publish to Reddit + Discord + Dev.to + Telegram in
  front of the panel with real permalinks.

### 6.2 Engineering metrics (internal)

- Lighthouse ≥90 on dashboard (performance + a11y + best-practice).
- p95 internal API <500ms; publish dispatch <2s.
- CI green on every PR; no red pipeline merged.
- Test coverage ≥90% on vault / formatters / services.
- Zero `any` introduced (`grep -r ': any' src/ | wc -l` not increased).
- Zero new dependencies without written approval.

### 6.3 Viva / review metrics

- Demo runs clean twice consecutively in rehearsal.
- Backup video recorded + screenshot pack saved (in case WiFi dies).
- LinkedIn / X status slide prepared with current app-review status.
- Every FR has at least one test (unit, integration, or E2E).

---

## 7. What we are deliberately NOT building in v1

To ship in 4 weeks, we cut hard. The following are explicit non-goals and
MUST NOT creep back in:

- **Payments** — users post via their own accounts; free for them and
  for us. X is the only app-level cost and stays inside its free tier at
  MVP volumes (2–3 posts/day per user → ~150 posts/mo for the whole
  userbase at MVP scale, vs. 1500 free-tier monthly cap).
- **Instagram / Facebook publishing** — Meta requires app review with
  screen recordings, business verification, and a public privacy
  policy. Roadmap slide only.
- **Scheduling** — adds a job-runner, a cron, a timezone picker, and a
  "what if the user disconnects before the scheduled time" edge case.
  Post-MVP `C1`.
- **AI features** — tone rewriting per platform adds LLM dependency,
  prompt engineering, cost, latency, and a "what if it rewrites my
  code" trust issue. Post-MVP `C2`.
- **Teams / organizations / shared connections** — adds role-based
  access, group billing, and a "who owns this Post Card when a member
  leaves" question. Post-MVP.
- **Analytics beyond counts** — impressions / clicks need OAuth-scoped
  API access on each platform and a normalization layer. Post-MVP `C3`.
- **Email campaigns** — out of scope; we are not a newsletter tool.
- **Mobile apps** — responsive web is enough for v1.

---

## 8. Pricing / Business (future, not v1)

> The MVP is free for users and free for us. This section is for the viva
> answer "who pays for APIs" and for the future-state slide. See
> `12-TRUST-COPY.md` §3.

### 8.1 Cost structure (MVP)

| Item | Cost (MVP) | Cost (at scale) |
|---|---|---|
| Reddit API (OAuth) | $0 | $0 (per-user token, free tier) |
| Discord webhook | $0 | $0 |
| Dev.to API | $0 | $0 |
| Telegram Bot API | $0 | $0 |
| Bluesky API | $0 | $0 (open protocol) |
| Hashnode API | $0 | $0 |
| X API (free tier) | $0 | ~$100–200/mo beyond free tier |
| LinkedIn API | $0 (dev mode) | marketing API fees post-review |
| Hosting (Vercel) | $0 (hobby) | $20/mo (Pro) |
| Postgres (Neon free) | $0 | $19/mo |
| Redis (Upstash free) | $0 | $10/mo |
| Email (Resend free) | $0 | $20/mo |
| **Total (MVP)** | **$0** | **~$170/mo** |

### 8.2 Freemium later

- **Free tier**: 2–3 platforms, basic stats, no scheduling.
- **Pro tier (~$8/mo)**: all platforms, scheduling, richer analytics,
  priority queue.
- **API costs (X beyond free tier ~$100–200/mo) activate only at scale
  and are covered by paying users**. We never charge students who only
  use the free platforms.

### 8.3 Viva answer card

See `12-TRUST-COPY.md` §3 — verbatim Q&A for "Who pays for APIs?" and
"Are you going to charge students?".

---

## 9. Risks and mitigations (engineering-level)

| Risk | Mitigation |
|---|---|
| OAuth platform revokes our app (Reddit / X / LinkedIn) | Tier B degrades gracefully to "Setup pending"; our adapter detects AUTH failure → Connection REVOKED; user-facing "Reconnect" hint |
| X free-tier quota overrun | `X_MONTHLY_POST_BUDGET` config (default 450); `QuotaUsage` table; SKIPPED state with clear message; per-month reset |
| Redis outage mid-publish | BullMQ durable jobs; on Redis back-up, jobs resume; UI shows "queued but delayed — check History" |
| DB credential leak | AES-256-GCM ciphertext-only column; CI scanner test greps DB dump for token patterns; plaintext exists only in-memory inside workers |
| User disconnects platform mid-publish | Worker re-reads Connection at execution; null → target SKIPPED with "connection removed"; never crashes |
| Double-click Amplify / two tabs | Client `requestId` UUID; server upserts on `requestId`; returns existing Post; no duplicate |
| Markdown injection (XSS in description) | Server-side Zod length cap; client renders via `react-markdown` + `remark-gfm` with NO raw HTML allowed; sanitizer in render pipeline |
| Reddit subreddit banned / private | Adapter surfaces platform's VALIDATION error verbatim; PostTarget FAILED with platform message |
| Telegram bot removed from channel | Adapter `getChat` fails with AUTH class; user sees "Make your bot an admin of the channel first" |
| Slow 3G / poor demo WiFi | Skeletons everywhere; polling degrades gracefully; backup video + screenshot pack for demo |
| Account deletion with queued jobs | Workers check user existence at execution; null user → target SKIPPED; audit `ACCOUNT_DELETE` logged before deletion |

---

## 10. Open questions (none — all decisions locked for v1)

If a future agent finds a gap, add it here with a `## Proposed Deviations`
section in `13-PROGRESS.md` and STOP.

---

> End of PRD. Next: `02-SRS.md` — numbered requirements with acceptance
> criteria. Every ticket references an FR-0xx ID; every test asserts one.
