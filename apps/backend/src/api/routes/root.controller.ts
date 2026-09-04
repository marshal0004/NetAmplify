import { Controller, Get , Inject } from '@nestjs/common';

/**
 * RootController — NetAmplify health-check endpoint.
 *
 * GET /  → 200 "App is running!" (used by load balancer + smoke tests)
 *
 * Phase 4 will replace this with a proper /api/health endpoint that
 * checks Postgres + Redis per docs/05-API-SPEC.md:
 *   GET /api/health → { db: "up", redis: "up" }
 */
@Controller('/')
export class RootController {
  @Get('/')
  getRoot(): string {
    return 'App is running!';
  }
}
