// /home/z/my-project/netamplify-ref/apps/backend/src/services/upload/platforms.controller.ts
// NetAmplify — PlatformsController.
//
// GET /api/platforms — returns the per-platform config (char limits, markdown
// support, image support, max images) so the frontend can render live char
// counters + per-platform settings in the PostCard composer + Publish page
// WITHOUT duplicating PLATFORM_CONFIG (single source of truth on the backend).
//
// This is the postflare-style "live limits per platform" enabler: the composer
// fetches this once + shows a per-platform char counter as the user types.

import { Controller, Get, HttpCode, UseGuards } from '@nestjs/common';
import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from '@netamplify/nestjs-libraries/platforms/config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('api/platforms')
@UseGuards(JwtAuthGuard)
export class PlatformsController {
  /**
   * GET /api/platforms → PlatformConfig[]
   *
   * Returns the config for all 14 registered platforms. The response is
   * deterministic (PLATFORM_CONFIG is a static record) + safe to cache on the
   * frontend (it only changes when the backend config changes).
   */
  @Get()
  @HttpCode(200)
  async list(): Promise<PlatformConfig[]> {
    return Object.values(PLATFORM_CONFIG);
  }
}
