import { Redis } from 'ioredis';

// NetAmplify — Redis connection.
//
// Tests can set REDIS_URL to undefined (or fake value) and the mock will be
// used. In production (with REDIS_URL set), real ioredis connects.
//
// The mock is now comprehensive enough to support:
//   - ThrottlerModule (incr, expire, get, del)
//   - BullMQ (no-op; the queue is overridden in tests via getQueueToken)
//   - HealthController.ping()

class MockRedis {
  private data: Map<string, string> = new Map();
  private expirations: Map<string, number> = new Map();
  private listeners: Record<string, Function[]> = {};

  async get(key: string): Promise<string | null> {
    if (this.expired(key)) return null;
    return this.data.get(key) ?? null;
  }

  async set(key: string, value: string, _ttl?: number | string): Promise<'OK'> {
    this.data.set(key, value);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    const existed = this.data.has(key);
    this.data.delete(key);
    return existed ? 1 : 0;
  }

  async incr(key: string): Promise<number> {
    const v = Number(this.data.get(key) ?? '0') + 1;
    this.data.set(key, String(v));
    return v;
  }

  async incrby(key: string, amount: number): Promise<number> {
    const v = Number(this.data.get(key) ?? '0') + amount;
    this.data.set(key, String(v));
    return v;
  }

  async decr(key: string): Promise<number> {
    const v = Number(this.data.get(key) ?? '0') - 1;
    this.data.set(key, String(v));
    return v;
  }

  async expire(key: string, ttlSeconds: number): Promise<number> {
    this.expirations.set(key, Date.now() + ttlSeconds * 1000);
    return 1;
  }

  async pexpire(key: string, ttlMs: number): Promise<number> {
    this.expirations.set(key, Date.now() + ttlMs);
    return 1;
  }

  async exists(key: string): Promise<number> {
    return this.data.has(key) && !this.expired(key) ? 1 : 0;
  }

  async ping(): Promise<'PONG'> {
    return 'PONG';
  }

  async flushdb(): Promise<'OK'> {
    this.data.clear();
    this.expirations.clear();
    return 'OK';
  }

  async disconnect(): Promise<void> {
    return;
  }

  async quit(): Promise<void> {
    return;
  }

  on(event: string, listener: Function): this {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(listener);
    return this;
  }

  off(event: string, listener: Function): this {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter((l) => l !== listener);
    }
    return this;
  }

  once(event: string, listener: Function): this {
    return this.on(event, listener);
  }

  emit(event: string, ...args: unknown[]): boolean {
    const ls = this.listeners[event] ?? [];
    for (const l of ls) l(...args);
    return ls.length > 0;
  }

  private expired(key: string): boolean {
    const exp = this.expirations.get(key);
    if (exp !== undefined && exp < Date.now()) {
      this.data.delete(key);
      this.expirations.delete(key);
      return true;
    }
    return false;
  }

  // BullMQ expects a few extra methods
  hgetall = async (_key: string): Promise<Record<string, string>> => ({});
  hset = async (_key: string, _field: string, _value: string): Promise<number> => 1;
  hget = async (_key: string, _field: string): Promise<string | null> => null;
  hdel = async (_key: string, _field: string): Promise<number> => 1;
  hincrby = async (_key: string, _field: string, _incr: number): Promise<number> => 0;
  sadd = async (_key: string, _member: string): Promise<number> => 1;
  srem = async (_key: string, _member: string): Promise<number> => 1;
  smembers = async (_key: string): Promise<string[]> => [];
  zadd = async (_key: string, _score: number, _member: string): Promise<number> => 1;
  zrange = async (_key: string, _start: number, _stop: number): Promise<string[]> => [];
  zrem = async (_key: string, _member: string): Promise<number> => 1;
  lpush = async (_key: string, _value: string): Promise<number> => 1;
  rpush = async (_key: string, _value: string): Promise<number> => 1;
  lpop = async (_key: string): Promise<string | null> => null;
  rpop = async (_key: string): Promise<string | null> => null;
  lrange = async (_key: string, _start: number, _stop: number): Promise<string[]> => [];
  llen = async (_key: string): Promise<number> => 0;
  keys = async (_pattern: string): Promise<string[]> => [];
  scan = async (): Promise<[number, string[]]> => [0, []];
  multi = (): unknown => ({
    exec: async (): Promise<unknown[]> => [],
    pipeline: () => ({ exec: async (): Promise<unknown[]> => [] }),
  });
  pipeline = (): unknown => ({
    exec: async (): Promise<unknown[]> => [],
  });
  duplicate = (): MockRedis => new MockRedis();
}

// Use real Redis only when REDIS_URL is a valid redis:// URL.
// The test harness sets REDIS_URL to 'redis://fake' which we don't want to
// actually connect — so we check if we're in a test env first.
const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true' || process.env.DISABLE_WORKERS === 'true';
const isRealRedis = process.env.REDIS_URL && process.env.REDIS_URL.startsWith('redis://') && !isTest;

export const ioRedis: Redis = isRealRedis
  ? new Redis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: null,
      connectTimeout: 10_000,
    })
  : (new MockRedis() as unknown as Redis);
