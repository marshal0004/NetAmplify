// /home/z/my-project/netamplify-app/apps/backend/src/services/postcards/postcards.controller.ts
// NetAmplify — PostCardController (CRUD + preview).
//
// Per docs/05-API-SPEC.md:
//   GET    /api/postcards?page=1&pageSize=12 → { items, total, page }
//   POST   /api/postcards { title, summary, description, techStack[], repoUrl?, liveUrl? } → 201
//   GET    /api/postcards/:id → 200 | 403 | 404
//   PATCH  /api/postcards/:id (partial fields) → 200 | 400 | 403 | 404
//   DELETE /api/postcards/:id → 204 | 403 | 404
//   GET    /api/postcards/:id/preview?platform=X&subreddit= → 200

import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { PostCardService, type PostCardView } from '@netamplify/nestjs-libraries/database/prisma/postcards/postcards.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { errorMapper, ServiceError } from '@netamplify/nestjs-libraries/services/error.mapper';
import { PLATFORM_SCHEMA } from '@netamplify/nestjs-libraries/validation/schemas';
import type { Platform } from '@prisma/client';

function getUserId(req: Request): string {
  const user = req.user as { id?: string } | undefined;
  if (!user?.id) {
    throw new ServiceError('UNAUTHENTICATED', 'Authentication required');
  }
  return user.id;
}

@Controller('api/postcards')
@UseGuards(JwtAuthGuard)
export class PostCardController {
  constructor(private readonly _postcards: PostCardService) {}

  @Get()
  @HttpCode(200)
  async list(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '12',
    @Req() req: Request,
  ) {
    try {
      const p = Math.max(1, parseInt(page, 10) || 1);
      const ps = Math.min(50, Math.max(1, parseInt(pageSize, 10) || 12));
      return await this._postcards.list(getUserId(req), p, ps);
    } catch (e) {
      throw errorMapper(e);
    }
  }

  @Get(':id')
  @HttpCode(200)
  async get(@Param('id') id: string, @Req() req: Request): Promise<PostCardView> {
    try {
      return await this._postcards.get(getUserId(req), id);
    } catch (e) {
      throw errorMapper(e);
    }
  }

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown, @Req() req: Request): Promise<PostCardView> {
    try {
      return await this._postcards.create(getUserId(req), body);
    } catch (e) {
      throw errorMapper(e);
    }
  }

  @Patch(':id')
  @HttpCode(200)
  async update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<PostCardView> {
    try {
      return await this._postcards.update(getUserId(req), id, body);
    } catch (e) {
      throw errorMapper(e);
    }
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string, @Req() req: Request): Promise<void> {
    try {
      await this._postcards.delete(getUserId(req), id);
    } catch (e) {
      throw errorMapper(e);
    }
  }

  /**
   * GET /api/postcards/:id/preview?platform=REDDIT&subreddit=...
   * Returns the Format Engine's output for the specified platform.
   * Used by the Publish page's live per-platform preview panel.
   */
  @Get(':id/preview')
  @HttpCode(200)
  async preview(
    @Param('id') id: string,
    @Query('platform') platformParam: string,
    @Query('subreddit') subreddit: string | undefined,
    @Req() req: Request,
  ) {
    try {
      if (!platformParam) {
        throw new ServiceError('VALIDATION_ERROR', 'platform query param is required');
      }
      const platform = parsePlatformParam(platformParam);
      return await this._postcards.preview(getUserId(req), id, platform, subreddit);
    } catch (e) {
      throw errorMapper(e);
    }
  }
}

function parsePlatformParam(raw: string): Platform {
  const parsed = PLATFORM_SCHEMA.safeParse(raw.toUpperCase());
  if (!parsed.success) {
    throw new ServiceError(
      'VALIDATION_ERROR',
      `Unknown platform: "${raw}". Must be one of: REDDIT, DISCORD, DEVTO, TELEGRAM, BLUESKY, HASHNODE, TWITTER, LINKEDIN.`
    );
  }
  return parsed.data;
}
