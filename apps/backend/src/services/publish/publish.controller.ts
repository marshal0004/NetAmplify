// /home/z/my-project/netamplify-app/apps/backend/src/services/publish/publish.controller.ts
// NetAmplify — PublishController.
//
// Per docs/05-API-SPEC.md:
//   POST /api/postcards/:id/publish { platforms: [...], requestId? } → 201 { post: { id, targets: [{ id, platform, status }] } }
//   GET  /api/posts?page=1&platform=REDDIT&status=SUCCESS → { items, total }
//   GET  /api/posts/:id → post + targets (for status polling)
//   POST /api/posts/:id/targets/:targetId/retry → 200 | 409
//
// Also exposes:
//   POST /api/publish/reddit-cookie-web  — Playwright-based Reddit publish
//   POST /api/publish/twitter-cookie-web — Playwright-based X publish
//   These bypass the Tauri WebView entirely — they spawn a real headless
//   Chromium on the backend, which uses real BoringSSL TLS (passes WAF).

import {
  Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards, Inject } from '@nestjs/common';
import type { Request } from 'express';
import { PublishService, type PublishResultView } from './publish.service';
import { PlaywrightPublishService } from './playwright-publish.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { errorMapper, ServiceError } from '@netamplify/nestjs-libraries/services/error.mapper';
import { ConnectionRepository } from '@netamplify/nestjs-libraries/database/prisma/connections/connections.repository';
import { TokenVault } from '@netamplify/nestjs-libraries/services/vault/token-vault';

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
  constructor(
    @Inject(PublishService) private readonly _publish: PublishService,
    @Inject(PlaywrightPublishService) private readonly _playwright: PlaywrightPublishService,
    @Inject(ConnectionRepository) private readonly _conn: ConnectionRepository,
    @Inject(TokenVault) private readonly _vault: TokenVault,
  ) {}

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

  // ==========================================================================
  // Playwright-based publish endpoints (cookie platforms)
  // ==========================================================================
  //
  // These bypass the Tauri WebView entirely. The frontend calls these
  // instead of `publish_to_reddit_via_webview` / `publish_to_x_via_webview`
  // Tauri commands. The backend spawns a headless Chromium, sets the
  // user's cookies, and calls the platform's API from inside the page
  // context — real Chrome TLS → bypasses Reddit's / X's WAF.

  /**
   * POST /api/publish/reddit-cookie-web
   * Body: { title, body, url?, hashtags?, options?: { subreddit } }
   *
   * Used by the "Test Publish" button on the Connect page.
   * Fetches the user's stored Reddit cookies from the encrypted vault,
   * then spawns headless Chromium to make the publish request.
   */
  @Post('api/publish/reddit-cookie-web')
  @HttpCode(200)
  async publishRedditViaWeb(
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<{ id: string; url: string; success: boolean; error?: string }> {
    try {
      const userId = getUserId(req);

      // Step 1: Fetch decrypted Reddit cookies from the vault
      const creds = await this._conn.getDecryptedCredentials(userId, 'REDDIT_COOKIE');
      if (!creds) {
        throw new ServiceError('NOT_FOUND', 'No Reddit connection found. Please click Auto-Capture first.');
      }
      const credMap = creds as Record<string, unknown>;
      const cookies: Record<string, string> = {};
      if (credMap.tokenV2) cookies.token_v2 = String(credMap.tokenV2);
      if (credMap.csrfToken) cookies.csrf_token = String(credMap.csrfToken);
      if (credMap.redditSession) cookies.reddit_session = String(credMap.redditSession);

      // Step 2: Build the formatted post from the request body
      const b = (body || {}) as Record<string, unknown>;
      const formatted = {
        title: String(b.title ?? 'Test Post from NetAmplify'),
        body: String(b.body ?? ''),
        url: b.url ? String(b.url) : undefined,
        hashtags: Array.isArray(b.hashtags) ? b.hashtags.map(String) : undefined,
        options: b.options as Record<string, unknown> | undefined,
      };

      // Step 3: Spawn Playwright + publish
      return await this._playwright.publishToReddit({ cookies, formatted });
    } catch (e) {
      throw errorMapper(e);
    }
  }

  /**
   * POST /api/publish/twitter-cookie-web
   * Body: { title, body, url?, hashtags? }
   *
   * Same as reddit-cookie-web but for X (Twitter).
   */
  @Post('api/publish/twitter-cookie-web')
  @HttpCode(200)
  async publishTwitterViaWeb(
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<{ id: string; url: string; success: boolean; error?: string }> {
    try {
      const userId = getUserId(req);

      // Step 1: Fetch decrypted X cookies
      const creds = await this._conn.getDecryptedCredentials(userId, 'TWITTER_COOKIE');
      if (!creds) {
        throw new ServiceError('NOT_FOUND', 'No X connection found. Please click Auto-Capture first.');
      }
      const credMap = creds as Record<string, unknown>;
      const cookies: Record<string, string> = {};
      if (credMap.authToken) cookies.auth_token = String(credMap.authToken);
      if (credMap.ct0) cookies.ct0 = String(credMap.ct0);

      // Step 2: Build the formatted post
      const b = (body || {}) as Record<string, unknown>;
      const formatted = {
        title: String(b.title ?? 'Test Post from NetAmplify'),
        body: String(b.body ?? ''),
        url: b.url ? String(b.url) : undefined,
        hashtags: Array.isArray(b.hashtags) ? b.hashtags.map(String) : undefined,
        options: b.options as Record<string, unknown> | undefined,
      };

      // Step 3: Spawn Playwright + publish
      return await this._playwright.publishToX({ cookies, formatted });
    } catch (e) {
      throw errorMapper(e);
    }
  }
}
