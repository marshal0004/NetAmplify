# NetAmplify — Observability (logs, metrics, errors, scanning)

> Status: LOCKED for MVP. Companion docs: `02-SRS.md` (FR-017 audit),
> `07-SECURITY-ACCESS.md` (scanner rules), `03-ARCHITECTURE.md` (data
> flow boundaries).

---

## 1. Principles

1. **Logs are for humans debugging** — structured, searchable, but
   not the primary metric source.
2. **Metrics are for trends** — counters + histograms; exported to
   Vercel Analytics (MVP) or Prometheus (post-MVP).
3. **Errors are for incidents** — Sentry in prod; console.error in
   dev.
4. **Audit logs are for security** — separate from app logs; immutable
   per-session; never contain credentials.
5. **Scanners are for safety** — CI greps DB dumps, app logs, and API
   responses for credential patterns; any match fails the build.

---

## 2. Metrics (basic MVP)

### 2.1 Counters

| Counter | Labels | Updated by |
|---|---|---|
| `netamplify_publishes_total` | `outcome=SUCCESS\|FAILED\|SKIPPED`, `platform` | publish-worker |
| `netamplify_publish_retries_total` | `platform`, `attemptNumber` | publish-worker |
| `netamplify_connections_total` | `platform`, `status=ACTIVE\|REVOKED` | connections service |
| `netamplify_signups_total` | (none) | auth service |
| `netamplify_logins_total` | `outcome=SUCCESS\|FAIL` | auth service |
| `netamplify_oauth_starts_total` | `platform` | oauth start route |
| `netamplify_oauth_callbacks_total` | `platform`, `outcome=SUCCESS\|BAD_STATE\|EXCHANGE_FAILED` | oauth callback route |
| `netamplify_quota_skipped_total` | `platform` (mostly TWITTER) | publish service |
| `netamplify_rate_limited_total` | `scope=global\|auth\|publish`, `user_or_ip` (hashed) | rate-limit middleware |

### 2.2 Histograms

| Histogram | Labels | Updated by |
|---|---|---|
| `netamplify_api_latency_ms` | `route`, `method`, `status` | route middleware |
| `netamplify_publish_dispatch_ms` | (none) | publish service |
| `netamplify_worker_per_target_ms` | `platform`, `outcome` | publish-worker |
| `netamplify_formatter_ms` | `platform` | (optional stretch; pure fns are fast) |

### 2.3 Export (MVP)

MVP exports:
- **Vercel Analytics** (built-in): request count, status, latency,
  Web Vitals. Free.
- **Custom counters**: stored in Redis (`INCR metric:counter_name`) +
  flushed to a `Metric` log line every 60s. Parsed by a simple
  dashboard (post-MVP: Grafana).
- **Custom histograms**: same; stored as Redis sorted sets.

Post-MVP: Prometheus + Grafana (or Vercel Observability).

### 2.4 Example: incrementing a counter

```typescript
// src/lib/metrics/counters.ts
import { redis } from '@/server/redis';

export async function incCounter(name: string, labels: Record<string, string> = {}, value = 1) {
  const key = `metric:${name}:${Object.entries(labels).map(([k,v]) => `${k}=${v}`).join(',')}`;
  await redis.incrby(key, value);
}

// Usage in publish-worker:
await incCounter('publishes_total', { outcome: 'SUCCESS', platform: target.platform });
```

### 2.5 Example: histogram

```typescript
// src/lib/metrics/histograms.ts
import { redis } from '@/server/redis';

export async function observeHistogram(name: string, valueMs: number, labels: Record<string, string> = {}) {
  const key = `metric:${name}:${Object.entries(labels).map(([k,v]) => `${k}=${v}`).join(',')}`;
  // Use Redis sorted set for histogram (score = ms, value = timestamp)
  await redis.zadd(key, valueMs, Date.now());
  // Expire after 7 days (post-MVP: roll up)
  await redis.expire(key, 7 * 24 * 60 * 60);
}
```

---

## 3. Logs (structured)

### 3.1 Logger setup

Use `pino` (lighter than winston, faster).

```typescript
// src/lib/logger.ts
import pino from 'pino';
import { env } from './config/env';

export const logger = pino({
  level: env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'credentialsCipher',
      'password',
      'passwordHash',
      '*.access_token',
      '*.refresh_token',
      '*.apiKey',
      '*.pat',
      '*.webhookUrl',
      '*.botToken',
      '*.appPassword',
      '*.app_password',
      'creds.*',
    ],
    remove: false,  // replace with [Redacted] instead of removing key
  },
  serializers: {
    req(req) {
      return { method: req.method, url: req.url, remoteAddress: req.remoteAddress };
    },
    err(err) {
      return { message: err.message, name: err.name, stack: env.NODE_ENV === 'production' ? undefined : err.stack };
    },
  },
});

// Per-request logger (correlates by requestId)
export function createRequestLogger(requestId: string, userId?: string) {
  return logger.child({ requestId, userId });
}
```

### 3.2 Log levels

| Level | When to use | Example |
|---|---|---|
| `debug` | Dev-only; verbose; never in prod | `logger.debug({ route, body }, 'handling publish request')` |
| `info` | Audit events + normal operation | `logger.info({ userId, action: 'PUBLISH', postId }, 'publish created')` |
| `warn` | Rate-limit hits, retries, expected-but-notable errors | `logger.warn({ platform, errorClass: 'RATE' }, 'rate-limited; retrying')` |
| `error` | 5xx, adapter failures, unhandled exceptions | `logger.error({ err, route }, 'unhandled error')` |
| `fatal` | App can't start (missing env, can't connect to DB) | `logger.fatal({ err }, 'failed to start')` |

### 3.3 Structured log fields (mandatory)

Every log line includes:

| Field | Type | Notes |
|---|---|---|
| `level` | string | auto from pino |
| `time` | ISO 8601 | auto from pino |
| `requestId` | string (UUID) | from request middleware |
| `route` | string | e.g., `POST /api/postcards/:id/publish` |
| `userId` | string? | from session; null for unauth |
| `latencyMs` | number | for request-end logs |
| `outcome` | string | `success`, `error`, `redirect`, etc. |
| `msg` | string | human-readable summary |

Plus event-specific fields (e.g., `platform`, `postId`, `targetId`).

### 3.4 NEVER log

- Credentials of any shape (redactor handles it).
- Decrypted content (redactor handles `creds.*`).
- Full request bodies for credential routes (`/api/connections/*`,
  `/api/oauth/*`).
- Tokens (redactor handles `access_token`, `refresh_token`, `apiKey`,
  `pat`, `webhookUrl`, `botToken`, `appPassword`).
- Email content (password-reset emails).
- IPs in prod without hashing (per privacy; MVP: log IPs in audit
  logs only).

### 3.5 PII scrubbing

- The pino redactor handles most cases (above).
- Sentry: enable PII scrubbing in `sentry.server.config.ts`:
  ```typescript
  Sentry.init({
    dsn: env.SENTRY_DSN,
    tracesSampleRate: 1.0,
    beforeSend(event) {
      // Scrub emails, IPs, tokens from breadcrumbs + extra
      if (event.request) {
        event.request.headers = scrubHeaders(event.request.headers);
        event.request.cookies = '[Redacted]';
      }
      return event;
    },
  });
  ```

---

## 4. Audit logs (security-relevant — separate from app logs)

Per FR-017:

| Action | When | metadata |
|---|---|---|
| `LOGIN` | successful login | `{}` |
| `LOGIN_FAIL` | failed login OR reset-request for nonexistent email | `{ email }` (for monitoring) |
| `CONNECT` | OAuth or simple-credential connect succeeds | `{ platform, username }` |
| `DISCONNECT` | DELETE connection | `{ platform }` |
| `PUBLISH` | POST publish (one row per Post, not per target) | `{ postId, platforms: [...] }` |
| `RETRY` | POST retry | `{ postId, targetId, attemptNumber }` |
| `TOKEN_FAIL` | OAuth state mismatch or exchange failed | `{ platform, reason }` |
| `ACCOUNT_DELETE` | DELETE account (kept after User cascade) | `{}` |
| `EXPORT` | GET account/export (post-MVP addition) | `{}` |

### 4.1 AuditLog fields (per `04-DATABASE.md`)

```prisma
model AuditLog {
  id        String   @id @default(cuid())
  userId    String?
  user      User?    @relation(fields: [userId], references: [id], onDelete: NoAction)
  action    String   @db.VarChar(40)
  platform  String?  @db.VarChar(20)
  ip        String?  @db.VarChar(45)
  userAgent String?  @db.VarChar(500)
  metadata  Json?
  createdAt DateTime @default(now())

  @@index([userId, createdAt])
  @@index([action, createdAt])
}
```

### 4.2 Audit service

```typescript
// src/server/services/audit.ts
import { prisma } from '@/server/db';
import { logger } from '@/lib/logger';

export interface AuditEvent {
  userId?: string;
  action: 'LOGIN' | 'LOGIN_FAIL' | 'CONNECT' | 'DISCONNECT' |
          'PUBLISH' | 'RETRY' | 'TOKEN_FAIL' | 'ACCOUNT_DELETE' | 'EXPORT';
  platform?: string;
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export async function audit(event: AuditEvent): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: event.userId,
      action: event.action,
      platform: event.platform,
      ip: event.ip,
      userAgent: event.userAgent,
      metadata: event.metadata ?? undefined,
    },
  });
  logger.info({ ...event, action: 'AUDIT' }, `audit: ${event.action}`);
}
```

### 4.3 What NEVER goes in AuditLog.metadata

- Credentials (any shape).
- Decrypted content.
- Full request bodies.
- Anything matching the secret regex (below).

### 4.4 Audit log review (post-MVP)

- Weekly: review `LOGIN_FAIL` spikes (credential stuffing attempts).
- Monthly: review `TOKEN_FAIL` (OAuth attacks).
- Per-incident: review `PUBLISH` and `CONNECT` in the incident
  window.

---

## 5. Error tracking (Sentry)

### 5.1 Setup

```typescript
// src/sentry.server.config.ts
import * as Sentry from '@sentry/nextjs';
import { env } from './lib/config/env';

export function register() {
  if (env.SENTRY_DSN) {
    Sentry.init({
      dsn: env.SENTRY_DSN,
      tracesSampleRate: 1.0,
      environment: env.NODE_ENV,
      beforeSend(event) {
        // PII scrubbing
        if (event.request) {
          event.request.headers = scrubHeaders(event.request.headers);
          event.request.cookies = '[Redacted]';
        }
        return event;
      },
    });
  }
}

function scrubHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const scrubbed = { ...headers };
  for (const key of Object.keys(scrubbed)) {
    if (/auth|cookie|token|key|secret/i.test(key)) {
      scrubbed[key] = '[Redacted]';
    }
  }
  return scrubbed;
}
```

### 5.2 Source maps

- Vercel: automatic (Next.js + Sentry integration).
- Self-hosted: upload via `sentry-cli` after build:
  ```bash
  sentry-cli sourcemaps upload --release <version> .next/static
  ```

### 5.3 Alert rules (Sentry)

- New error in prod: alert immediately.
- Error rate >1% in 5 min: alert.
- 5xx rate >0.5% in 5 min: alert.
- Specific errors to alert on:
  - `OAUTH_EXCHANGE_FAILED` (any platform)
  - `TokenVault.decrypt` errors (tampered ciphertext)
  - `prisma.$transaction` failures

### 5.4 What NEVER goes to Sentry

- Credentials (scrubbed via `beforeSend`).
- Decrypted content.
- User passwords / emails (PII scrubbing).
- Full request bodies for credential routes.

---

## 6. Secrets scanning (CI gate)

### 6.1 The secret regex (used by all scanners)

```regex
# Dev.to / OpenAI-style API keys
sk-[A-Za-z0-9]{20,}

# Slack tokens (defensive — we don't use Slack)
xoxb-[A-Za-z0-9-]+

# Bluesky DIDs
did:plc:[A-Za-z2-7]{24}

# Telegram bot tokens (shape: \d{6,}:<base64-ish>{30,})
\d{6,}:[A-Za-z0-9_-]{30,}

# Discord webhook URLs
https://discord\.com/api/webhooks/\d+/[A-Za-z0-9_-]+

# JWT shape (defensive)
eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}

# Reddit refresh tokens (base64-ish, 30+ chars after reddit_)
reddit_[A-Za-z0-9_-]{30,}

# Hashnode PATs (defensive — Hashnode doesn't publish a format)
hashnode_[A-Za-z0-9_-]{20,}
```

### 6.2 DB dump scanner (`scripts/scan-db-dump.sh`)

```bash
#!/usr/bin/env bash
set -euo pipefail

# Run in CI after integration tests
echo "Scanning DB dump for credential patterns..."

DUMP=$(mktemp)
pg_dump "$DATABASE_URL" > "$DUMP"

PATTERNS=(
  'sk-[A-Za-z0-9]{20,}'
  'xoxb-[A-Za-z0-9-]+'
  'did:plc:[A-Za-z2-7]{24}'
  '[0-9]{6,}:[A-Za-z0-9_-]{30,}'
  'https://discord\.com/api/webhooks/[0-9]+/[A-Za-z0-9_-]+'
  'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'
  'reddit_[A-Za-z0-9_-]{30,}'
  'hashnode_[A-Za-z0-9_-]{20,}'
)

FOUND=0
for p in "${PATTERNS[@]}"; do
  if grep -E "$p" "$DUMP"; then
    echo "❌ Found credential pattern in DB dump: $p"
    FOUND=1
  fi
done

rm "$DUMP"

if [ "$FOUND" -eq 1 ]; then
  echo "❌ DB dump scanner FAILED"
  exit 1
fi

echo "✅ DB dump scanner passed"
```

### 6.3 Log scanner (`scripts/scan-logs.sh`)

```bash
#!/usr/bin/env bash
set -euo pipefail

# Run in CI after integration tests
echo "Scanning application logs for credential patterns..."

# In CI, capture logs to a file (or use a fixture)
LOG_FILE="${1:-/tmp/netamplify-test.log}"

PATTERNS=(
  'sk-[A-Za-z0-9]{20,}'
  'xoxb-[A-Za-z0-9-]+'
  'did:plc:[A-Za-z2-7]{24}'
  '[0-9]{6,}:[A-Za-z0-9_-]{30,}'
  'https://discord\.com/api/webhooks/[0-9]+/[A-Za-z0-9_-]+'
  'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'
  'reddit_[A-Za-z0-9_-]{30,}'
)

FOUND=0
for p in "${PATTERNS[@]}"; do
  if grep -E "$p" "$LOG_FILE"; then
    echo "❌ Found credential pattern in logs: $p"
    FOUND=1
  fi
done

if [ "$FOUND" -eq 1 ]; then
  echo "❌ Log scanner FAILED"
  exit 1
fi

echo "✅ Log scanner passed"
```

### 6.4 API response scanner (Vitest integration test)

```typescript
// tests/integration/credential-scanner.test.ts
import { describe, expect, it } from 'vitest';
// Import every route handler...

const patterns = [
  /sk-[A-Za-z0-9]{20,}/,
  /xoxb-[A-Za-z0-9-]+/,
  /did:plc:[A-Za-z2-7]{24}/,
  /\d{6,}:[A-Za-z0-9_-]{30,}/,
  /https:\/\/discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /reddit_[A-Za-z0-9_-]{30,}/,
  /hashnode_[A-Za-z0-9_-]{20,}/,
];

describe('credential scanner — no patterns in any API response', () => {
  it('GET /api/connections', async () => {
    // setup user + connections
    const res = await GET(...);
    const body = JSON.stringify(await res.json());
    for (const p of patterns) expect(body).not.toMatch(p);
  });

  it('POST /api/connections/discord', async () => {
    // ... same for each connection route
  });

  it('GET /api/posts/:id', async () => {
    // ... same for publish / history
  });

  it('GET /api/account/export', async () => {
    // CRITICAL: export should never include credentialsCipher
  });

  // ... etc for every endpoint that returns data
});
```

### 6.5 Pre-commit secret scanner (optional stretch)

Use `gitleaks` or `trufflehog` as a pre-commit hook:

```bash
# .git/hooks/pre-commit
#!/usr/bin/env bash
gitleaks protect --staged --redact --verbose
```

Or via Husky + a npm script:
```json
"scripts": {
  "scan:secrets": "gitleaks detect --source . --redact --verbose"
}
```

Run before commit; fails on any secret in staged files.

---

## 7. Uptime monitoring

### 7.1 Health endpoint

`GET /api/health`:
```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@/server/db';
import { redis } from '@/server/redis';

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    return NextResponse.json({ db: 'down', redis: 'unknown' }, { status: 503 });
  }
  try {
    await redis.ping();
  } catch {
    return NextResponse.json({ db: 'up', redis: 'down' }, { status: 503 });
  }
  return NextResponse.json({ db: 'up', redis: 'up' });
}
```

### 7.2 UptimeRobot

- Monitor `https://<prod-domain>/api/health`.
- Interval: 1 min.
- Alert: on 5xx OR downtime (defined as 2 consecutive failures).

### 7.3 Vercel built-in

- Vercel Analytics → Monitoring tab: response time, status codes.
- Vercel automatically alerts on 5xx rate >5% in 5 min (on Pro plan).

---

## 8. Dashboards (post-MVP, design leaves room)

MVP: simple Grafana or Vercel Analytics views.

Post-MVP dashboards:
- **Publish funnel**: starts → in-flight → success/fail/skipped.
- **Per-platform**: success rate, latency, retry rate.
- **Connection health**: ACTIVE / REVOKED / reconnect rate.
- **Auth**: signup / login / fail rate; reset requests.
- **Performance**: p50/p95/p99 API latency; Lighthouse scores.

---

## 9. Incident logging (post-MVP)

When an incident occurs:

1. Create an incident doc: `docs/incidents/<YYYY-MM-DD>-<short>.md`.
2. Timeline: every event with timestamps.
3. Root cause analysis.
4. Fix description.
5. Prevention measures.
6. Update `docs/13-PROGRESS.md` with the incident reference.

MVP: rely on Sentry + audit logs for incident reconstruction.

---

## 10. Log retention

| Source | Retention | Why |
|---|---|---|
| Vercel app logs | 7 days (free) / 30 days (Pro) | debugging |
| Postgres AuditLog | forever (until account deletion) | security |
| Sentry events | 90 days (free) | incident analysis |
| Redis metric counters | 7 days | trend analysis |

---

> End of observability doc. Next: open `docs/13-PROGRESS.md` and
> check the current status before starting any ticket.
