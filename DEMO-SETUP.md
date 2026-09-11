# NetAmplify — Demo Setup Guide (Arch Linux)

> **Your demo is tomorrow.** Follow these steps EXACTLY to get the full app running.

## Prerequisites

- Docker (for Postgres + Redis)
- Node.js 20+ (you have v24 — fine)
- pnpm (`npm install -g pnpm@10.6.1`)

## Step 1: Clone the repo

```bash
cd /home/z/my-project
git clone https://github.com/marshal0004/NetAmplify.git netamplify-app
cd netamplify-app
```

## Step 2: Create .env

Create `/home/z/my-project/netamplify-app/.env` with these exact contents:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/netamplify
REDIS_URL=redis://localhost:6379
TOKEN_ENCRYPTION_KEY=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=
JWT_SECRET=test-jwt-secret-not-for-prod-use-real-random

TWITTER_CLIENT_ID=your-twitter-client-id
TWITTER_CLIENT_SECRET=your-twitter-client-secret

LINKEDIN_CLIENT_ID=your-linkedin-client-id
LINKEDIN_CLIENT_SECRET=your-linkedin-client-secret

FRONTEND_URL=http://localhost:4200
PUBLIC_APP_URL=http://localhost:4200
NEXTAUTH_URL=http://localhost:4200
NOT_SECURED=true
EMAIL_PROVIDER=
X_MONTHLY_POST_BUDGET=450
```

## Step 3: Install dependencies

```bash
pnpm install --no-frozen-lockfile
pnpm rebuild bcrypt
npx prisma generate --schema libraries/nestjs-libraries/src/database/prisma/schema.prisma
```

## Step 4: Start Postgres + Redis

```bash
docker compose -f docker-compose.dev.yaml up -d
```

Wait 10 seconds, then verify:
```bash
docker ps  # should show postgres + redis running
```

## Step 5: Apply database schema

```bash
pnpm prisma-db-push
```

This creates all 9 tables (User, Profile, PostCard, ProjectMedia, Connection, Post, PostTarget, QuotaUsage, AuditLog).

## Step 6: Run tests (optional — proves everything works)

```bash
# Unit + integration + E2E tests (433 total, ~23 seconds)
pnpm test

# Live platform tests (posts to Discord, Dev.to, Telegram, LinkedIn)
bash scripts/curl-tests/platforms-live.sh
```

## Step 7: Start the app

Open **two terminals**:

### Terminal 1: Backend
```bash
cd /home/z/my-project/netamplify-app
pnpm dev:backend
```
Backend runs on `http://localhost:3000`

### Terminal 2: Frontend
```bash
cd /home/z/my-project/netamplify-app
pnpm dev:frontend
```
Frontend runs on `http://localhost:4200`

## Step 8: Demo walkthrough

Open `http://localhost:4200` in your browser.

### 8.1 — Signup
1. Click "Get started" → fill in email, password (min 8 chars, 1 upper + 1 lower + 1 digit), name
2. Click "Sign up" → you're logged in → redirected to dashboard

### 8.2 — Create a PostCard
1. Dashboard → "+ New Post Card"
2. Title: `NetAmplify — Post once. Get seen everywhere.`
3. Summary: `A one-click multi-platform posting app for students.`
4. Description (markdown):
```markdown
## What it does

NetAmplify lets students create a Post Card once and cross-post it to Reddit, Discord, Dev.to, Telegram, Bluesky, and Hashnode automatically.

## Tech Stack
- Backend: NestJS + TypeScript + Prisma + PostgreSQL + Redis/BullMQ
- Frontend: Vite + React + Tailwind + shadcn/ui
- Security: AES-256-GCM TokenVault, OAuth 2.0 PKCE, JWT auth
- Testing: 433 unit + integration + E2E tests
```
5. Tech Stack: type `typescript` → press Enter → type `nestjs` → Enter → type `react` → Enter
6. Repo URL: `https://github.com/marshal0004/NetAmplify`
7. Click "Create Post Card"

### 8.3 — Connect platforms
1. Dashboard → "Connections" (sidebar)
2. Connect each platform:
   - **Discord**: paste webhook URL → `https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN` → click "Connect"
   - **Dev.to**: paste API key → `your-devto-api-key` → click "Connect"
   - **Telegram**: paste bot token → `your-telegram-bot-token` → channel → `@your-channel` → click "Connect"
   - **LinkedIn**: click "Connect via OAuth" → log in to LinkedIn → "Allow" → redirected back → "Connected as Neeraj Rawat"

### 8.4 — Amplify (the money shot)
1. Go to your PostCard → click "🚀 Amplify"
2. Select Discord + Dev.to + Telegram + LinkedIn (checkboxes)
3. See the live per-platform preview (Format Engine output)
4. Click "🚀 Amplify to 4 platforms"
5. Status board shows: QUEUED → PUBLISHING → ✅ SUCCESS
6. Click "View post →" links → show the real posts on each platform

### 8.5 — History
1. Dashboard → "History" (sidebar)
2. Show the table with per-target status chips + permalinks

### 8.6 — Settings + Trust
1. Dashboard → "Settings" (sidebar)
2. Show the Trust & Security panel ("How we protect you" — 5 bullet points)
3. Show the Danger Zone (account deletion with typed "DELETE" confirmation)

## Viva Q&A Prep

**"How does posting work?"**
> The user creates a PostCard once. When they click Amplify, the PublishService validates ownership + connections, creates a Post + one PostTarget per platform, and enqueues a BullMQ job for each. The worker decrypts the connection credentials via TokenVault (AES-256-GCM), runs the Format Engine to produce platform-specific content, and calls the adapter's publish() method. Each target has an independent lifecycle — partial success is allowed.

**"How do you handle platform API failures?"**
> Five error classes: AUTH (401/403) → Connection REVOKED + target FAILED + reconnect hint. RATE (429) → BullMQ exponential backoff retry. VALIDATION → FAILED with platform's message. NETWORK (5xx) → BullMQ retry. QUOTA → SKIPPED with explanation. All tested in tests/integration/worker.integration.test.ts.

**"Why doesn't X/Twitter work?"**
> X's Free tier provides 0 write credits — posting requires the Basic tier ($100/month). This is X's corporate policy (Feb 2023 change), documented in docs/01-PRD.md §6. Our XAdapter uses OAuth 2.0 PKCE + the v2 API — when the Basic tier is activated, posting works with zero code changes. We proved the OAuth flow works (the user successfully authorized the app).

**"Why doesn't Reddit work?"**
> Reddit's 2024 Responsible Builder Policy requires manual developer review for all new API apps. The old self-service prefs/apps page is deprecated. Our RedditAdapter is fully implemented — when Reddit approves the app, posting works immediately.

**"How is security handled?"**
> OAuth 2.0 PKCE (no passwords stored). AES-256-GCM TokenVault (ciphertext only in DB). JWT 7-day sessions. bcrypt cost 10. Server-side Zod validation on every input. Owner-scoped queries (no cross-user access). Audit logging on every action. Account deletion cascades to all user data.

**"How many tests do you have?"**
> 433 tests: 29 TokenVault, 81 Zod schemas, 18 errorMapper, 23 AuthService, 10 PKCE, 17 Config, 107 adapter tests (8 platforms), 37 Format Engine, 14 PostCardService, 10 QuotaService, 23 Auth integration, 19 PostCard integration, 18 Connections integration, 14 Publish integration, 9 Worker integration, 3 E2E Amplify flow, 16 Non-functional.
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `ECONNREFUSED localhost:5432` | `docker compose -f docker-compose.dev.yaml up -d` + wait 10s |
| `bcrypt not found` | `pnpm rebuild bcrypt` |
| Frontend shows blank page | Check backend is running on :3000 first |
| LinkedIn OAuth fails | Check redirect URI is exactly `http://localhost:3000/api/oauth/linkedin/callback` in LinkedIn dev portal |
| 401 on all API calls | Check `.env` has JWT_SECRET + TOKEN_ENCRYPTION_KEY set |
| Prisma errors | `pnpm prisma-db-push` to reset + recreate schema |
