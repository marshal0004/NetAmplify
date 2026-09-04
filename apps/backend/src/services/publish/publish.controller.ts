// /home/z/my-project/netamplify-app/apps/backend/src/services/publish/publish.controller.ts
// NetAmplify — PublishController.
//
// Per docs/05-API-SPEC.md:
//   POST /api/postcards/:id/publish { platforms: [...], requestId? } → 201 { post: { id, targets: [{ id, platform, status }] } }
//   GET  /api/posts?page=1&platform=REDDIT&status=SUCCESS → { items, total }
//   GET  /api/posts/:id → post + targets (for status polling)
//   POST /api/posts/:id/targets/:targetId/retry → 200 | 409

import {
  Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards, Inject } from '@nestjs/common';
import type { Request } from 'express';
import { PublishService, type PublishResultView } from './publish.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { errorMapper, ServiceError } from '@netamplify/nestjs-libraries/services/error.mapper';

function getUserId(req: Request): string {
  const user = req.user as { id?: string } | undefined;
  if (!user?.id) {
    throw new ServiceError('UNAUTHENTICATED', 'Authentication required');
  }
  return user.id;
}

function getAudit(req: Request) {
  return {
    ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip,
    userAgent: req.headers['user-agent'],
  };
}

@Controller()
@UseGuards(JwtAuthGuard)
export class PublishController {
  constructor(@Inject(PublishService) private readonly _publish: PublishService) {}

  /**
   * POST /api/postcards/:id/publish
   * Body: { platforms: [{ platform, options? }], requestId? }
   * Returns 201 { post: { id, targets: [{ id, platform, status }] } }
   * 400 if: no valid ACTIVE connection for a requested platform
   * 403 if: not postcard owner
   * 409 if: requestId already used (idempotency — returns existing Post)
   */
  @Post('api/postcards/:id/publish')
  @HttpCode(201)
  async publish(
    @Param('id') postCardId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<PublishResultView> {
    try {
      return await this._publish.publish(getUserId(req), postCardId, body, getAudit(req));
    } catch (e) {
      throw errorMapper(e);
    }
  }

  /**
   * GET /api/posts?page=1&platform=X&status=Y
   * Returns paginated list of user's posts with targets.
   */
  @Get('api/posts')
  @HttpCode(200)
  async list(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('platform') platform: string | undefined,
    @Query('status') status: string | undefined,
    @Req() req: Request,
  ) {
    try {
      const p = Math.max(1, parseInt(page, 10) || 1);
      const ps = Math.min(50, Math.max(1, parseInt(pageSize, 10) || 20));
      return await this._publish.list(getUserId(req), p, ps, {
        platform: platform as never,
        status,
      });
    } catch (e) {
      throw errorMapper(e);
    }
  }

  /**
   * GET /api/posts/:id
   * Returns single Post with all targets. UI polls this for status updates.
   */
  @Get('api/posts/:id')
  @HttpCode(200)
  async get(@Param('id') id: string, @Req() req: Request): Promise<PublishResultView> {
    try {
      return await this._publish.get(getUserId(req), id);
    } catch (e) {
      throw errorMapper(e);
    }
  }

  /**
   * POST /api/posts/:id/targets/:targetId/retry
   * Returns 200 | 409 (not FAILED / attempts ≥3)
   */
  @Post('api/posts/:id/targets/:targetId/retry')
  @HttpCode(200)
  async retry(
    @Param('id') postId: string,
    @Param('targetId') targetId: string,
    @Req() req: Request,
  ): Promise<{ id: string; status: string }> {
    try {
      return await this._publish.retry(getUserId(req), postId, targetId, getAudit(req));
    } catch (e) {
      throw errorMapper(e);
    }
  }
}
