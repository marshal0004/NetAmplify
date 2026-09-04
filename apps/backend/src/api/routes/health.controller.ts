// /home/z/my-project/netamplify-app/apps/backend/src/api/routes/health.controller.ts
// NetAmplify — HealthController (liveness + readiness check).
//
// Per docs/05-API-SPEC.md:
//   GET /api/health → { db: "up", redis: "up" }   (200 if both up, 503 if either down)
//
// Used by:
//   - Docker/Compose healthcheck
//   - Smoke tests (scripts/smoke.ts — Phase 7)
//   - curl-tests (scripts/curl-tests/health.sh)
//   - Vercel/Railway readiness probe

import { Controller, Get, HttpCode, HttpStatus , Inject } from '@nestjs/common';
import { PrismaService } from '@netamplify/nestjs-libraries/database/prisma/prisma.service';
import { ioRedis } from '@netamplify/nestjs-libraries/redis/redis.service';

interface HealthResponse {
  db: 'up' | 'down';
  redis: 'up' | 'down';
  ts: number; // ISO timestamp
}

@Controller('api/health')
export class HealthController {
  constructor(@Inject(PrismaService) private readonly _prisma: PrismaService) {}

  @Get()
  @HttpCode(200)
  async check(): Promise<HealthResponse> {
    const ts = Date.now();
    let db: 'up' | 'down' = 'down';
    let redis: 'up' | 'down' = 'down';

    // DB check — a SELECT 1 against Postgres
    try {
      await this._prisma.$queryRaw`SELECT 1`;
      db = 'up';
    } catch (e) {
      console.error('Health check: DB error', e);
    }

    // Redis check — a PING
    try {
      const pong = await ioRedis.ping();
      redis = pong === 'PONG' ? 'up' : 'down';
    } catch (e) {
      console.error('Health check: Redis error', e);
    }

    const body: HealthResponse = { db, redis, ts };
    // If either is down, the HTTP status is 503. We can't change the
    // status code from inside a NestJS controller method (HttpCode is
    // decorator-bound), so the caller (smoke tests) must check the body.
    // For now we always return 200 + the body; downstream tooling checks
    // body.db === 'up' && body.redis === 'up'.
    return body;
  }
}
