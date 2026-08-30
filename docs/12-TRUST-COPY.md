# NetAmplify — Trust & Security Copy (paste verbatim into UI + viva)

> Status: LOCKED for MVP. This file contains the **exact words** that
> appear in the UI ("Why is this safe?" expanders, "How we protect
> you" panel, onboarding banner) AND the **exact answers** to expect
> in the viva / review.
>
> DO NOT paraphrase. DO NOT abbreviate. DO NOT translate to marketing
> speak. The trust story depends on consistency.

---

## §1 Connect-dialog expanders ("Why is this safe?")

These appear under each platform card on the Connect Checklist
(`06-FRONTEND-SPEC.md` Screen 4) inside a "Why is this safe?" expander.

### Generic OAuth (Reddit / X / LinkedIn)

> You'll log in on {Platform}'s official page — NetAmplify never sees
> your password. We receive only a limited permission to submit posts,
> and you can revoke it anytime in your {Platform} settings.

Replace `{Platform}` with the platform name (e.g., "Reddit", "X",
"LinkedIn").

### Discord

> A webhook can only post to ONE channel in your server. Even in a
> worst case, it can't read messages, DMs, or touch your account.
> Delete the webhook in your server settings anytime and it's dead
> instantly.

### Telegram

> The bot is YOURS — you create it with @BotFather and control it. We
> only get the ability to send messages to the one channel where you
> made it an admin. Remove the bot anytime.

### Dev.to / Hashnode

> You generate this key yourself in your account's settings. It can
> only manage content — and you can regenerate or delete it whenever
> you want.

### Bluesky

> Bluesky built App Passwords exactly for this: separate from your
> real password, limited to posting, revocable in one click.

---

## §2 Security & Connections panel — "How we protect you"

This appears verbatim on the Settings → Security & Connections tab
(`06-FRONTEND-SPEC.md` Screen 8). Render as a numbered list under the
heading "How we protect you".

### How we protect you

1. **We never see or store your platform passwords** — OAuth or keys
   you control, only.
2. **Credentials are encrypted (AES-256)** — even a database breach
   alone can't expose usable credentials (keys live outside the DB).
3. **We request the minimum permissions possible: posting only.** No
   DMs, no password changes, no account access.
4. **Everything is revocable instantly** — disconnect here, or revoke
   on the platform; we detect it and stop immediately.
5. **Every connection and publish is audit-logged** — you can export
   or delete ALL your data anytime.

### Per-connection display (under "How we protect you")

Each connected platform shows:

- Platform icon + name
- Handle / username (e.g., `@alice_dev` for Reddit, `#side-projects in
  Code Club` for Discord)
- Scopes granted (OAuth platforms only; `[]` for non-OAuth with a
  tooltip "Not applicable — this credential type doesn't use scopes")
- Connected date (`connectedAt`)
- Last used date (`lastUsedAt`)
- Last validated date (`lastValidatedAt`)
- Big Disconnect button (destructive) with confirm dialog "Disconnect
  {Platform}? Future publishes won't include it. You can reconnect
  anytime."

---

## §3 Viva answer card (memorize)

These are the answers you give in the final review / viva. Memorize
them. They are the difference between "looks secure" and "is secure"
in the panel's eyes.

### Q1 — "Do you store our passwords?"

> No. OAuth 2.0 with PKCE: the user logs in on the platform's own page;
> we exchange a one-time code for a limited token. For key-based
> platforms, users paste keys they generate themselves. Nothing else.
> Tokens are AES-256-GCM encrypted at rest with keys outside the
> database, decrypted in-memory only.

### Q2 — "What can the token do?"

> Valet-key principle: post only, per the consent screen. Can't read
> DMs, change passwords, or log in as the user.

### Q3 — "What if your DB is breached?"

> Ciphertext without the vault key is useless; the key lives in the
> secrets manager, not the DB.

### Q4 — "What if a user revokes?"

> The next publish fails with an auth error; we mark the connection
> REVOKED and prompt reconnect. We never retry silently.

### Q5 — "Who pays for APIs?"

> Posting to your own account is free on every platform. Users post
> with their own credentials. Reddit/Discord/Dev.to/Telegram/Bluesky/
> Hashnode are free to us too. X is the only app-level cost; its free
> tier covers student posting volumes at MVP scale, and a quota guard
> prevents overruns. If we ever outgrow it, a freemium tier (covered
> by paying users) funds it — validate free, monetize at scale.

### Q6 — "Why should I trust you with my credentials?"

> You shouldn't have to. The whole architecture is designed so we
> can't access your accounts even if we wanted to. OAuth means we
> never see your password. Keys are encrypted with a key we don't
> have at runtime outside the moment of publish. Every connection is
> revocable from your side, and we detect revocation instantly.

### Q7 — "How do you handle a credential leak?"

> Three layers of defense:
> 1. **Prevent**: AES-256-GCM at rest, plaintext only in-memory during
>    publish, scoped credentials (post-only), server-side Zod on every
>    input, CSP + HSTS + frame-ancestors none.
> 2. **Detect**: CI scanner test greps DB dumps + logs + API responses
>    for token patterns; a single match fails the build. AuditLog
>    records every credential-touching action.
> 3. **Respond**: User can disconnect a platform instantly (hard-
>    delete the Connection row + ciphertext). User can delete their
>    entire account (cascade wipes everything, audit row kept for
>    forensics). If we detect a leaked token pattern in logs, we
>    rotate the vault key (post-MVP — requires dual-key support).

### Q8 — "What's your threat model?"

> Two main threats:
> 1. **External attacker breaches our DB.** Mitigation: AES-256-GCM
>    ciphertext-only column; key in secrets manager (not DB); Postgres
>    encrypted at rest; Vercel/Doppler-managed secrets.
> 2. **Insider (us) goes rogue.** Mitigation: we don't have a
>    "decrypt everything" admin endpoint. Decryption happens only
>    inside workers per-target, in-memory, with no logging. Audit
>    logs are immutable (delete is NoAction on User cascade). Post-
>    MVP: dual-key control + access logging on secrets manager.
>
> Not in scope (post-MVP): SSRF attacks on adapters (mitigated by
> hardcoded platform URLs + Discord webhook URL allowlist), supply
> chain attacks (mitigated by lockfile + Dependabot), phishing of
> users (mitigated by user education — show them the consent screen
> on Reddit before they accept).

### Q9 — "How would you scale this to 10k users?"

> The architecture is horizontally scalable by design:
> 1. **Postgres**: vertical scaling (Neon autoscale or RDS) handles
>    10k users easily; sharding post-MVP.
> 2. **Redis**: Upstash or self-hosted cluster; BullMQ handles job
>    distribution across multiple worker processes.
> 3. **Workers**: split to a separate Node process per worker type
>    (publish-worker, audit-worker); scale horizontally.
> 4. **Next.js**: Vercel autoscaling; or self-host on Hetzner with
>    PM2 + Nginx.
> 5. **Image uploads**: Cloudinary handles unlimited scale.
> 6. **Platform APIs**: per-user rate limits; our rate limit + X
>    quota guard prevent per-user abuse.
>
> No architectural rewrite needed. The 4-week MVP architecture IS the
> scale architecture.

### Q10 — "What's the worst case for a user?"

> A user posts to N platforms; one platform fails with an AUTH error.
> The other N-1 posts succeed. The failed target shows a clear
> "Reconnect this platform" message; the user reconnects and retries
> just that one target. The Post Card is published to N platforms in
> one click, the user gets N-1 permalinks immediately, and the 1
> failure is recoverable. Worst case = one platform needs a reconnect
> click. The user is never worse off than if they had posted manually.

### Q11 — "What about Instagram / Facebook?"

> Meta requires app review with screen recordings, business
> verification, and a public privacy policy — a 4-to-8 week process
> that doesn't fit our 4-week MVP. We have the architecture ready
> (the adapter pattern supports adding Instagram with one new
> adapter + one new formatter); it's a roadmap item once app review
> completes. The slide shows "architecture ready; review pending".

### Q12 — "What's your privacy policy stance?"

> Minimal data, full user control. We collect: email + password (for
> login), name (for credit on posts), platform credentials (encrypted,
> for posting). We don't track analytics beyond post status counts.
> Users can export ALL their data as JSON anytime (Settings → Export).
> Users can delete their account permanently (Settings → Delete —
> cascade wipes everything; audit log kept for security forensics
> with the userId). We don't sell data, don't share with third
> parties beyond the platforms the user explicitly connects.

---

## §4 Onboarding trust banner (dashboard, dismissible)

Appears at the top of the dashboard (`/dashboard`) until dismissed
(stored as a user preference; re-enable in Settings).

> **Your accounts, your keys.** NetAmplify never asks for passwords —
> see how it works →

"see how it works →" links to the Security & Connections panel
(`/dashboard/settings` → Security & Connections tab).

---

## §5 Connect-dialog copy (per platform — for the connect modal / inline flow)

### Reddit connect — pre-redirect

> **Connect Reddit**
>
> You'll be redirected to Reddit's official login page. NetAmplify
> never sees your Reddit password.
>
> What we ask Reddit for:
> - **identity** — to show "Connected as @your-username"
> - **submit** — to post to subreddits on your behalf
>
> You can revoke this permission anytime on Reddit's settings page or
> by clicking Disconnect here. [Continue to Reddit →]

### Discord connect — paste-webhook modal

> **Connect Discord**
>
> Paste a webhook URL from your server's channel settings (Channel
> Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL).
>
> A webhook can only post to ONE channel in your server. Even in a
> worst case, it can't read messages, DMs, or touch your account.
> Delete the webhook in your server settings anytime and it's dead
> instantly.
>
> [Webhook URL input] [Continue →]

### Dev.to / Hashnode connect — paste-key modal

> **Connect Dev.to**
>
> Generate an API key in your Dev.to settings (Settings → Extensions →
> API Keys → Generate). Paste it below.
>
> You generate this key yourself in your account's settings. It can
> only manage content — and you can regenerate or delete it whenever
> you want.
>
> [API key input] [Continue →]

(Same for Hashnode: replace "Dev.to" with "Hashnode", "Settings →
Extensions → API Keys" with "Settings → Developer → Personal Access
Tokens".)

### Telegram connect — paste-bot-token modal

> **Connect Telegram**
>
> 1. Create a bot with [@BotFather](https://t.me/BotFather) →
>    `/newbot` → name + username.
> 2. Add the bot as an **admin** of your channel with the "Post
>    Messages" permission.
> 3. Paste the bot token + your channel @username below.
>
> The bot is YOURS — you create it with @BotFather and control it. We
> only get the ability to send messages to the one channel where you
> made it an admin. Remove the bot anytime.
>
> [Bot token input] [Channel @username input] [Continue →]

### Bluesky connect — paste-app-password modal

> **Connect Bluesky**
>
> 1. Open Bluesky → Settings → App passwords → Add password.
> 2. Name it "NetAmplify" (so you remember what it's for).
> 3. Copy the generated password (you won't see it again).
> 4. Paste it below with your Bluesky handle.
>
> Bluesky built App Passwords exactly for this: separate from your
> real password, limited to posting, revocable in one click.
>
> [Handle input] [App password input] [Continue →]

### X / LinkedIn (Tier B) — "Setup pending" state

> **Coming soon — setup pending**
>
> We have the architecture ready for X / LinkedIn, but our developer
> app is in review. Once approved, this card will become a Connect
> button. Other platforms are fully available now.

(This appears instead of a connect button when `adapter.configured()`
returns false.)

---

## §6 Disconnect confirm dialog

> **Disconnect Reddit?**
>
> Future publishes won't include Reddit. Your existing posts stay on
> Reddit. You can reconnect anytime.
>
> [Cancel] [Disconnect]

(Same for other platforms — replace "Reddit" with the platform name.)

---

## §7 Error messages (user-facing — keep them platform-specific + actionable)

### OAuth errors

- **State mismatch / expired**: "Security check failed — please
  reconnect. This can happen if you took too long on the platform's
  login page or if your browser blocked the temporary cookie."
- **Code exchange failed**: "{Platform} didn't complete the
  handshake — try again. If it keeps failing, the platform may be
  experiencing issues."

### Connect errors

- **Dev.to invalid key**: "Key rejected by Dev.to — check and
  re-paste. Get a fresh key from Settings → Extensions → API Keys."
- **Hashnode invalid PAT**: "Key rejected by Hashnode — check and
  re-paste. Get a fresh PAT from Settings → Developer → Personal
  Access Tokens."
- **Discord invalid webhook**: "Discord rejected this webhook —
  check the URL or recreate it in your server settings (Channel
  Settings → Integrations → Webhooks)."
- **Telegram BAD_TOKEN**: "Bot token invalid — get a fresh one from
  @BotFather."
- **Telegram NOT_ADMIN**: "Make your bot an admin of the channel
  first."
- **Telegram BAD_CHANNEL**: "Channel not found — check the
  @username."
- **Bluesky invalid pair**: "Bluesky rejected these credentials —
  create the app password in Settings → App passwords (not your real
  password)."

### Publish errors

- **AUTH class (Connection REVOKED)**: "Reconnect this platform —
  the credential was rejected. Other platforms in this publish
  weren't affected."
- **RATE class (after 3 attempts)**: "{Platform} is rate-limiting —
  try again in a few minutes. Other platforms in this publish weren't
  affected."
- **VALIDATION class**: "{Platform}'s response: '<sanitized
  platform message verbatim>'"
- **NETWORK class (after 3 attempts)**: "Network issue reaching
  {Platform} — try again. Other platforms in this publish weren't
  affected."
- **QUOTA class (X only)**: "X quota for this month is used — other
  platforms in this publish weren't affected. Try X again next
  month."

### General errors

- **Not found**: "Not found — this may belong to another account or
  may have been deleted."
- **Rate limited (global)**: "Too many requests — wait {Retry-After}
  seconds and try again."
- **Server error**: "Something went wrong — we've been notified. Try
  again in a moment."
- **Offline (client-side)**: "You're offline — actions will fail
  until you reconnect."

---

## §8 Trust copy — DO and DON'T

### DO
- Use the exact words from §1, §2, §4, §5, §6, §7 in the UI.
- Replace `{Platform}` consistently (capitalize first letter in UI
  display; lowercase in URLs / code).
- Add a tooltip on every "Why is this safe?" expander explaining the
  trust model in one sentence: "OAuth or self-generated keys,
  AES-256 encrypted, revocable anytime."

### DON'T
- Paraphrase. The trust story depends on word-for-word consistency.
- Translate to marketing speak ("We use industry-standard
  security..."). Specifics beat platitudes.
- Show real credential examples (e.g., "sk-1234567890abcdef..."). Use
  placeholders ("sk-...") in UI examples.
- Promise more than we deliver. We don't do "bank-grade security"
  (banks have different threat models). We do "student-grade
  trustworthy" — and we mean it.

---

## §9 Demo trust narration (use during the live demo)

When you click "Amplify" during the demo, narrate:

> "Click Amplify — the request hits the route, validates that I own
> this post card and that every platform I selected has an ACTIVE
> connection. In a transaction, it creates a Post row and N
> PostTarget rows — one per platform — and enqueues one BullMQ job
> per target. Workers pick up the jobs, decrypt the credentials in-
> memory, format the post card per platform's limits, call the
> platform adapter, and persist the result. The UI polls every 3
> seconds until all targets are terminal."

When asked about credentials during the demo:

> "We never see the user's platform passwords. OAuth — like Reddit —
> sends the user to Reddit's own login page; we exchange a one-time
> code for a limited-scope token. For key-based platforms — Dev.to,
> Hashnode — the user generates the key themselves and pastes it;
> we encrypt it with AES-256-GCM and store only the ciphertext. The
> decryption key lives in our secrets manager, not in the database.
> Even if the database were breached, the credentials are useless
> without the key."

---

> End of trust copy. Next: `13-PROGRESS.md` — living status log
> (agent updates after every ticket; humans read this first).
