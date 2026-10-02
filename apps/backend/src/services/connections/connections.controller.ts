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

  // ==========================================================================
  // Cookie-based platforms (Option A — bypass X/Reddit paywalls)
  // ==========================================================================

  /**
   * POST /api/connections/twitter-cookie  { authToken, ct0 }
   * Per docs/01-PRD.md §6: cookie bypass for X's $100/mo API paywall.
   */
  @Post('twitter-cookie')
  @HttpCode(201)
  async connectTwitterCookie(@Body() body: unknown, @Req() req: Request): Promise<{ id: string; username: string }> {
    try {
      return await this._conn.saveSimpleConnection(
        getUserId(req),
        'TWITTER_COOKIE',
        body,
        getAuditContext(req)
      );
    } catch (e) {
      throw errorMapper(e);
    }
  }

  /**
   * POST /api/connections/reddit-cookie  { redditSession, token }
   * Per docs/01-PRD.md §6: cookie bypass for Reddit's manual review.
   */
  @Post('reddit-cookie')
  @HttpCode(201)
  async connectRedditCookie(@Body() body: unknown, @Req() req: Request): Promise<{ id: string; username: string }> {
    try {
      return await this._conn.saveSimpleConnection(
        getUserId(req),
        'REDDIT_COOKIE',
        body,
        getAuditContext(req)
      );
    } catch (e) {
      throw errorMapper(e);
    }
  }

  // ==========================================================================
  // New OAuth / API-key platforms (Mastodon + WordPress)
  // ==========================================================================

  /**
   * POST /api/connections/mastodon  { instance, accessToken }
   * Per docs/02-SRS.md FR-007: Mastodon support.
   */
  @Post('mastodon')
  @HttpCode(201)
  async connectMastodon(@Body() body: unknown, @Req() req: Request): Promise<{ id: string; username: string }> {
    try {
      return await this._conn.saveSimpleConnection(
        getUserId(req),
        'MASTODON',
        body,
        getAuditContext(req)
      );
    } catch (e) {
      throw errorMapper(e);
    }
  }

  /**
   * POST /api/connections/wordpress  { siteUrl, username, appPassword }
   * Per docs/02-SRS.md FR-007: WordPress support.
   */
  @Post('wordpress')
  @HttpCode(201)
  async connectWordPress(@Body() body: unknown, @Req() req: Request): Promise<{ id: string; username: string }> {
    try {
      return await this._conn.saveSimpleConnection(
        getUserId(req),
        'WORDPRESS',
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

  /**
   * POST /api/connections/:platform/auto-capture  { cookies }
   *
   * Called by the Tauri desktop app after it captures cookies from the
   * native WebView login window. The Tauri app opens reddit.com/x.com
   * in a native browser window → user logs in normally → Tauri reads
   * the cookies via WebviewWindow::cookies() → sends them here.
   *
   * This endpoint:
   *   1. Maps cookie names to the adapter's expected input fields
   *   2. Calls saveSimpleConnection() which validates + encrypts + stores
   *   3. Returns the user's platform username
   *
   * This eliminates the copy-paste UX — the user just logs in and
   * NetAmplify handles the rest.
   */
  @Post(':platform/auto-capture')
  @HttpCode(201)
  async autoCapture(
    @Param('platform') platformParam: string,
    @Body() body: unknown,
    @Req() req: Request
  ): Promise<{ id: string; username: string }> {
    try {
      const platform = parsePlatformParam(platformParam);

      // Only cookie-based platforms support auto-capture.
      if (platform !== 'TWITTER_COOKIE' && platform !== 'REDDIT_COOKIE') {
        throw new ServiceError(
          'VALIDATION_ERROR',
          `Auto-capture is only supported for TWITTER_COOKIE and REDDIT_COOKIE (got ${platform})`
        );
      }

      // Validate the request body shape.
      const rawBody = (body ?? {}) as Record<string, unknown>;
      const cookies = rawBody.cookies;
      if (!cookies || typeof cookies !== 'object' || Array.isArray(cookies)) {
        throw new ServiceError(
          'VALIDATION_ERROR',
          'Request body must contain a "cookies" object with cookie name → value pairs'
        );
      }

      // Map the captured cookies to the adapter's expected input fields.
      const cookieMap = cookies as Record<string, string>;
      const input = mapCookiesToInput(platform, cookieMap);

      // For auto-captured cookies, SKIP backend validation.
      // The Tauri WebView already proved the cookies are valid (the user
      // logged in successfully in a real browser window). Calling
      // validateCredentials() from Node.js would fail due to TLS
      // fingerprinting — X/Reddit reject Node.js requests even with
      // valid cookies.
      //
      // Instead, we trust the cookies + store them directly (encrypted).
      // The actual publish will go through the Tauri WebView too (via
      // the webview_publish command), so it will also bypass the TLS check.
      return await this._conn.saveSimpleConnectionSkipValidation(
        getUserId(req),
        platform,
        input,
        getAuditContext(req)
      );
    } catch (e) {
      throw errorMapper(e);
    }
  }
}

/**
 * Map captured cookie names to the adapter's expected input field names.
 *
 * The Tauri WebView captures cookies by their actual names (e.g.,
 * `token_v2`, `csrf_token`, `auth_token`, `ct0`). But the Zod validation
 * schemas in the backend use camelCase field names (e.g., `tokenV2`,
 * `csrfToken`, `authToken`, `ct0`). This function translates between
 * the two.
 *
 * For Reddit:
 *   token_v2 (cookie) → tokenV2 (input field)
 *   csrf_token (cookie) → csrfToken (input field)
 *   token (cookie) → token (input field, optional)
 *
 * For X:
 *   auth_token (cookie) → authToken (input field)
 *   ct0 (cookie) → ct0 (input field, same name)
 */
function mapCookiesToInput(
  platform: Platform,
  cookies: Record<string, string>
): Record<string, string> {
  switch (platform) {
    case 'REDDIT_COOKIE': {
      const input: Record<string, string> = {};
      if (cookies.token_v2) input.tokenV2 = cookies.token_v2;
      if (cookies.csrf_token) input.csrfToken = cookies.csrf_token;
      if (cookies.reddit_session) input.redditSession = cookies.reddit_session;
      return input;
    }
    case 'TWITTER_COOKIE': {
      const input: Record<string, string> = {};
      if (cookies.auth_token) input.authToken = cookies.auth_token;
      if (cookies.ct0) input.ct0 = cookies.ct0;
      return input;
    }
    default:
      return {};
  }
}

/**
 * Validate that the URL parameter is a recognized platform identifier.
 * Throws ServiceError(VALIDATION_ERROR) for unknown platforms.
 *
 * Accepts both snake-case (twitter-cookie) and direct (TWITTER_COOKIE) forms.
 */
function parsePlatformParam(raw: string): Platform {
  const upper = raw.toUpperCase().replace(/-/g, '_');
  const parsed = PLATFORM_SCHEMA.safeParse(upper);
  if (!parsed.success) {
    throw new ServiceError(
      'VALIDATION_ERROR',
      `Unknown platform: "${raw}". Must be one of: REDDIT, DISCORD, DEVTO, TELEGRAM, BLUESKY, HASHNODE, TWITTER, LINKEDIN, MASTODON, WORDPRESS, TWITTER_COOKIE, REDDIT_COOKIE.`
    );
  }
  return parsed.data;
}
