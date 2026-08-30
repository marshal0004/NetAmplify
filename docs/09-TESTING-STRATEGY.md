# NetAmplify — Testing Strategy

> Status: LOCKED for MVP. The rule that overrides everything else:
> **never call real platform APIs in tests.** Mock at the adapter
> boundary.
>
> Companion docs: `02-SRS.md` (FRs that drive test cases),
> `03-ARCHITECTURE.md` (adapter seam), `08-CODING-STANDARDS.md` (Service
> + Result patterns), `16-OBSERVABILITY.md` (log scanner).

---

## 0. The one rule that overrides everything

**NEVER call a real platform API in any test, ever.**

- Unit tests: pure functions, no platform calls by design.
- Integration tests: mock the adapter boundary (the function returned
  by `getAdapter(platform)`).
- E2E tests: mock the adapter boundary globally via a Playwright
  fixture that intercepts at the module level.
- Real platform calls happen ONLY in `scripts/smoke.ts`, run manually
  before demo, never in CI.

If you find yourself writing `fetch('https://reddit.com/...')` in a
test, STOP. You are about to commit a CI flake + a credentials leak
risk.

---

## 1. Test pyramid

```
                    ┌──────────────────┐
                    │   Manual smoke   │   (1 test: scripts/smoke.ts)
                    │   (real APIs)    │     run before demo
                    └──────────────────┘
                  ┌──────────────────────┐
                  │      E2E (Playwright) │  (~8 tests; whole flows)
                  │   adapter-mocked      │
                  └──────────────────────┘
                ┌──────────────────────────┐
                │   Integration (Vitest)   │  (~25 tests; routes + services
                │   real DB + Redis          │   + adapter mocks)
                │   adapter-mocked          │
                └──────────────────────────┘
              ┌──────────────────────────────┐
              │     Unit (Vitest)            │  (~100 tests; pure + small)
              │   pure; in-memory only          │
              └──────────────────────────────┘
```

### Coverage targets

| Layer | Coverage | What's covered |
|---|---|---|
| `src/lib/vault/` | 100% | every branch: round-trip, tampered, missing key |
| `src/lib/formatters/` | 100% | every platform: golden + property + determinism + edge cases |
| `src/server/services/` | ≥90% | every service function incl. error paths |
| `src/app/api/` | ≥80% (route handlers are thin; mostly integration-tested) | guard + Zod paths |
| `src/lib/platforms/` (adapter unit) | ≥80% | mocked fetch returning valid/invalid/network |
| `src/components/` | ≥50% (component tests stretch) | key components render + state changes |
| `src/workers/` | ≥90% | status transitions, AUTH/RATE/NETWORK/VALIDATION/QUOTA paths |

---

## 2. Unit tests (Vitest)

### 2.1 Vault (`src/lib/vault/token-vault.test.ts`)

```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import { TokenVault } from './token-vault';

describe('TokenVault', () => {
  let vault: TokenVault;

  beforeEach(() => {
    vault = new TokenVault(Buffer.from('a'.repeat(32), 'utf8'));  // 32-byte test key
  });

  it('round-trips all credential shapes', () => {
    const shapes = [
      { access_token: 'abc', refresh_token: 'def', expires_at: 1234 },  // OAuth
      { apiKey: 'sk-...' },  // Dev.to
      { webhookUrl: 'https://discord.com/api/webhooks/...' },  // Discord
      { botToken: '123:ABC', channel: '@myproject' },  // Telegram
      { handle: 'alice.bsky.social', appPassword: '...', did: 'did:plc:...' },  // Bluesky
    ];
    for (const shape of shapes) {
      const cipher = vault.encrypt(JSON.stringify(shape));
      const plain = JSON.parse(vault.decrypt(cipher));
      expect(plain).toEqual(shape);
    }
  });

  it('ciphertext is NOT equal to plaintext', () => {
    const plain = JSON.stringify({ apiKey: 'sk-secret-key-1234567890' });
    const cipher = vault.encrypt(plain);
    expect(cipher).not.toContain('sk-secret-key-1234567890');
    expect(cipher).not.toEqual(plain);
  });

  it('tampered ciphertext throws on decrypt', () => {
    const cipher = vault.encrypt(JSON.stringify({ apiKey: 'sk-...' }));
    const tampered = cipher.slice(0, -4) + 'AAAA' + cipher.slice(-4);
    expect(() => vault.decrypt(tampered)).toThrow();
  });

  it('missing key throws at boot', () => {
    expect(() => new TokenVault(Buffer.alloc(0))).toThrow(/key.*32 bytes/i);
  });

  it('wrong-shape key (not 32 bytes) throws', () => {
    expect(() => new TokenVault(Buffer.from('short', 'utf8'))).toThrow(/key.*32 bytes/i);
  });
});
```

### 2.2 Formatters (golden + property + determinism)

#### Golden files (`src/lib/formatters/reddit.test.ts`)

```typescript
import { describe, expect, it } from 'vitest';
import { formatReddit } from './reddit';
import { postCardFixture, profileFixture } from '../../../tests/factories';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('formatReddit', () => {
  it('matches golden file for standard input', () => {
    const input = postCardFixture();
    const profile = profileFixture();
    const output = formatReddit(input, profile, { subreddit: 'sideproject' });

    const golden = JSON.parse(
      readFileSync(join(__dirname, '__fixtures__/reddit-standard.json'), 'utf8')
    );
    expect(output).toEqual(golden);
  });

  it('truncates title to 300 chars', () => {
    const input = postCardFixture({
      title: 'A'.repeat(400),
    });
    const output = formatReddit(input, null, { subreddit: 'test' });
    expect(output.title.length).toBeLessThanOrEqual(300);
  });

  it('uses description verbatim for body', () => {
    const input = postCardFixture({
      description: '# Title\n\nA paragraph.',
    });
    const output = formatReddit(input, null, { subreddit: 'test' });
    expect(output.body).toBe('# Title\n\nA paragraph.');
  });
});
```

#### Property tests (`src/lib/formatters/property.test.ts`)

```typescript
import { describe, expect, it } from 'vitest';
import { fc } from 'fast-check';
import { formatReddit } from './reddit';
import { formatTwitter } from './twitter';
import { formatBluesky } from './bluesky';
// ... all 8 formatters

const postCardArb = fc.record({
  title: fc.string({ maxLength: 120 }),
  summary: fc.string({ maxLength: 200 }),
  description: fc.string({ maxLength: 5000 }),
  techStack: fc.array(fc.string({ maxLength: 24 }), { minLength: 1, maxLength: 10 }),
  repoUrl: fc.option(fc.string({ maxLength: 500 })),
  liveUrl: fc.option(fc.string({ maxLength: 500 })),
});

describe('formatters respect limits for all inputs', () => {
  it('reddit title ≤ 300', () => {
    fc.assert(fc.property(postCardArb, (pc) => {
      const out = formatReddit(pc, null, { subreddit: 'test' });
      return out.title.length <= 300;
    }));
  });

  it('twitter ≤ 280 graphemes', () => {
    fc.assert(fc.property(postCardArb, (pc) => {
      const out = formatTwitter(pc, null);
      return graphemeCount(out.text) <= 280;
    }));
  });

  it('bluesky ≤ 300 graphemes', () => {
    fc.assert(fc.property(postCardArb, (pc) => {
      const out = formatBluesky(pc, null);
      return graphemeCount(out.text) <= 300;
    }));
  });
  // ... etc for all 8 platforms
});
```

#### Determinism test (`src/lib/formatters/determinism.test.ts`)

```typescript
import { describe, expect, it } from 'vitest';
import { formatReddit, formatTwitter, formatBluesky, /* ... */ } from '.';
import { postCardFixture, profileFixture } from '../../tests/factories';

describe('formatters are deterministic', () => {
  const input = postCardFixture();
  const profile = profileFixture();

  it('reddit: 100 calls, identical output', () => {
    const first = JSON.stringify(formatReddit(input, profile, { subreddit: 'test' }));
    for (let i = 0; i < 100; i++) {
      expect(JSON.stringify(formatReddit(input, profile, { subreddit: 'test' }))).toBe(first);
    }
  });
  // ... etc for all 8 platforms
});
```

### 2.3 Services (ownership + retry + quota)

```typescript
// src/server/services/postcards.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import { prisma } from '../db';
import { createPostCard, getPostCard, updatePostCard, deletePostCard } from './postcards';
import { userFixture } from '../../tests/factories';

describe('postcards service', () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "User", "PostCard", "Post", "PostTarget", "Connection", "Profile", "AuditLog" CASCADE');
  });

  it('user B cannot read user A\'s post card', async () => {
    const alice = await userFixture({ email: 'alice@test.dev' });
    const bob = await userFixture({ email: 'bob@test.dev' });
    const aliceCard = await createPostCard(alice.id, {
      title: 'Alice\'s card',
      summary: 'A summary',
      description: 'A description',
      techStack: ['nextjs'],
    });
    expect(aliceCard.ok).toBe(true);

    // Bob tries to read Alice's card by id:
    const bobsAttempt = await getPostCard(bob.id, aliceCard.data.id);
    // Should return NOT_FOUND (404), not the card.
    expect(bobsAttempt.ok).toBe(false);
    if (!bobsAttempt.ok) expect(bobsAttempt.error.code).toBe('NOT_FOUND');
  });
});
```

### 2.4 Adapter unit tests (mocked fetch)

```typescript
// src/lib/platforms/devto/adapter.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { devtoAdapter } from './adapter';

describe('Dev.to adapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('validateCredentials: valid key returns username', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ username: 'alice' }), { status: 200 })
    );
    const result = await devtoAdapter.validateCredentials({ apiKey: 'sk-valid' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.username).toBe('alice');
  });

  it('validateCredentials: invalid key returns INVALID_CREDENTIALS', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
    );
    const result = await devtoAdapter.validateCredentials({ apiKey: 'sk-bad' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.class).toBe('AUTH');
      expect(result.error.message).toContain('Key rejected by Dev.to');
    }
  });

  it('validateCredentials: network error returns NETWORK', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await devtoAdapter.validateCredentials({ apiKey: 'sk-x' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.class).toBe('NETWORK');
  });

  it('publish: success returns url + id', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 12345, url: 'https://dev.to/alice/post-12345' }), { status: 201 })
    );
    const result = await devtoAdapter.publish({
      creds: { apiKey: 'sk-valid' },
      formatted: { platform: 'DEVTO', title: 'Test', body: 'Body', tags: ['test'] },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.platformPostUrl).toBe('https://dev.to/alice/post-12345');
      expect(result.data.platformPostId).toBe('12345');
    }
  });
});
```

---

## 3. Integration tests (Vitest + real Postgres + real Redis)

### 3.1 Setup

- `docker-compose.test.yml` runs separate `postgres-test:5433` and
  `redis-test:6380` containers.
- `vitest.config.ts`:
  ```typescript
  import { defineConfig } from 'vitest/config';
  export default defineConfig({
    test: {
      environment: 'node',
      setupFiles: ['./tests/setup.ts'],
      globals: false,
      pool: 'threads',
      include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    },
  });
  ```
- `tests/setup.ts`:
  ```typescript
  import { execSync } from 'node:child_process';
  beforeAll(async () => {
    execSync('npx prisma migrate deploy', { env: process.env });
  });
  ```

### 3.2 Adapter mocking (the seam)

```typescript
// tests/helpers/mock-adapter.ts
import { vi } from 'vitest';
import type { Adapter, PublishResult } from '@/lib/platforms/types';

export function mockAdapter(platform: Platform, behavior: {
  publish?: PublishResult;
  validateCredentials?: Result<ValidatedCredential, ValidationError>;
}): void {
  const adapter = getAdapter(platform);
  vi.spyOn(adapter, 'publish').mockResolvedValue(behavior.publish ?? { ok: true,
    data: { platformPostUrl: `https://${platform.toLowerCase()}.com/test`,
            platformPostId: 'test-id' } });
  if ('validateCredentials' in adapter) {
    vi.spyOn(adapter, 'validateCredentials').mockResolvedValue(behavior.validateCredentials);
  }
}
```

### 3.3 Publish lifecycle test

```typescript
// tests/integration/publish.test.ts
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { POST } from '@/app/api/postcards/[id]/publish/route';
import { createPostCard } from '@/server/services/postcards';
import { connectReddit } from '@/server/services/connections';
import { prisma } from '@/server/db';
import { mockAdapter } from '../helpers/mock-adapter';
import { userFixture, postCardFixture } from '../factories';

describe('POST /api/postcards/:id/publish', () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "User", "PostCard", "Post", "PostTarget", "Connection", "Profile", "AuditLog", "QuotaUsage" CASCADE');
    mockAdapter('REDDIT', { publish: { ok: true,
      data: { platformPostUrl: 'https://reddit.com/r/test/123',
              platformPostId: 't3_abc' } } });
    mockAdapter('DISCORD', { publish: { ok: true,
      data: { platformPostUrl: 'https://discord.com/channels/...',
              platformPostId: 'msg-1' } } });
  });

  it('creates N targets, all SUCCESS, permalinks stored', async () => {
    const user = await userFixture();
    const card = await createPostCard(user.id, postCardFixture());
    await connectReddit(user.id, { access_token: '...', refresh_token: '...',
      expires_at: 9999, scope: 'identity submit' });
    // (mock connectReddit with mocked Reddit API too — see connections.test.ts)

    const req = new NextRequest('http://localhost/api/postcards/' + card.data.id + '/publish', {
      method: 'POST',
      body: JSON.stringify({
        platforms: [{ platform: 'REDDIT', options: { subreddit: 'test' } },
                    { platform: 'DISCORD' }],
        requestId: crypto.randomUUID(),
      }),
    });
    // (mock session)
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.post.targets).toHaveLength(2);
    // Wait for workers (in-process in test):
    await flushWorkers();

    const post = await prisma.post.findUnique({ where: { id: body.post.id },
      include: { targets: true } });
    for (const t of post.targets) {
      expect(t.status).toBe('SUCCESS');
      expect(t.platformPostUrl).toBeTruthy();
    }
  });

  it('partial failure isolation: one adapter fails, others still SUCCESS', async () => {
    mockAdapter('REDDIT', { publish: { ok: false, error: {
      class: 'AUTH', message: 'Token revoked', retryable: false } } });
    mockAdapter('DISCORD', { publish: { ok: true,
      data: { platformPostUrl: 'https://discord.com/...',
              platformPostId: 'msg-1' } } });

    // ... setup user + card + connections

    const res = await POST(req);
    await flushWorkers();

    const post = await prisma.post.findUnique({ where: { id: ... },
      include: { targets: true } });
    const reddit = post.targets.find(t => t.platform === 'REDDIT');
    const discord = post.targets.find(t => t.platform === 'DISCORD');
    expect(reddit.status).toBe('FAILED');
    expect(reddit.errorClass).toBe('AUTH');
    expect(discord.status).toBe('SUCCESS');
  });

  it('idempotency: same requestId → 409 DUPLICATE_REQUEST', async () => {
    const requestId = crypto.randomUUID();
    // First POST → 201
    const res1 = await POST(makeReq(requestId));
    expect(res1.status).toBe(201);
    // Second POST same requestId → 409
    const res2 = await POST(makeReq(requestId));
    expect(res2.status).toBe(409);
    const body = await res2.json();
    expect(body.error.code).toBe('DUPLICATE_REQUEST');
    expect(body.error.postId).toBe((await res1.json()).post.id);
  });

  it('ownership: user B publishing user A\'s card → 404', async () => {
    const alice = await userFixture({ email: 'alice@test.dev' });
    const bob = await userFixture({ email: 'bob@test.dev' });
    const aliceCard = await createPostCard(alice.id, postCardFixture());

    // Bob tries to publish Alice's card:
    const res = await POST(makeReq(crypto.randomUUID(), session: bob,
      cardId: aliceCard.data.id));
    expect(res.status).toBe(404);
  });

  it('invalid platform (no connection) → 400 with invalidPlatforms', async () => {
    const user = await userFixture();
    const card = await createPostCard(user.id, postCardFixture());
    // No connection set up

    const res = await POST(makeReq(crypto.randomUUID(),
      platforms: [{ platform: 'REDDIT' }]));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_CREDENTIALS');
    expect(body.error.invalidPlatforms).toContain('REDDIT');
  });
});
```

### 3.4 Quota guard test (budget=2)

```typescript
describe('X quota guard (budget=2)', () => {
  beforeEach(async () => {
    process.env.X_MONTHLY_POST_BUDGET = '2';
    mockAdapter('TWITTER', { publish: { ok: true,
      data: { platformPostUrl: 'https://x.com/test/1', platformPostId: '1' } } });
  });

  it('3rd X post → SKIPPED, others SUCCESS', async () => {
    const user = await userFixture();
    const card = await createPostCard(user.id, postCardFixture());
    await connectTwitter(user.id, ...);

    for (let i = 0; i < 3; i++) {
      const res = await POST(makeReq(crypto.randomUUID(),
        platforms: [{ platform: 'TWITTER' }, { platform: 'DISCORD' }]));
      await flushWorkers();
    }

    const posts = await prisma.post.findMany({ include: { targets: true } });
    const xTargets = posts.flatMap(p => p.targets).filter(t => t.platform === 'TWITTER');
    expect(xTargets[0].status).toBe('SUCCESS');
    expect(xTargets[1].status).toBe('SUCCESS');
    expect(xTargets[2].status).toBe('SKIPPED');
    expect(xTargets[2].errorClass).toBe('QUOTA');
  });
});
```

### 3.5 Credential scanner (CI gate)

```typescript
// tests/integration/credential-scanner.test.ts
import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/connections/route';
import { POST as signupPOST } from '@/app/api/auth/signup/route';
// ... import every route

const patterns = [
  /sk-[A-Za-z0-9]{20,}/,
  /xoxb-[A-Za-z0-9-]+/,
  /did:plc:[A-Za-z2-7]{24}/,
  /\d{6,}:[A-Za-z0-9_-]{30,}/,
  /https:\/\/discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
];

describe('credential scanner', () => {
  it('connections list response has no credential patterns', async () => {
    // setup user + connection
    const res = await GET(...);
    const body = JSON.stringify(await res.json());
    for (const p of patterns) expect(body).not.toMatch(p);
  });
  // ... similar for every endpoint that returns data
});
```

### 3.6 Account deletion test

```typescript
describe('account deletion', () => {
  it('zero residual rows across all tables', async () => {
    const user = await userFixture();
    await createPostCard(user.id, postCardFixture());
    await connectReddit(user.id, ...);
    await publish(...);

    await DELETE_account(req, { user });

    const tables = ['User', 'Profile', 'PostCard', 'Connection', 'Post', 'PostTarget'];
    for (const t of tables) {
      const count = await prisma[t].count({ where: { userId: user.id } });
      expect(count).toBe(0);
    }
    // AuditLog rows KEPT (incl ACCOUNT_DELETE) — userId no longer points to a User
    const audit = await prisma.auditLog.findMany({ where: { userId: user.id } });
    expect(audit.some(a => a.action === 'ACCOUNT_DELETE')).toBe(true);
  });
});
```

---

## 4. E2E tests (Playwright)

### 4.1 Setup

- `playwright.config.ts`:
  ```typescript
  import { defineConfig, devices } from '@playwright/test';
  export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    use: { baseURL: 'http://localhost:3000',
           trace: 'retain-on-failure' },
    projects: [
      { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
      { name: 'mobile-safari', use: { ...devices['iPhone 15'] } },
    ],
    webServer: {
      command: 'npm run dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
    },
  });
  ```
- Adapter mock fixture: a global setup that intercepts at the module
  level via `vi.mock` (or by running a separate Next.js build with
  `NEXT_PUBLIC_MOCK_ADAPTERS=1` which the adapter registry respects).

### 4.2 E2E specs

```typescript
// tests/e2e/signup-flow.spec.ts
import { test, expect } from '@playwright/test';

test('signup → profile → create card → dashboard shows it', async ({ page }) => {
  await page.goto('/signup');
  await page.fill('[name=name]', 'Alice Test');
  await page.fill('[name=email]', `alice+${Date.now()}@test.dev`);
  await page.fill('[name=password]', 'secure-pass-123');
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/dashboard/);

  // Onboarding strip
  await page.click('text=Create profile');
  await page.fill('[name=headline]', 'Final-year CS');
  await page.click('button:has-text("Save")');

  // Create a post card
  await page.click('text=New Post Card');
  await page.fill('[name=title]', 'My Test Project');
  await page.fill('[name=summary]', 'A short summary');
  await page.fill('[name=description]', '# Hello\n\nWorld.');
  await page.fill('[name=techStack-input]', 'nextjs');
  await page.keyboard.press('Enter');
  await page.click('button:has-text("Save")');

  // Dashboard shows it
  await expect(page.locator('text=My Test Project')).toBeVisible();
});
```

```typescript
// tests/e2e/publish-flow.spec.ts
import { test, expect } from '@playwright/test';

test('publish to 2 mocked platforms → both SUCCESS → history shows permalinks', async ({ page, context }) => {
  // (Seed user + connections via API or DB helper)
  await page.goto('/dashboard/postcards/<seed-card-id>/publish');
  await page.check('[name=platform][value=REDDIT]');
  await page.check('[name=platform][value=DISCORD]');
  await page.fill('[name=subreddit]', 'sideproject');
  await page.click('button:has-text("Amplify")');

  // Status board appears
  await expect(page.locator('text=QUEUED')).toBeVisible();

  // Polls until terminal
  await expect(page.locator('[data-status=SUCCESS]')).toHaveCount(2, { timeout: 30000 });

  // History page
  await page.goto('/dashboard/history');
  await expect(page.locator('a:has-text("View post")')).toHaveCount(2);
});
```

```typescript
// tests/e2e/retry-flow.spec.ts
test('forced failure → FAILED chip → Retry → SUCCESS; success target NOT re-called', async ({ page }) => {
  // (Mock adapter: REDDIT fails first, succeeds second; DISCORD always succeeds)
  await page.goto('/dashboard/postcards/<seed-card-id>/publish');
  await page.check('[name=platform][value=REDDIT]');
  await page.check('[name=platform][value=DISCORD]');
  await page.click('button:has-text("Amplify")');

  await expect(page.locator('[data-status=FAILED]:has-text("Reddit")')).toBeVisible();
  await expect(page.locator('[data-status=SUCCESS]:has-text("Discord")')).toBeVisible();

  await page.click('button:has-text("Retry")');
  await expect(page.locator('[data-status=SUCCESS]:has-text("Reddit")')).toBeVisible();
  // Assert adapter call counts: REDDIT called 2x, DISCORD called 1x.
});
```

```typescript
// tests/e2e/account-deletion.spec.ts
test('delete account → typed confirm → redirect to landing', async ({ page }) => {
  await page.goto('/dashboard/settings');
  await page.click('text=Danger Zone');
  await page.click('button:has-text("Delete account")');
  await page.fill('[name=confirm]', 'DELETE');
  await page.click('button:has-text("Confirm delete")');
  await expect(page).toHaveURL('/');
});
```

---

## 5. CI (GitHub Actions)

```yaml
# .github/workflows/ci.yml
name: CI
on: [pull_request, push]
jobs:
  lint-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck

  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run test

  integration:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_USER: test, POSTGRES_PASSWORD: test,
               POSTGRES_DB: netamplify_test }
        ports: ['5432:5432']
      redis:
        image: redis:7
        ports: ['6379:6379']
    env:
      DATABASE_URL: postgresql://test:test@localhost:5432/netamplify_test
      REDIS_URL: redis://localhost:6379
      TOKEN_ENCRYPTION_KEY: ${{ secrets.TOKEN_ENCRYPTION_KEY }}
      NEXTAUTH_SECRET: ${{ secrets.NEXTAUTH_SECRET }}
      NEXTAUTH_URL: http://localhost:3000
      PUBLIC_APP_URL: http://localhost:3000
      # ... etc
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npx prisma migrate deploy
      - run: npm run test -- --include tests/integration
      - run: bash scripts/scan-db-dump.sh   # DB grep for token patterns

  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run build

  e2e:
    runs-on: ubuntu-latest
    needs: [lint-typecheck, unit, integration, build]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: docker compose -f docker-compose.test.yml up -d
      - run: npx prisma migrate deploy
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-traces, path: test-results/ }
```

### CI rules

- A red pipeline = the ticket is NOT done.
- E2E runs ONLY if all previous jobs green.
- DB dump grep test runs after integration; fails on any token pattern
  match.
- Lighthouse CI (stretch): runs in a separate job on `build`; target
  ≥90.

---

## 6. Factories (`tests/factories.ts`)

Deterministic data factories for tests. No `Math.random` — use
`nanoid` with a fixed seed or `incrementingCounter`:

```typescript
import { prisma } from '@/server/db';
import type { PostCardCreate } from '@/lib/validation/schemas';

let counter = 0;
function uniqueId(prefix = 'id') { return `${prefix}-${counter++}`; }
function uniqueEmail() { return `test-${counter++}@example.com`; }

export async function userFixture(overrides: Partial<{email: string; name: string}> = {}) {
  return prisma.user.create({
    data: {
      email: overrides.email ?? uniqueEmail(),
      passwordHash: '$2a$10$...test-hash...',
      name: overrides.name ?? 'Test User',
    },
  });
}

export async function profileFixture(userId: string, overrides = {}) {
  return prisma.profile.create({
    data: { userId, headline: 'Test headline', college: 'Test College',
      graduationYear: 2026, ...overrides },
  });
}

export function postCardFixture(overrides: Partial<PostCardCreate> = {}): PostCardCreate {
  return {
    title: 'Test Project',
    summary: 'A test summary.',
    description: '# Test\n\nDescription.',
    techStack: ['nextjs', 'typescript'],
    repoUrl: 'https://github.com/test/project',
    liveUrl: null,
    ...overrides,
  };
}

// ... etc for Connection, Post, PostTarget
```

---

## 7. Polling helpers (no flaky sleeps)

Never use `setTimeout(1000)` to wait for an async result. Use polling:

```typescript
// tests/helpers/poll.ts
export async function pollUntil<T>(
  fn: () => Promise<T>,
  predicate: (t: T) => boolean,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<T> {
  const { intervalMs = 50, timeoutMs = 5000 } = opts;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await fn();
    if (predicate(t)) return t;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`pollUntil timed out after ${timeoutMs}ms`);
}
```

Use:
```typescript
await pollUntil(
  () => prisma.post.findUnique({ where: { id }, include: { targets: true } }),
  (p) => p.targets.every(t => ['SUCCESS','FAILED','SKIPPED'].includes(t.status)),
  { timeoutMs: 30000 }
);
```

---

## 8. Manual smoke (`scripts/smoke.ts`)

The ONLY place real platform calls happen. Run manually before demo.

```typescript
// scripts/smoke.ts
import { tokenVault } from '@/lib/vault/token-vault';
import { redditAdapter, discordAdapter } from '@/lib/platforms/registry';
import { formatReddit, formatDiscord } from '@/lib/formatters';
import { prisma } from '@/server/db';

async function main() {
  const user = await prisma.user.findUnique({ where: { email: 'demo@netamplify.dev' } });
  if (!user) throw new Error('Run npm run db:seed first');

  const redditConn = await prisma.connection.findFirst({
    where: { userId: user.id, platform: 'REDDIT' }});
  const discordConn = await prisma.connection.findFirst({
    where: { userId: user.id, platform: 'DISCORD' }});

  if (!redditConn || !discordConn) throw new Error('Connect Reddit + Discord first');

  const card = await prisma.postCard.findFirst({ where: { userId: user.id }});
  if (!card) throw new Error('Create a post card first');

  // Real Reddit post
  const redditCreds = tokenVault.decrypt(redditConn.credentialsCipher);
  const redditOut = formatReddit(card, null, { subreddit: 'yourtestsub' });
  const redditResult = await redditAdapter.publish({
    creds: redditCreds, formatted: redditOut,
    options: { subreddit: 'yourtestsub' }});
  if (!redditResult.ok) throw new Error('Reddit failed: ' + redditResult.error.message);
  console.log('Reddit:', redditResult.data.platformPostUrl);

  // Real Discord post
  const discordCreds = tokenVault.decrypt(discordConn.credentialsCipher);
  const discordOut = formatDiscord(card, null);
  const discordResult = await discordAdapter.publish({
    creds: discordCreds, formatted: discordOut });
  if (!discordResult.ok) throw new Error('Discord failed: ' + discordResult.error.message);
  console.log('Discord:', discordResult.data.platformPostUrl);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
```

Run: `npm run smoke` (after `npm run db:seed` and connecting your own
Reddit + Discord).

Evidence: paste URLs + screenshot into `docs/13-PROGRESS.md` Smoke
Evidence section.

---

## 9. Test data setup (global)

- `tests/setup.ts`: runs `prisma migrate deploy` once before all tests.
- Per-test-file `beforeEach`: TRUNCATE all tables (fast, no migration
  needed).
- E2E: separate test DB (`netamplify_e2e`) reset between test files.
- No shared state across tests.

---

## 10. Test anti-patterns (forbidden)

- `setTimeout` to wait for async — use `pollUntil`.
- Real `fetch` calls to platform APIs — mock the adapter.
- `Math.random` in factories — use `counter++` or `nanoid` with seed.
- Reading `process.env` directly in tests — use the typed `env` module.
- Testing implementation details (e.g., "should call `prisma.postCard.create`
  with exactly `{ title: 'X' }`") — test outcomes (e.g., "response is
  201 with the created card").
- Skipping a test with `it.skip` and merging — fix the test, don't
  skip.

---

> End of testing strategy. Next: `10-ROADMAP.md` — the 4-week plan
> with weekly gates and risks.
