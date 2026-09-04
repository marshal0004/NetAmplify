// /home/z/my-project/netamplify-app/apps/backend/src/services/connections/connections.controller.ts
// NetAmplify — ConnectionsController.
//
// Per docs/05-API-SPEC.md:
//   GET    /api/connections               → list (NEVER returns credentials)
//   POST   /api/connections/devto          { apiKey }       → 201 { username }
//   POST   /api/connections/hashnode       { pat }          → 201 { username }
//   POST   /api/connections/discord       { webhookUrl }   → 201 { channelName }
//   POST   /api/connections/telegram      { botToken, channel } → 201 { channelTitle }
//   POST   /api/connections/bluesky       { handle, appPassword } → 201 { did }
//   DELETE /api/connections/:platform     → 204
//
// OAuth flows (Reddit, X, LinkedIn) are handled by a separate OAuthController
// in Phase 4 — they need /api/oauth/:platform/start + /callback endpoints.

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards, Inject } from '@nestjs/common';
import type { Request } from 'express';
import { ConnectionsService, type ConnectionView } from '@netamplify/nestjs-libraries/database/prisma/connections/connections.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { errorMapper, ServiceError } from '@netamplify/nestjs-libraries/services/error.mapper';
import { PLATFORM_SCHEMA } from '@netamplify/nestjs-libraries/validation/schemas';
import type { Platform } from '@prisma/client';

function getAuditContext(req: Request) {
  return {
    ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip,
    userAgent: req.headers['user-agent'],
  };
}

function getUserId(req: Request): string {
  const user = req.user as { id?: string } | undefined;
  if (!user?.id) {
    throw new ServiceError('UNAUTHENTICATED', 'Authentication required');
  }
  return user.id;
}

@Controller('api/connections')
@UseGuards(JwtAuthGuard)
export class ConnectionsController {
  constructor(@Inject(ConnectionsService) private readonly _conn: ConnectionsService) {}

  /**
   * GET /api/connections
   * Returns the Connect Checklist state: one entry per platform with
   * connection status + "Setup pending" for unconfigured Tier B.
   */
  @Get()
  @HttpCode(200)
  async list(@Req() req: Request): Promise<ConnectionView[]> {
    return this._conn.list(getUserId(req));
  }

  /**
   * POST /api/connections/devto  { apiKey }
   */
  @Post('devto')
  @HttpCode(201)
  async connectDevto(@Body() body: unknown, @Req() req: Request): Promise<{ id: string; username: string }> {
    try {
      return await this._conn.saveSimpleConnection(
        getUserId(req),
        'DEVTO',
        body,
        getAuditContext(req)
      );
    } catch (e) {
      throw errorMapper(e);
    }
  }

  /**
   * POST /api/connections/hashnode  { pat }
   */
  @Post('hashnode')
  @HttpCode(201)
  async connectHashnode(@Body() body: unknown, @Req() req: Request): Promise<{ id: string; username: string }> {
    try {
      return await this._conn.saveSimpleConnection(
        getUserId(req),
        'HASHNODE',
        body,
        getAuditContext(req)
      );
    } catch (e) {
      throw errorMapper(e);
    }
  }

  /**
   * POST /api/connections/discord  { webhookUrl }
   */
  @Post('discord')
  @HttpCode(201)
  async connectDiscord(@Body() body: unknown, @Req() req: Request): Promise<{ id: string; username: string }> {
    try {
      return await this._conn.saveSimpleConnection(
        getUserId(req),
        'DISCORD',
        body,
        getAuditContext(req)
      );
    } catch (e) {
      throw errorMapper(e);
    }
  }

  /**
   * POST /api/connections/telegram  { botToken, channel }
   */
  @Post('telegram')
  @HttpCode(201)
  async connectTelegram(@Body() body: unknown, @Req() req: Request): Promise<{ id: string; username: string }> {
    try {
      return await this._conn.saveSimpleConnection(
        getUserId(req),
        'TELEGRAM',
        body,
        getAuditContext(req)
      );
    } catch (e) {
      throw errorMapper(e);
    }
  }

  /**
   * POST /api/connections/bluesky  { handle, appPassword }
   */
  @Post('bluesky')
  @HttpCode(201)
  async connectBluesky(@Body() body: unknown, @Req() req: Request): Promise<{ id: string; username: string }> {
    try {
      return await this._conn.saveSimpleConnection(
        getUserId(req),
        'BLUESKY',
        body,
        getAuditContext(req)
      );
    } catch (e) {
      throw errorMapper(e);
    }
  }

  /**
   * DELETE /api/connections/:platform
   * Hard-delete the user's connection for that platform.
   */
  @Delete(':platform')
  @HttpCode(204)
  async disconnect(@Param('platform') platformParam: string, @Req() req: Request): Promise<void> {
    try {
      const platform = parsePlatformParam(platformParam);
      await this._conn.disconnect(getUserId(req), platform, getAuditContext(req));
    } catch (e) {
      throw errorMapper(e);
    }
  }
}

/**
 * Validate that the URL parameter is a recognized platform identifier.
 * Throws ServiceError(VALIDATION_ERROR) for unknown platforms.
 */
function parsePlatformParam(raw: string): Platform {
  const upper = raw.toUpperCase();
  const parsed = PLATFORM_SCHEMA.safeParse(upper);
  if (!parsed.success) {
    throw new ServiceError(
      'VALIDATION_ERROR',
      `Unknown platform: "${raw}". Must be one of: REDDIT, DISCORD, DEVTO, TELEGRAM, BLUESKY, HASHNODE, TWITTER, LINKEDIN.`
    );
  }
  return parsed.data;
}
