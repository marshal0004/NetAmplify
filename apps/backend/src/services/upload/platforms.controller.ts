// /home/z/my-project/netamplify-ref/apps/backend/src/services/upload/platforms.controller.ts
// NetAmplify — PlatformsController.
//
// GET /api/platforms — returns the per-platform config (char limits, markdown
// support, image support, max images) for every REGISTERED platform so the
// frontend can render live char counters + per-platform settings in the
// PostCard composer + Publish page WITHOUT duplicating PLATFORM_CONFIG
// (single source of truth on the backend).
//
// The list is driven by the AdapterRegistry — only platforms that have a
// registered adapter (the 10 live platforms) are returned. Removed platforms
// (HASHNODE, MASTODON, WORDPRESS, the OAuth TWITTER adapter) have no adapter
// registered, so they never appear in the UI platform list even though their
// Prisma enum value + PLATFORM_CONFIG tombstone entry are retained for
// historical-row data compatibility.

import { Controller, Get, HttpCode, UseGuards, Inject } from '@nestjs/common';
import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from '@netamplify/nestjs-libraries/platforms/config';
import { AdapterRegistry } from '@netamplify/nestjs-libraries/platforms/registry';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('api/platforms')
@UseGuards(JwtAuthGuard)
export class PlatformsController {
  constructor(
    @Inject(AdapterRegistry) private readonly _adapters: AdapterRegistry,
  ) {}

  /**
   * GET /api/platforms → PlatformConfig[]
   *
   * Returns config for every REGISTERED platform only (the 10 live adapters).
   * Deterministic (PLATFORM_CONFIG is static) + safe to cache on the frontend.
   */
  @Get()
  @HttpCode(200)
  async list(): Promise<PlatformConfig[]> {
    return this._adapters
      .all()
      .map((adapter) => PLATFORM_CONFIG[adapter.platform])
      .filter((cfg): cfg is PlatformConfig => Boolean(cfg));
  }
}
