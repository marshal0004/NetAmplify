# NetAmplify — Local Setup Guide (Arch Linux)

> Complete step-by-step guide to run NetAmplify on your Arch Linux laptop.
>
> **Current state**: 12 platforms, 548 tests passing, Tauri desktop app + auto-capture cookie flow.

---

## What's working right now (be honest)

| Platform | Method | Works on your laptop? | Setup time |
|----------|--------|----------------------|------------|
| **Discord** | Webhook URL (user-pasted) | ✅ Yes | 30 sec |
| **Dev.to** | API key (user-pasted) | ✅ Yes | 30 sec |
| **Telegram** | Bot token + channel (user-pasted) | ✅ Yes | 2 min |
| **Bluesky** | App password (user-pasted) | ✅ Yes | 30 sec |
| **Hashnode** | PAT (user-pasted) | ✅ Yes | 30 sec |
| **Mastodon** | Access token (user-pasted) | ✅ Yes | 2 min |
| **WordPress** | App password (user-pasted) | ✅ Yes | 2 min |
| **LinkedIn** | OAuth 2.0 PKCE | ✅ Yes (if you created a LinkedIn dev app) | 5 min |
| **Reddit** | OAuth 2.0 PKCE | ⚠️ Needs manual developer review (24-48h, often rejected) | — |
| **X (Twitter)** | OAuth 2.0 PKCE | ❌ \$100/month API paywall | — |
| **Reddit (Cookie)** | Session cookies (auto-capture via Tauri OR manual paste) | ✅ Yes (residential IP only) | 3 sec with Tauri / 2 min manual |
| **X (Cookie)** | Session cookies (auto-capture via Tauri OR manual paste) | ✅ Yes (residential IP only) | 3 sec with Tauri / 2 min manual |

**Summary**: 10 out of 12 platforms work on your laptop. Reddit + X work via the cookie method (bypasses their paywall + manual review).

---

## Two ways to run NetAmplify

### Option A: Web app (browser, no Tauri) — faster to start
- Run the NestJS backend + Vite frontend
- Open `http://localhost:4200` in Chrome/Firefox
- Cookie platforms (Reddit, X) require manual copy-paste via Cookie-Editor extension
- All other platforms work via OAuth or API key paste

### Option B: Desktop app (Tauri) — better UX, zero copy-paste
- Build the Tauri desktop app (requires Rust + webkit2gtk)
- Cookie platforms (Reddit, X) use **auto-capture**: click "Auto-Capture" → native login window opens → log in normally → cookies captured automatically
- No browser extension needed, no copy-paste
- Same React frontend, same NestJS backend — just wrapped in a native window

**Recommendation**: Start with Option A to verify everything works. Then build Option B for the premium UX (zero copy-paste for Reddit + X).

---

## Prerequisites

Install these on your Arch machine:

### 1. Docker + Docker Compose (for PostgreSQL + Redis)
```bash
sudo pacman -S docker docker-compose
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER
# Log out + log back in for docker group to take effect
```

### 2. Node.js 20+
```bash
sudo pacman -S nodejs npm
node --version  # should be v20+ (v24 is fine)
```

### 3. pnpm
```bash
sudo npm install -g pnpm@9.5.0
pnpm --version  # should be 9.5.0
```

### 4. (Optional, for Tauri desktop app) Rust + webkit2gtk
```bash
sudo pacman -S rust webkit2gtk gtk3 base-devel
rustc --version  # should be 1.77+
```

---

## Step 1: Clone the repo

```bash
cd /home/$USER
git clone https://github.com/marshal0004/NetAmplify.git netamplify-app
cd netamplify-app
```

---

## Step 2: Create .env file

Create a file named `.env` in the root of `netamplify-app/`:

```env
# Database (from docker-compose.simple.yml)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/netamplify
REDIS_URL=redis://localhost:6379

# Security (generate with: openssl rand -base64 32)
TOKEN_ENCRYPTION_KEY=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=
JWT_SECRET=your-jwt-secret-change-this-to-random-string

# Twitter OAuth (from https://developer.x.com — needed for TWITTER OAuth platform)
# NOTE: This is for the OAuth flow, which is paywalled ($100/mo).
# For cookie-based posting (free), leave these as "test" — you don't need real creds.
TWITTER_CLIENT_ID=test
TWITTER_CLIENT_SECRET=test

# LinkedIn OAuth (from https://developer.linkedin.com — needed for LINKEDIN OAuth platform)
# Get these by creating a LinkedIn developer app.
LINKEDIN_CLIENT_ID=your-linkedin-client-id
LINKEDIN_CLIENT_SECRET=your-linkedin-client-secret

# App URLs
FRONTEND_URL=http://localhost:4200
PUBLIC_APP_URL=http://localhost:4200
NEXTAUTH_URL=http://localhost:4200
NOT_SECURED=true

# Email (leave empty for dev — reset tokens print to console)
EMAIL_PROVIDER=

# X Monthly Quota (for the OAuth platform, not the cookie platform)
X_MONTHLY_POST_BUDGET=450
```

### Which credentials do you actually need?

| Platform | Needs .env vars? | How users connect |
|----------|------------------|-------------------|
| Discord, Dev.to, Telegram, Bluesky, Hashnode, Mastodon, WordPress | ❌ No | User pastes their own credential via the UI |
| LinkedIn (OAuth) | ✅ `LINKEDIN_CLIENT_ID` + `LINKEDIN_CLIENT_SECRET` | User clicks "Connect via OAuth" → logs in to LinkedIn |
| Reddit (OAuth) | ✅ `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` (but Reddit's manual review blocks this) | Use the Cookie platform instead (below) |
| X (OAuth) | ✅ `TWITTER_CLIENT_ID` + `TWITTER_CLIENT_SECRET` (but \$100/mo paywall) | Use the Cookie platform instead (below) |
| **Reddit (Cookie)** | ❌ No env vars | User pastes cookies OR uses Tauri auto-capture |
| **X (Cookie)** | ❌ No env vars | User pastes cookies OR uses Tauri auto-capture |

**For the demo**: Set `TWITTER_CLIENT_ID=test` + `TWITTER_CLIENT_SECRET=test` (placeholders — the cookie flow doesn't use these). Only LinkedIn needs real OAuth credentials.

---

## Step 3: Install dependencies

```bash
cd netamplify-app
pnpm install --no-frozen-lockfile --ignore-scripts
pnpm rebuild bcrypt
npx prisma generate --schema libraries/nestjs-libraries/src/database/prisma/schema.prisma
```

---

## Step 4: Start PostgreSQL + Redis

The original `docker-compose.dev.yaml` tries to start Temporal + other postiz services we don't need. Create a simplified version:

```bash
cat > docker-compose.simple.yml << 'EOF'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: netamplify
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
volumes:
  pgdata:
EOF

docker compose -f docker-compose.simple.yml up -d
```

Wait 10 seconds, then verify both containers are running:
```bash
docker ps
```

You should see `postgres:16-alpine` on port 5432 and `redis:7-alpine` on port 6379.

**If port 5432 or 6379 is already in use** (e.g., from another app), change the ports in `docker-compose.simple.yml`:
```yaml
    ports:
      - "5433:5432"  # use 5433 instead of 5432
```
Then update your `.env`:
```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/netamplify
REDIS_URL=redis://localhost:6380
```

---

## Step 5: Apply database schema

```bash
npx prisma db push --schema libraries/nestjs-libraries/src/database/prisma/schema.prisma
```

This creates all 9 tables (User, Profile, PostCard, ProjectMedia, Connection, Post, PostTarget, QuotaUsage, AuditLog) + the 12 platform enum values + 6 ConnectionType enum values.

---

## Step 6: Run tests (verify everything works)

### Unit + Integration + E2E tests (548 total, ~24 seconds):
```bash
pnpm test
```

Expected output:
```
Test Files  29 passed (29)
     Tests  548 passed (548)
```

### Curl tests (require running backend — see Step 7):
```bash
# Start the backend first (Terminal 1 in Step 7), then:
bash scripts/curl-tests/run-all.sh
```

This runs all curl-test scripts:
- `health.sh` — health endpoint
- `auth.sh` — signup, login, /me, reset
- `connections.sh` — 5 SIMPLE platform connect/disconnect
- `new-platforms.sh` — 4 new platform endpoints (Reddit Cookie, X Cookie, Mastodon, WordPress)
- `auto-capture.sh` — Tauri auto-capture endpoint
- `postcards.sh` — PostCard CRUD + preview
- `publish.sh` — Amplify flow

### Live platform tests (posts real content — needs real credentials):
```bash
DISCORD_WEBHOOK="https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN" \
DEVTO_API_KEY="YOUR_DEVTO_API_KEY" \
TELEGRAM_BOT_TOKEN="YOUR_TELEGRAM_BOT_TOKEN" \
TELEGRAM_CHANNEL="@netamplify_test" \
bash scripts/curl-tests/platforms-live.sh
```

### Live Reddit cookie test (needs your reddit.com cookies):
```bash
# Install Cookie-Editor extension, log in to reddit.com, export these cookies:
export REDDIT_TOKEN_V2='<your-token_v2-jwt>'
export REDDIT_CSRF='<your-csrf-token-32-hex>'
export REDDIT_TOKEN_LEGACY='<your-legacy-token-jwt>'  # optional
bash scripts/curl-tests/reddit-cookie-live.sh
```

---

## Step 7: Run the app (Option A — web browser)

Open **two terminal windows**:

### Terminal 1: Backend (NestJS on port 3000)
```bash
cd netamplify-app
pnpm dev:backend
```
You should see: `🚀 Backend is running on: http://localhost:3000`

### Terminal 2: Frontend (Vite on port 4200)
```bash
cd netamplify-app
pnpm dev:frontend
```
You should see: `Local: http://localhost:4200/`

### Open the app
Go to **http://localhost:4200** in your browser.

---

## Step 7 (alternative): Run the desktop app (Option B — Tauri)

If you installed Rust + webkit2gtk (Prerequisite #4), you can build the Tauri desktop app for the premium auto-capture UX:

### Build the Tauri app
```bash
cd netamplify-app
pnpm add -D @tauri-apps/cli@latest
npx tauri dev
```

The first build takes ~5 minutes (downloads + compiles Rust dependencies). Subsequent builds are faster (~30 seconds).

### What you get
- A native desktop window (1280×800) running the NetAmplify React frontend
- The NestJS backend runs as a sidecar process (auto-started by Tauri)
- On the Connect Checklist page, Reddit + X Cookie cards show a green **"Auto-Capture"** button
- Click "Auto-Capture" → a native login window opens to reddit.com/x.com
- Log in normally (type your username + password into the REAL form)
- Tauri reads the cookies automatically (including httpOnly) → encrypts + stores them
- No Cookie-Editor extension, no copy-paste

### Build production installers
```bash
npx tauri build
```
This creates:
- `src-tauri/target/release/bundle/deb/netamplify_1.0.0_amd64.deb` (Debian package)
- `src-tauri/target/release/bundle/appimage/netamplify_1.0.0_amd64.AppImage` (portable Linux app)

---

## Step 8: Demo walkthrough

### 8.1 — Sign up
1. Open http://localhost:4200 (web) or the Tauri desktop app
2. Click "Get started"
3. Fill in: email, password (min 8 chars with 1 uppercase + 1 lowercase + 1 digit), name
4. Click "Sign up" → you're logged in → redirected to dashboard

### 8.2 — Create a PostCard
1. Click "+ New Post Card"
2. Fill in:
   - **Title**: `NetAmplify — Post once. Get seen everywhere.`
   - **Summary**: `A one-click multi-platform posting app for students.`
   - **Description**: Write some markdown about your project
   - **Tech Stack**: type `typescript` → press Enter → repeat for `nestjs`, `react`
   - **Repo URL**: `https://github.com/marshal0004/NetAmplify`
3. Click "Create Post Card"

### 8.3 — Connect platforms
Go to "Connections" (sidebar). You'll see 12 platform cards.

**SIMPLE platforms** (paste credential → click Connect):
- **Discord**: Paste webhook URL → Connect
- **Dev.to**: Paste API key → Connect
- **Telegram**: Paste bot token + channel → Connect
- **Bluesky**: Paste handle + app password → Connect
- **Hashnode**: Paste PAT → Connect
- **Mastodon**: Paste instance URL + access token → Connect
- **WordPress**: Paste site URL + username + app password → Connect

**OAuth platforms** (click "Connect via OAuth" → log in on the platform):
- **LinkedIn**: Click "Connect via OAuth" → log in to LinkedIn → "Allow" → redirected back

**Cookie platforms** (two options):
- **Option A (web browser)**: Install Cookie-Editor extension → log in to reddit.com/x.com → export cookies → paste into the form → Connect
- **Option B (Tauri desktop app)**: Click "Auto-Capture" → native login window opens → log in normally → cookies captured automatically → Connect

### 8.4 — Amplify (the money shot!)
1. Go to your PostCard → click "🚀 Amplify"
2. Select the connected platforms (checkboxes)
3. See the live per-platform preview (Format Engine output)
4. Click "🚀 Amplify to N platforms"
5. Watch the status board: QUEUED → PUBLISHING → ✅ SUCCESS
6. Click "View post →" links → show the real posts on each platform

### 8.5 — Show History
1. Go to "History" (sidebar)
2. Show the table with per-target status chips + permalinks

### 8.6 — Show Settings + Trust
1. Go to "Settings" (sidebar)
2. Show the Trust & Security panel
3. Show the Danger Zone (account deletion with typed "DELETE" confirmation)

---

## Cookie refresh (when Reddit token_v2 expires)

Reddit's `token_v2` cookie expires every 1-2 days. When this happens:

**In the Tauri desktop app**:
1. The publish worker gets a 401 from Reddit
2. The frontend automatically calls `refresh_reddit_cookies`
3. Tauri re-opens the login window
4. If the long-lived `token` cookie (6-month life) is still valid → Reddit auto-logs in → fresh `token_v2` captured
5. Worker retries the publish with fresh cookies → success
6. **User doesn't need to do anything** (unless the long-lived `token` also expired after 6 months)

**In the web browser** (no Tauri):
1. The publish worker gets a 401 from Reddit
2. UI shows "Session expired — click to re-login"
3. User clicks → Cookie-Editor instructions shown
4. User re-exports cookies → pastes them → Connect
5. Worker retries → success

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `ECONNREFUSED localhost:5432` | `docker compose -f docker-compose.simple.yml up -d` + wait 10s |
| `bcrypt not found` | `pnpm rebuild bcrypt` |
| Frontend shows blank page | Check backend is running on :3000 first |
| LinkedIn OAuth fails | Check redirect URI is exactly `http://localhost:3000/api/oauth/linkedin/callback` in LinkedIn dev portal |
| LinkedIn OAuth: "cookieParser secret required" | Fixed in latest commit — `main.ts` now passes `process.env.JWT_SECRET` to cookieParser |
| Reddit cookie 401/403 | token_v2 expired (1-2 day life) — refresh by browsing reddit.com + re-export cookies |
| X cookie 401/403 | auth_token expired (rare — lasts 1 year) — re-export cookies |
| Reddit/X posting from cloud server fails | Reddit/X block cloud IPs — must post from residential IP (your laptop) |
| 401 on all API calls | Check `.env` has `JWT_SECRET` + `TOKEN_ENCRYPTION_KEY` set |
| Prisma errors | `npx prisma db push --schema libraries/nestjs-libraries/src/database/prisma/schema.prisma` |
| `pnpm: command not found` | `sudo npm install -g pnpm@9.5.0` |
| `docker: permission denied` | `sudo usermod -aG docker $USER` + log out + log back in |
| Tauri build fails: `webview2gtk not found` | `sudo pacman -S webkit2gtk gtk3` |
| Tauri build fails: `rustc not found` | `sudo pacman -S rust` |
| Port 5432/6379 already in use | Change ports in `docker-compose.simple.yml` + update `.env` |

---

## After the demo: SECURITY

⚠️ **Regenerate ALL credentials after your demo:**

1. **X (Twitter) OAuth**: https://developer.x.com → your app → Keys and tokens → "Regenerate"
2. **LinkedIn OAuth**: https://developer.linkedin.com → your app → Auth → "Regenerate" Client Secret
3. **Discord**: Delete the webhook in your server settings → create a new one if needed
4. **Dev.to**: https://dev.to/settings/extensions → delete the API key → generate new one
5. **Telegram**: Talk to @BotFather → `/revoke` → generate new bot token
6. **Reddit cookies**: Log out of reddit.com on all devices (invalidates the session)
7. **X cookies**: Log out of x.com on all devices (invalidates the session)
8. **GitHub PAT**: https://github.com/settings/tokens → revoke the token you gave me

---

## Architecture summary (for viva)

```
┌─────────────────────────────────────────────────────────────────┐
│  NetAmplify Desktop App (Tauri 2.0) — OPTIONAL, premium UX      │
│  ├── src-tauri/ (Rust shell)                                    │
│  │   ├── cookie_capture.rs — WebviewWindow::cookies() API       │
│  │   ├── cookie_refresh.rs — auto-refresh expired token_v2     │
│  │   └── backend_proxy.rs — sends cookies to NestJS             │
│  └── wraps the React frontend in a native window                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Browser (localhost:4200) OR Tauri window                       │
│  Vite + React + Tailwind + Framer Motion + shadcn/ui            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ fetch() with JWT Bearer token
                              │
┌─────────────────────────────────────────────────────────────────┐
│  Backend (localhost:3000)                                        │
│  NestJS + TypeScript                                             │
│  ├── AuthModule (Passport LocalStrategy + JwtStrategy)          │
│  ├── PostCardsModule (CRUD + Format Engine preview)             │
│  ├── ConnectionsModule                                          │
│  │   ├── 7 SIMPLE adapters (Discord, Dev.to, Telegram,         │
│  │   │   Bluesky, Hashnode, Mastodon, WordPress)                │
│  │   ├── 3 OAuth adapters (Reddit, X, LinkedIn)                 │
│  │   └── 2 Cookie adapters (Reddit Cookie, X Cookie)            │
│  │       └── POST /api/connections/:platform/auto-capture     │
│  │           (called by Tauri after cookie capture)             │
│  ├── PublishModule (BullMQ queue + worker)                     │
│  └── HealthController (/api/health)                             │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌──────────────────┐ ┌──────────────┐ ┌──────────────┐
│  PostgreSQL       │ │  Redis        │ │  Platform    │
│  (9 models,       │ │  (BullMQ      │ │  APIs        │
│   12 platforms)   │ │   queue)      │ │  (12 total)  │
└──────────────────┘ └──────────────┘ └──────────────┘
                                                  │
                                  ┌───────────────┼───────────────┐
                                  ▼               ▼               ▼
                            Discord         Dev.to         Telegram
                            (webhook)       (API key)      (bot token)
                                  │
                                  ▼
                            Bluesky          Hashnode       Mastodon
                            (app password)   (PAT)          (access token)
                                  │
                                  ▼
                            WordPress        LinkedIn       Reddit (Cookie)
                            (app password)   (OAuth 2.0)    (session cookies)
                                  │
                                  ▼
                            X (Cookie)       Reddit (OAuth)  X (OAuth)
                            (session cookies) (manual review) ($100/mo paywall)
```

## Testing summary (for viva)

```
548 tests total (all passing in 24s):
├── Unit (331): TokenVault, Zod, errorMapper, AuthService, 12 adapters,
│   Format Engine, QuotaService, PostCardService, PKCE, Config
├── Integration (102): supertest HTTP tests for all API endpoints
│   ├── Auth (23): signup, login, /me, reset-request, reset-confirm, account delete
│   ├── PostCards (19): CRUD + preview + ownership enforcement
│   ├── Connections (18): 5 SIMPLE-platform connect + disconnect + unknown platform
│   ├── Publish (14): no-connection, empty, unknown, 404, idempotency, retry
│   ├── Auto-Capture (9): Reddit/X cookie auto-capture endpoint (NEW in Phase 9)
│   └── Worker (9): AUTH→REVOKED+FAILED, VALIDATION→FAILED, QUOTA→SKIPPED, RATE/NETWORK→retry
├── E2E (3): full Amplify flow (signup → connect → publish → SUCCESS)
├── Non-functional (16): error envelope, ownership, idempotency, JWT, audit log
└── Tauri bridge (12): isTauri detection, capture commands, proxy, error handling
    (NEW in Phase 9 — frontend unit tests)
```

## Platform support summary (for viva)

| # | Platform | Method | Free? | Works on your laptop? |
|---|----------|--------|-------|----------------------|
| 1 | Discord | Webhook URL | ✅ | ✅ Yes |
| 2 | Dev.to | API key | ✅ | ✅ Yes |
| 3 | Telegram | Bot token + channel | ✅ | ✅ Yes |
| 4 | Bluesky | App password | ✅ | ✅ Yes |
| 5 | Hashnode | PAT | ✅ | ✅ Yes |
| 6 | Mastodon | Access token | ✅ | ✅ Yes |
| 7 | WordPress | App password | ✅ | ✅ Yes |
| 8 | LinkedIn | OAuth 2.0 PKCE | ✅ | ✅ Yes (needs LinkedIn dev app) |
| 9 | Reddit (Cookie) | Session cookies | ✅ | ✅ Yes (residential IP) |
| 10 | X (Cookie) | Session cookies | ✅ | ✅ Yes (residential IP) |
| 11 | Reddit (OAuth) | OAuth 2.0 PKCE | ✅ | ⚠️ Needs manual developer review |
| 12 | X (OAuth) | OAuth 2.0 PKCE | ❌ \$100/mo | ❌ API paywall |

**10 out of 12 platforms work on your laptop for free.** Reddit + X work via the cookie method (bypasses their paywall + manual review).
