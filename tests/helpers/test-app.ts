// /home/z/my-project/netamplify-app/tests/helpers/test-app.ts
// NetAmplify — Integration test harness.
//
// Boots a real NestJS app with:
//   - Mocked PrismaService (in-memory data store)
//   - Mocked Redis (in-memory)
//   - Mocked BullMQ Queue (captures jobs; optionally runs them synchronously)
//   - Real AuthService, Format Engine, TokenVault (with test key)
//   - Mocked adapters (when set, simulate platform responses)
//
// Test files import `createTestApp()` to get a supertest-ready app + helpers.
// This simulates curl tests by making REAL HTTP requests against the running
// NestJS app — the only difference is no network/Docker dependency.

import { Test, type TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as supertest from 'supertest';
import * as bcrypt from 'bcrypt';
import { randomBytes, createHash } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { getQueueToken } from '@nestjs/bullmq';

import { AppModule } from '../../apps/backend/src/app.module';
import { PrismaService } from '../../libraries/nestjs-libraries/src/database/prisma/prisma.service';
import { TokenVault } from '../../libraries/nestjs-libraries/src/services/vault/token-vault';
import { GlobalExceptionFilter } from '../../apps/backend/src/services/error.filter';
import { AdapterRegistry } from '../../libraries/nestjs-libraries/src/platforms/registry';
import type { PlatformAdapter, AdapterCredentials, FormattedPost, PublishResult } from '../../libraries/nestjs-libraries/src/platforms/adapter.interface';
import { PublishError } from '../../libraries/nestjs-libraries/src/platforms/adapter.interface';
import type { Platform, Prisma } from '@prisma/client';

// ============================================================================
// Test environment — defaults are set in vitest.setup.ts (runs BEFORE this
// file imports its modules). We use ?? here for per-test overrides.
// ============================================================================
// Do NOT set REDIS_URL here — MockRedis is used when REDIS_URL is undefined.

// ============================================================================
// Mock Prisma — in-memory data store with the shape our app uses
// ============================================================================
export interface MockPrisma extends PrismaService {
  user: {
    findUnique: (args: { where: { id?: string; email?: string } }) => Promise<unknown>;
    findFirst: (args: { where: Record<string, unknown> }) => Promise<unknown>;
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
    delete: (args: { where: { id: string } }) => Promise<unknown>;
  };
  postCard: {
    findMany: (args: { where: { userId: string }; orderBy: unknown; skip: number; take: number }) => Promise<unknown[]>;
    findFirst: (args: { where: { id: string; userId: string } }) => Promise<unknown | null>;
    count: (args: { where: { userId: string } }) => Promise<number>;
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
    delete: (args: { where: { id: string } }) => Promise<unknown>;
  };
  connection: {
    findMany: (args: { where: { userId: string }; select: Record<string, boolean> }) => Promise<unknown[]>;
    findUnique: (args: { where: { userId_platform: { userId: string; platform: string } } }) => Promise<unknown | null>;
    upsert: (args: { where: unknown; create: Record<string, unknown>; update: Record<string, unknown> }) => Promise<unknown>;
    update: (args: { where: { userId_platform: { userId: string; platform: string } }; data: Record<string, unknown> }) => Promise<unknown>;
    deleteMany: (args: { where: { userId: string; platform: string } }) => Promise<{ count: number }>;
  };
  post: {
    findUnique: (args: { where: { requestId: string } }) => Promise<unknown | null>;
    findFirst: (args: { where: { id: string; userId: string }; include: unknown }) => Promise<unknown | null>;
    findMany: (args: { where: unknown; include: unknown; orderBy: unknown; skip: number; take: number }) => Promise<unknown[]>;
    count: (args: { where: unknown }) => Promise<number>;
    create: (args: unknown) => Promise<unknown>;
  };
  postTarget: {
    findFirst: (args: { where: { id: string; postId: string } }) => Promise<unknown | null>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
  quotaUsage: {
    findUnique: (args: { where: { platform_yearMonth: { platform: string; yearMonth: string } } }) => Promise<unknown | null>;
    upsert: (args: { where: unknown; create: Record<string, unknown>; update: Record<string, unknown> }) => Promise<unknown>;
  };
  auditLog: {
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  };
  $transaction: (fn: (tx: MockPrisma) => Promise<unknown>) => Promise<unknown>;
  $queryRaw: (sql: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
}

export function createMockPrisma(): MockPrisma {
  const users = new Map<string, Record<string, unknown>>();
  const usersByEmail = new Map<string, string>();
  const postcards = new Map<string, Record<string, unknown>>();
  const connections = new Map<string, Record<string, unknown>>(); // key: userId|platform
  const posts = new Map<string, Record<string, unknown>>();
  const postTargets = new Map<string, Record<string, unknown>>();
  const quota = new Map<string, number>();
  const auditLogs: Record<string, unknown>[] = [];
  let nextId = 1;
  const cuid = () => `id-${nextId++}`;

  function recordCreate(data: Record<string, unknown>, model: 'user' | 'postCard' | 'connection' | 'post' | 'postTarget'): Record<string, unknown> {
    const id = data.id as string ?? cuid();
    return { id, createdAt: new Date(), updatedAt: new Date(), ...data };
  }

  const prisma: MockPrisma = {
    user: {
      async findUnique({ where }) {
        if (where.id) return users.get(where.id) ?? null;
        if (where.email) {
          const id = usersByEmail.get(where.email);
          return id ? users.get(id) ?? null : null;
        }
        return null;
      },
      async findFirst({ where }) {
        if (where.id && where.userId) {
          const u = users.get(where.id);
          return u && u.id === where.userId ? u : null;
        }
        return null;
      },
      async create({ data }) {
        const user = recordCreate(data, 'user');
        users.set(user.id as string, user);
        usersByEmail.set(user.email as string, user.id as string);
        return user;
      },
      async update({ where, data }) {
        const user = users.get(where.id);
        if (!user) throw new Error('User not found');
        Object.assign(user, data, { updatedAt: new Date() });
        return user;
      },
      async delete({ where }) {
        const user = users.get(where.id);
        if (!user) throw new Error('User not found');
        users.delete(where.id);
        usersByEmail.delete(user.email as string);
        // Cascade: delete all user's PostCards + Connections + Posts + AuditLogs
        for (const [id, c] of Array.from(postcards.entries())) {
          if (c.userId === where.id) postcards.delete(id);
        }
        for (const [key, c] of Array.from(connections.entries())) {
          if (key.startsWith(`${where.id}|`)) connections.delete(key);
        }
        return user;
      },
    },
    postCard: {
      async findMany({ where, orderBy, skip, take }) {
        const items = Array.from(postcards.values()).filter((c) => c.userId === where.userId);
        // We don't sort in mock; return as-is
        return items.slice(skip, skip + take);
      },
      async findFirst({ where }) {
        const c = postcards.get(where.id);
        if (!c || c.userId !== where.userId) return null;
        return c;
      },
      async count({ where }) {
        return Array.from(postcards.values()).filter((c) => c.userId === where.userId).length;
      },
      async create({ data }) {
        const card = recordCreate(data, 'postCard');
        postcards.set(card.id as string, card);
        return card;
      },
      async update({ where, data }) {
        const card = postcards.get(where.id);
        if (!card) throw new Error('PostCard not found');
        Object.assign(card, data, { updatedAt: new Date() });
        return card;
      },
      async delete({ where }) {
        const card = postcards.get(where.id);
        if (!card) throw new Error('PostCard not found');
        postcards.delete(where.id);
        // Cascade: delete Posts with this postCardId
        for (const [id, p] of Array.from(posts.entries())) {
          if (p.postCardId === where.id) {
            for (const [tid, t] of Array.from(postTargets.entries())) {
              if (t.postId === id) postTargets.delete(tid);
            }
            posts.delete(id);
          }
        }
        return card;
      },
    },
    connection: {
      async findMany({ where, select }) {
        const items = Array.from(connections.values()).filter((c) => c.userId === where.userId);
        // Project: only return selected fields (skip credentialsCipher when not in select)
        return items.map((c) => {
          if (select && !select.credentialsCipher) {
            const { credentialsCipher, ...rest } = c;
            return { ...rest, credentialsCipher: undefined };
          }
          return c;
        });
      },
      async findUnique({ where }) {
        const key = `${where.userId_platform.userId}|${where.userId_platform.platform}`;
        return connections.get(key) ?? null;
      },
      async upsert({ where: _where, create, update }) {
        const w = _where as { userId_platform: { userId: string; platform: string } };
        const key = `${w.userId_platform.userId}|${w.userId_platform.platform}`;
        const existing = connections.get(key);
        if (existing) {
          Object.assign(existing, update, { updatedAt: new Date() });
          return existing;
        }
        // Ensure status defaults to ACTIVE (matches Prisma schema's @default(ACTIVE))
        const createWithDefaults = { status: 'ACTIVE', lastValidatedAt: new Date(), ...create };
        const conn = recordCreate(createWithDefaults, 'connection');
        connections.set(key, conn);
        return conn;
      },
      async update({ where, data }) {
        const key = `${where.userId_platform.userId}|${where.userId_platform.platform}`;
        const conn = connections.get(key);
        if (!conn) throw new Error('Connection not found');
        Object.assign(conn, data, { updatedAt: new Date() });
        return conn;
      },
      async deleteMany({ where }) {
        const key = `${where.userId}|${where.platform}`;
        const existed = connections.has(key);
        connections.delete(key);
        return { count: existed ? 1 : 0 };
      },
    },
    post: {
      async findUnique({ where }) {
        for (const p of Array.from(posts.values())) {
          if (p.requestId === where.requestId) return p;
        }
        return null;
      },
      async findFirst({ where, include: _include }) {
        const p = posts.get(where.id);
        if (!p || p.userId !== where.userId) return null;
        // include targets
        const targets = Array.from(postTargets.values()).filter((t) => t.postId === p.id);
        return { ...p, targets };
      },
      async findMany({ where, include: _include, orderBy: _o, skip, take }) {
        let items = Array.from(posts.values()).filter((p) => p.userId === where.userId);
        // optional platform/status filter via targets
        const targetsFilter = where.targets as { some?: { platform?: string; status?: string } } | undefined;
        if (targetsFilter?.some) {
          items = items.filter((p) => {
            const postTargetsList = Array.from(postTargets.values()).filter((t) => t.postId === p.id);
            if (targetsFilter.some!.platform && targetsFilter.some!.status) {
              return postTargetsList.some((t) => t.platform === targetsFilter.some!.platform && t.status === targetsFilter.some!.status);
            }
            if (targetsFilter.some!.platform) {
              return postTargetsList.some((t) => t.platform === targetsFilter.some!.platform);
            }
            if (targetsFilter.some!.status) {
              return postTargetsList.some((t) => t.status === targetsFilter.some!.status);
            }
            return true;
          });
        }
        // include targets
        items = items.map((p) => ({ ...p, targets: Array.from(postTargets.values()).filter((t) => t.postId === p.id) }));
        return items.slice(skip, skip + take);
      },
      async count({ where }) {
        return Array.from(posts.values()).filter((p) => p.userId === where.userId).length;
      },
      async create(args: unknown) {
        const data = (args as { data: Record<string, unknown> }).data;
        const post = recordCreate(data, 'post');
        // Create targets inline if specified
        const targetsData = (data.targets as { create: Array<Record<string, unknown>> } | undefined)?.create;
        const createdTargets: Record<string, unknown>[] = [];
        if (targetsData) {
          for (const t of targetsData) {
            const targetId = cuid();
            const target = { id: targetId, postId: post.id, attempts: 0, status: 'QUEUED', ...t, updatedAt: new Date() };
            postTargets.set(targetId, target);
            createdTargets.push(target);
          }
        }
        posts.set(post.id as string, post);
        return { ...post, targets: createdTargets };
      },
    },
    postTarget: {
      async findFirst({ where }) {
        const t = postTargets.get(where.id);
        if (!t || t.postId !== where.postId) return null;
        return t;
      },
      async update({ where, data }) {
        const t = postTargets.get(where.id);
        if (!t) throw new Error('PostTarget not found');
        // Handle Prisma's increment syntax: { attempts: { increment: 1 } }
        for (const [key, value] of Object.entries(data)) {
          if (value && typeof value === 'object' && 'increment' in (value as Record<string, unknown>)) {
            const inc = (value as { increment: number }).increment;
            (t as Record<string, unknown>)[key] = ((t as Record<string, unknown>)[key] as number ?? 0) + inc;
          } else {
            Object.assign(t, { [key]: value });
          }
        }
        Object.assign(t, { updatedAt: new Date() });
        return t;
      },
    },
    quotaUsage: {
      async findUnique({ where }) {
        const key = `${where.platform_yearMonth.platform}_${where.platform_yearMonth.yearMonth}`;
        const used = quota.get(key);
        if (used === undefined) return null;
        return {
          platform: where.platform_yearMonth.platform,
          yearMonth: where.platform_yearMonth.yearMonth,
          used,
        };
      },
      async upsert({ where: _where, create, update }) {
        const w = _where as { platform_yearMonth: { platform: string; yearMonth: string } };
        const key = `${w.platform_yearMonth.platform}_${w.platform_yearMonth.yearMonth}`;
        const current = quota.get(key);
        if (current === undefined) {
          quota.set(key, create.used as number);
          return { ...create, used: create.used };
        }
        const newUsed = current + ((update.used as { increment: number }).increment ?? 1);
        quota.set(key, newUsed);
        return { ...create, used: newUsed };
      },
    },
    auditLog: {
      async create({ data }) {
        const entry = { id: cuid(), createdAt: new Date(), ...data };
        auditLogs.push(entry);
        return entry;
      },
    },
    async $transaction(fn) {
      // Run fn synchronously with the same prisma instance
      return await fn(prisma);
    },
    async $queryRaw() {
      // HealthController calls this — return 1 to simulate "SELECT 1"
      return [{ '?column?': 1 }];
    },
    // Test helpers (not part of real Prisma API)
    _auditLogs: auditLogs,
    _reset() {
      users.clear();
      usersByEmail.clear();
      postcards.clear();
      connections.clear();
      posts.clear();
      postTargets.clear();
      quota.clear();
      auditLogs.length = 0;
      nextId = 1;
    },
  } as unknown as MockPrisma;
  return prisma;
}

// ============================================================================
// Mock BullMQ Queue — captures added jobs; doesn't enqueue
// ============================================================================
export interface MockPublishQueue {
  add: (name: string, data: Record<string, unknown>, options?: Record<string, unknown>) => Promise<{ id: string }>;
  _jobs: Array<{ name: string; data: Record<string, unknown>; options?: Record<string, unknown> }>;
  _reset: () => void;
}

export function createMockQueue(): MockPublishQueue {
  const jobs: MockPublishQueue['_jobs'] = [];
  return {
    async add(name, data, options) {
      const id = (data.postTargetId as string) || `job-${jobs.length + 1}`;
      jobs.push({ name, data, options });
      return { id };
    },
    _jobs: jobs,
    _reset() {
      jobs.length = 0;
    },
  };
}

// ============================================================================
// Mock adapter — simulate platform responses for integration tests
// ============================================================================
export interface MockAdapterConfig {
  /** The platform this mock replaces */
  platform: Platform;
  /** What publish() returns on success */
  publishResult?: PublishResult;
  /** What publish() throws (overrides publishResult) */
  publishError?: PublishError;
  /** What validateCredentials() returns */
  validateResult?: { identity: { id: string; username: string }; credentials: AdapterCredentials };
  /** What validateCredentials() throws */
  validateError?: PublishError;
  /** What getIdentity() returns */
  identityResult?: { id: string; username: string };
  /** What exchangeCode() returns */
  exchangeResult?: { accessToken: string; refreshToken?: string; expiresAt?: number; scopes?: string[] };
}

export function createMockAdapter(cfg: MockAdapterConfig): PlatformAdapter {
  return {
    platform: cfg.platform,
    name: cfg.platform === 'TWITTER' ? 'X (Twitter)' : cfg.platform.charAt(0) + cfg.platform.slice(1).toLowerCase(),
    toolTip: 'mock',
    kind: cfg.exchangeResult ? 'OAUTH' : 'SIMPLE',
    configured: () => true,
    async validateCredentials(_input) {
      if (cfg.validateError) throw cfg.validateError;
      return cfg.validateResult ?? { identity: { id: 'mock-id', username: 'mock-user' }, credentials: { mock: 'creds' } };
    },
    async getIdentity(_tokens) {
      return cfg.identityResult ?? { id: 'mock-id', username: 'mock-user' };
    },
    async exchangeCode(_code, _pkce, _redirectUri) {
      return cfg.exchangeResult ?? { accessToken: 'mock-access', refreshToken: 'mock-refresh', expiresAt: Date.now() / 1000 + 3600, scopes: [] };
    },
    getAuthUrl() {
      return 'https://example.com/oauth';
    },
    async publish(_creds, _formatted: FormattedPost) {
      if (cfg.publishError) throw cfg.publishError;
      return cfg.publishResult ?? { id: 'mock-post-id', url: 'https://example.com/post/mock-post-id' };
    },
  };
}

// ============================================================================
// Mock Redis — required for ThrottlerModule
// ============================================================================
function createMockRedis() {
  const store = new Map<string, number>();
  return {
    ping: async () => 'PONG' as string,
    get: async (key: string) => (store.has(key) ? String(store.get(key)) : null) as string | null,
    set: async (key: string, value: string) => { store.set(key, Number(value)); return 'OK'; },
    incr: async (key: string) => {
      const v = (store.get(key) ?? 0) + 1;
      store.set(key, v);
      return v;
    },
    expire: async (_key: string, _ttl: number) => 1,
    del: async (key: string) => { store.delete(key); return 1; },
    incrby: async (key: string, amount: number) => {
      const v = (store.get(key) ?? 0) + amount;
      store.set(key, v);
      return v;
    },
    // BullMQ expects these on the connection object
    disconnect: () => {},
    on: () => {},
    off: () => {},
  };
}

// ============================================================================
// Test app builder — returns everything a test needs
// ============================================================================
export interface TestApp {
  app: INestApplication;
  request: supertest.SuperTest<supertest.Test>;
  prisma: MockPrisma;
  queue: MockPublishQueue;
  jwt: JwtService;
  vault: TokenVault;
  // Helpers
  signupAndLogin(email?: string, password?: string, name?: string): Promise<{ userId: string; accessToken: string }>;
  createPostCard(token: string, card: Partial<{ title: string; summary: string; description: string; techStack: string[]; repoUrl: string; liveUrl: string }>): Promise<{ id: string }>;
  connectPlatform(token: string, platform: Platform, input?: Record<string, string>): Promise<supertest.Response>;
  publish(token: string, postCardId: string, platforms: Array<{ platform: string; options?: Record<string, unknown> }>, requestId?: string): Promise<supertest.Response>;
  close(): Promise<void>;
}

export async function createTestApp(opts: { mockAdapters?: MockAdapterConfig[] } = {}): Promise<TestApp> {
  const prisma = createMockPrisma();
  const queue = createMockQueue();
  const jwt = new JwtService({
    secret: process.env.JWT_SECRET!,
    signOptions: { expiresIn: 7 * 24 * 60 * 60, algorithm: 'HS256' },
  });
  const vault = new TokenVault();
  const mockRedis = createMockRedis();

  // Override the PrismaService with our mock
  // The UserRepository, PostCardRepository, etc. all extend PrismaRepository<T>
  // which calls `this._prisma.<model>.<method>`. So our mock prisma must
  // expose `user`, `postCard`, etc. methods directly on the same object.
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .overrideProvider(TokenVault)
    .useValue(vault)
    .overrideProvider(getQueueToken('publish'))
    .useValue(queue)
    .compile();

  // If mock adapters are configured, override AdapterRegistry
  if (opts.mockAdapters && opts.mockAdapters.length > 0) {
    const realRegistry = moduleRef.get(AdapterRegistry);
    for (const cfg of opts.mockAdapters) {
      const mock = createMockAdapter(cfg);
      // Replace the adapter for this platform in the registry's internal map
      (realRegistry as unknown as { adapters: Map<Platform, PlatformAdapter> }).adapters.set(cfg.platform, mock);
    }
  }

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();

  const request = supertest.default(app.getHttpServer());

  // Helpers
  const testApp: TestApp = {
    app,
    request,
    prisma,
    queue,
    jwt,
    vault,
    async signupAndLogin(email, password, name) {
      const e = email ?? `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
      const p = password ?? 'StrongPass1';
      const n = name ?? 'Test User';
      const resp = await request.post('/api/auth/signup').send({ email: e, password: p, name: n });
      return {
        userId: resp.body.user.id,
        accessToken: resp.body.accessToken,
      };
    },
    async createPostCard(token, card) {
      const body = {
        title: card.title ?? 'Test Project',
        summary: card.summary ?? 'A summary',
        description: card.description ?? 'Description body',
        techStack: card.techStack ?? ['TypeScript'],
        repoUrl: card.repoUrl,
        liveUrl: card.liveUrl,
      };
      const resp = await request.post('/api/postcards').set('Authorization', `Bearer ${token}`).send(body);
      return { id: resp.body.id };
    },
    async connectPlatform(token, platform, input) {
      const endpoint = `/api/connections/${platform.toLowerCase()}`;
      const body = input ?? { webhookUrl: 'https://discord.com/api/webhooks/123/abc', apiKey: 'test-api-key', pat: 'test-pat', botToken: '7812345678:AAH1234567890abcdefghijklmnopqrstuv', channel: '@testchannel', handle: 'jane.bsky.social', appPassword: 'abcd-efgh-ijkl-mnop' };
      return request.post(endpoint).set('Authorization', `Bearer ${token}`).send(body);
    },
    async publish(token, postCardId, platforms, requestId) {
      return request.post(`/api/postcards/${postCardId}/publish`)
        .set('Authorization', `Bearer ${token}`)
        .send({ platforms, ...(requestId ? { requestId } : {}) });
    },
    async close() {
      await app.close();
    },
  };

  return testApp;
}
