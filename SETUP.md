# NetAmplify — Local Setup Guide (Arch Linux)

> Complete step-by-step guide to run NetAmplify on your Arch Linux laptop.

## Prerequisites

You need these installed. If you don't have them, run the install commands:

### 1. Docker + Docker Compose
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
# Verify:
node --version  # should be v20+ (v24 is fine)
```

### 3. pnpm
```bash
sudo npm install -g pnpm@10.6.1
# Verify:
pnpm --version  # should be 10.6.1
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

Create a file named `.env` in the root of `netamplify-app/` with this content:

```env
# Database (from docker-compose.dev.yaml)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/netamplify
REDIS_URL=redis://localhost:6379

# Security (generate with: openssl rand -base64 32)
TOKEN_ENCRYPTION_KEY=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=
JWT_SECRET=your-jwt-secret-change-this-to-random-string

# Twitter (from https://developer.x.com)
TWITTER_CLIENT_ID=your-twitter-client-id
TWITTER_CLIENT_SECRET=your-twitter-client-secret

# LinkedIn (from https://developer.linkedin.com)
LINKEDIN_CLIENT_ID=your-linkedin-client-id
LINKEDIN_CLIENT_SECRET=your-linkedin-client-secret

# App URLs
FRONTEND_URL=http://localhost:4200
PUBLIC_APP_URL=http://localhost:4200
NEXTAUTH_URL=http://localhost:4200
NOT_SECURED=true

# Email (leave empty for dev — reset tokens print to console)
EMAIL_PROVIDER=

# X Monthly Quota
X_MONTHLY_POST_BUDGET=450
```

### Your actual credentials (from our testing session):

Replace the placeholders above with your real credentials:

```env
# Twitter (OAuth 2.0 Client ID + Secret from developer.x.com)
TWITTER_CLIENT_ID=YOUR_TWITTER_CLIENT_ID
TWITTER_CLIENT_SECRET=YOUR_TWITTER_CLIENT_SECRET

# LinkedIn (OAuth 2.0 Client ID + Secret from developer.linkedin.com)
LINKEDIN_CLIENT_ID=YOUR_LINKEDIN_CLIENT_ID
LINKEDIN_CLIENT_SECRET=YOUR_LINKEDIN_CLIENT_SECRET
```

For the **SIMPLE platforms** (Discord, Dev.to, Telegram, Bluesky, Hashnode), you don't need env vars — users paste their own credentials via the Connect Checklist UI. But for testing, here are your credentials:

| Platform | Credential | Value |
|----------|-----------|-------|
| Discord | Webhook URL | `https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN` |
| Dev.to | API Key | `YOUR_DEVTO_API_KEY` |
| Telegram | Bot Token | `YOUR_TELEGRAM_BOT_TOKEN` |
| Telegram | Channel | `@netamplify_test` |

---

## Step 3: Install dependencies

```bash
cd netamplify-app
pnpm install --no-frozen-lockfile
pnpm rebuild bcrypt
npx prisma generate --schema libraries/nestjs-libraries/src/database/prisma/schema.prisma
```

---

## Step 4: Start Postgres + Redis (via Docker)

```bash
docker compose -f docker-compose.dev.yaml up -d
```

Wait 10 seconds, then verify both containers are running:
```bash
docker ps
```

You should see:
- `postgres:16` running on port 5432
- `redis:7` running on port 6379

---

## Step 5: Apply database schema

```bash
pnpm prisma-db-push
```

This creates all 9 tables (User, Profile, PostCard, ProjectMedia, Connection, Post, PostTarget, QuotaUsage, AuditLog).

---

## Step 6: Run tests (optional — proves everything works)

### Unit + Integration + E2E tests (433 total, ~22 seconds):
```bash
pnpm test
```
Expected output: `Test Files 24 passed (24)` + `Tests 433 passed (433)`

### Live platform tests (posts real content to Discord, Dev.to, Telegram):
```bash
DISCORD_WEBHOOK="https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN" \
DEVTO_API_KEY="YOUR_DEVTO_API_KEY" \
TELEGRAM_BOT_TOKEN="YOUR_TELEGRAM_BOT_TOKEN" \
TELEGRAM_CHANNEL="@netamplify_test" \
bash scripts/curl-tests/platforms-live.sh
```
Expected output: `✅ All platforms PASSED`

---

## Step 7: Start the app

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

---

## Step 8: Open the app

Open your browser and go to: **http://localhost:4200**

You should see the NetAmplify landing page.

---

## Step 9: Demo walkthrough

### 9.1 — Sign up
1. Click "Get started"
2. Fill in: email, password (min 8 chars with 1 uppercase + 1 lowercase + 1 digit), name
3. Click "Sign up" → you're logged in → redirected to dashboard

### 9.2 — Create a PostCard
1. Click "+ New Post Card"
2. Fill in:
   - **Title**: `NetAmplify — Post once. Get seen everywhere.`
   - **Summary**: `A one-click multi-platform posting app for students.`
   - **Description**: Write some markdown about your project
   - **Tech Stack**: type `typescript` → press Enter → repeat for `nestjs`, `react`
   - **Repo URL**: `https://github.com/marshal0004/NetAmplify`
3. Click "Create Post Card"

### 9.3 — Connect platforms
1. Go to "Connections" (sidebar)
2. Connect each platform:

   **Discord**: Paste webhook URL → click "Connect"
   ```
   https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN
   ```

   **Dev.to**: Paste API key → click "Connect"
   ```
   YOUR_DEVTO_API_KEY
   ```

   **Telegram**: Paste bot token + channel → click "Connect"
   ```
   Bot Token: YOUR_TELEGRAM_BOT_TOKEN
   Channel: @netamplify_test
   ```

   **LinkedIn**: Click "Connect via OAuth" → log in to LinkedIn → "Allow" → redirected back

### 9.4 — Amplify (the money shot!)
1. Go to your PostCard → click "🚀 Amplify"
2. Select Discord + Dev.to + Telegram + LinkedIn (checkboxes)
3. See the live per-platform preview (Format Engine output)
4. Click "🚀 Amplify to 4 platforms"
5. Watch the status board: QUEUED → PUBLISHING → ✅ SUCCESS
6. Click "View post →" links → show the real posts on each platform

### 9.5 — Show History
1. Go to "History" (sidebar)
2. Show the table with per-target status chips + permalinks

### 9.6 — Show Settings + Trust
1. Go to "Settings" (sidebar)
2. Show the Trust & Security panel ("How we protect you" — 5 bullet points)
3. Show the Danger Zone (account deletion with typed "DELETE" confirmation)

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `ECONNREFUSED localhost:5432` | `docker compose -f docker-compose.dev.yaml up -d` + wait 10s |
| `bcrypt not found` | `pnpm rebuild bcrypt` |
| Frontend shows blank page | Check backend is running on :3000 first |
| LinkedIn OAuth fails | Check redirect URI is exactly `http://localhost:3000/api/oauth/linkedin/callback` in LinkedIn dev portal |
| 401 on all API calls | Check `.env` has `JWT_SECRET` + `TOKEN_ENCRYPTION_KEY` set |
| Prisma errors | `pnpm prisma-db-push` to reset + recreate schema |
| `pnpm: command not found` | `sudo npm install -g pnpm@10.6.1` |
| `docker: permission denied` | `sudo usermod -aG docker $USER` + log out + log back in |

---

## After the demo: SECURITY

⚠️ **Regenerate ALL credentials after your demo:**

1. **X (Twitter)**: Go to https://developer.x.com → your app → Keys and tokens → "Regenerate"
2. **LinkedIn**: Go to https://developer.linkedin.com → your app → Auth → "Regenerate" Client Secret
3. **Discord**: Delete the webhook in your server settings → create a new one if needed
4. **Dev.to**: Go to https://dev.to/settings/extensions → delete the API key → generate new one
5. **Telegram**: Talk to @BotFather → `/revoke` → generate new bot token
6. **GitHub PAT**: Go to https://github.com/settings/tokens → revoke the token you gave me

---

## Architecture summary (for viva)

```
Browser (localhost:4200)
    │
    ▼ Vite + React + Tailwind + shadcn/ui
    │
    ▼ fetch() with JWT Bearer token
    │
Backend (localhost:3000)
    │ NestJS + TypeScript
    ├── AuthModule (Passport LocalStrategy + JwtStrategy)
    ├── PostCardsModule (CRUD + Format Engine preview)
    ├── ConnectionsModule (5 SIMPLE + 3 OAuth adapters)
    ├── PublishModule (BullMQ queue + worker)
    ├── QueueModule (Redis + BullMQ worker)
    └── HealthController (/api/health)
    │
    ├── Prisma ORM → PostgreSQL (9 models)
    ├── TokenVault (AES-256-GCM encryption)
    ├── Format Engine (8 pure per-platform formatters)
    └── AdapterRegistry (8 platform adapters)
    │
    ▼ BullMQ jobs
    │
Worker (concurrency=5)
    │ 1. Load PostTarget
    │ 2. Decrypt Connection credentials
    │ 3. Format via Format Engine
    │ 4. Call adapter.publish()
    │ 5. Update target status (SUCCESS/FAILED/SKIPPED)
    │
    ▼ Platform APIs
    ├── Discord (webhook)
    ├── Dev.to (API key)
    ├── Telegram (bot token)
    ├── LinkedIn (OAuth 2.0)
    ├── Reddit (OAuth 2.0)
    ├── Bluesky (app password)
    ├── Hashnode (PAT)
    └── X/Twitter (OAuth 2.0)
```

## Testing summary (for viva)

```
433 tests total:
├── Unit (331): TokenVault, Zod, errorMapper, AuthService, 8 adapters, Format Engine
├── Integration (102): supertest HTTP tests for all API endpoints
├── E2E (3): full Amplify flow (signup → connect → publish → SUCCESS)
└── Non-functional (16): error envelope, ownership, idempotency, JWT, audit log
```
