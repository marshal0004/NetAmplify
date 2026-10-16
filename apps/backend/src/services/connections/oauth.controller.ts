// /home/z/my-project/netamplify-app/apps/backend/src/services/connections/oauth.controller.ts
// NetAmplify — OAuthController (Reddit, X, LinkedIn, Facebook, Instagram OAuth 2.0 flows).
//
// Per docs/05-API-SPEC.md:
//   GET /api/oauth/:platform/start?token={jwt}    → 302 redirect to platform authorize URL
//   GET /api/oauth/:platform/callback?code=...&state=... → 302 to /dashboard/connections?connected=<platform>
//
// FLOW:
//   1. Frontend redirects browser to /api/oauth/{platform}/start?token={jwt}
//   2. Backend verifies JWT, extracts userId, generates PKCE + state
//   3. Backend stores {state, codeVerifier, platform, userId, returnTo} in a
//      signed httpOnly cookie (10-min TTL)
//   4. Backend redirects to platform authorize URL
//   5. User logs in on platform, authorizes
//   6. Platform redirects to /api/oauth/{platform}/callback?code=...&state=...
//   7. Backend reads cookie, validates state, exchanges code for tokens
//   8. Backend fetches user identity, encrypts + upserts Connection
//   9. Backend redirects to frontend /dashboard/connections?connected={platform}

import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  HttpCode,
  Inject,
  Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { ConnectionsService } from '@netamplify/nestjs-libraries/database/prisma/connections/connections.service';
import { AdapterRegistry } from '@netamplify/nestjs-libraries/platforms/registry';
import { PlatformNotConfiguredError } from '@netamplify/nestjs-libraries/platforms/adapter.interface';
import {
  generatePkcePair,
  generateState,
  verifyState,
} from '@netamplify/nestjs-libraries/platforms/oauth/pkce';
import { errorMapper, ServiceError } from '@netamplify/nestjs-libraries/services/error.mapper';
import { PLATFORM_SCHEMA } from '@netamplify/nestjs-libraries/validation/schemas';
import type { Platform } from '@prisma/client';

const OAUTH_COOKIE_NAME = 'netamplify_oauth_state';
const OAUTH_COOKIE_TTL_MS = 10 * 60 * 1000;

interface OAuthCookiePayload {
  state: string;
  codeVerifier: string;
  platform: Platform;
  userId: string;
  returnTo: string;
}

@Controller('api/oauth')
export class OAuthController {
  private readonly _logger = new Logger('OAuthController');

  constructor(
    @Inject(AdapterRegistry) private readonly _adapters: AdapterRegistry,
    private readonly _conn: ConnectionsService,
    private readonly _jwt: JwtService,
  ) {}

  /**
   * GET /api/oauth/:platform/start?token={jwt}
   *
   * 1. Verify the JWT from the query param → extract userId
   * 2. Generate PKCE pair + state
   * 3. Store {state, codeVerifier, platform, userId, returnTo} in signed cookie
   * 4. Redirect to platform authorize URL
   */
  @Get(':platform/start')
  @HttpCode(302)
  async start(
    @Param('platform') platformParam: string,
    @Query('token') token: string,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<void> {
    try {
      const platform = parsePlatform(platformParam);
      if (!['REDDIT', 'TWITTER', 'LINKEDIN', 'FACEBOOK', 'INSTAGRAM'].includes(platform)) {
        throw new ServiceError(
          'VALIDATION_ERROR',
          `${platform} does not support OAuth via this endpoint`
        );
      }

      // Step 1: Verify JWT from query param — this is how we know which user
      // initiated the OAuth flow. The frontend passes the JWT as ?token=xxx.
      // Without this, the callback has no way to know which user to save the
      // connection for (Facebook's redirect doesn't include the JWT).
      if (!token) {
        throw new ServiceError('UNAUTHENTICATED', 'OAuth start requires ?token={jwt} query parameter');
      }

      let userId: string;
      try {
        const payload = this._jwt.verify(token) as { sub: string };
        userId = payload.sub;
      } catch {
        throw new ServiceError('UNAUTHENTICATED', 'OAuth start: JWT invalid or expired — please log in again');
      }
      if (!userId) {
        throw new ServiceError('UNAUTHENTICATED', 'OAuth start: JWT missing sub (user id)');
      }

      const adapter = this._adapters.requireConfigured(platform);
      if (adapter.kind !== 'OAUTH' || !adapter.getAuthUrl || !adapter.exchangeCode || !adapter.getIdentity) {
        throw new ServiceError('INTERNAL', `${platform} adapter missing OAuth methods`);
      }

      const pkce = generatePkcePair();
      const state = generateState();
      const redirectUri = this.buildRedirectUri(req, platform);

      // Build the returnTo URL from the request origin (preserves port 4200
      // when proxied through Vite, or the PUBLIC_APP_URL if set)
      const returnTo = this.buildFrontendUrl(req);

      const payload: OAuthCookiePayload = {
        state,
        codeVerifier: pkce.code_verifier,
        platform,
        userId,
        returnTo,
      };

      // Signed httpOnly cookie — secure only when on HTTPS.
      // On localhost (HTTP), secure:true would prevent the browser from
      // storing the cookie, which breaks the entire OAuth flow.
      const isHttps = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https';
      res.cookie(OAUTH_COOKIE_NAME, JSON.stringify(payload), {
        httpOnly: true,
        sameSite: 'lax',
        signed: true,
        maxAge: OAUTH_COOKIE_TTL_MS,
        secure: isHttps,
      });

      const authUrl = adapter.getAuthUrl(pkce, state, redirectUri);
      res.redirect(302, authUrl);
    } catch (e) {
      if (e instanceof PlatformNotConfiguredError) {
        throw new ServiceError('PLATFORM_NOT_CONFIGURED', e.message);
      }
      throw errorMapper(e);
    }
  }

  /**
   * GET /api/oauth/:platform/callback?code=...&state=...
   *
   * 1. Read + verify the state cookie (contains userId from start step)
   * 2. Exchange code for tokens
   * 3. Fetch user identity
   * 4. Encrypt + upsert Connection (using userId from cookie)
   * 5. Redirect to frontend /dashboard/connections?connected=<platform>
   */
  @Get(':platform/callback')
  @HttpCode(302)
  async callback(
    @Param('platform') platformParam: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<void> {
    let returnTo = this.buildFrontendUrl(req);

    try {
      const platform = parsePlatform(platformParam);
      this._logger.log(`OAuth callback received for ${platform} (code present: ${!!code}, state present: ${!!state})`);

      if (!code || !state) {
        throw new ServiceError('BAD_STATE', 'Missing code or state in OAuth callback');
      }

      // Read the signed cookie — this contains the userId from the start step
      const cookieRaw = (req.signedCookies ?? {})[OAUTH_COOKIE_NAME];
      if (!cookieRaw) {
        this._logger.error('OAuth state cookie missing — cookie was not stored. Check: (1) secure flag on localhost, (2) cookie-parser signed secret matches, (3) sameSite policy');
        throw new ServiceError('BAD_STATE', 'OAuth state cookie missing or expired. Please try connecting again.');
      }
      let cookie: OAuthCookiePayload;
      try {
        cookie = JSON.parse(cookieRaw) as OAuthCookiePayload;
      } catch {
        throw new ServiceError('BAD_STATE', 'OAuth state cookie is corrupt');
      }

      returnTo = cookie.returnTo;

      // Validate state (constant-time compare)
      if (!verifyState(state, cookie.state)) {
        throw new ServiceError('BAD_STATE', 'OAuth state mismatch — possible CSRF attack');
      }

      // Validate platform matches
      if (cookie.platform !== platform) {
        throw new ServiceError(
          'BAD_STATE',
          `OAuth callback platform mismatch (expected ${cookie.platform}, got ${platform})`
        );
      }

      // Clear the state cookie (single-use)
      res.clearCookie(OAUTH_COOKIE_NAME);

      const adapter = this._adapters.requireConfigured(platform);
      if (!adapter.exchangeCode || !adapter.getIdentity) {
        throw new ServiceError('INTERNAL', `${platform} adapter missing OAuth methods`);
      }

      const redirectUri = this.buildRedirectUri(req, platform);
      this._logger.log(`Exchanging code for tokens (redirectUri: ${redirectUri})...`);
      const tokens = await adapter.exchangeCode(code, {
        code_verifier: cookie.codeVerifier,
        code_challenge: '',
        code_challenge_method: 'S256',
      }, redirectUri);
      this._logger.log(`Token exchange succeeded. Fetching identity...`);

      const identity = await adapter.getIdentity(tokens);
      this._logger.log(`Identity fetched: id=${identity.id}, username=${identity.username}`);

      // Use the userId from the cookie — this was set during the start step
      // after verifying the JWT. This is the link between the OAuth flow and
      // the NetAmplify user account.
      const userId = cookie.userId;
      if (!userId) {
        throw new ServiceError(
          'UNAUTHENTICATED',
          'OAuth callback: userId missing from state cookie — please try connecting again'
        );
      }

      this._logger.log(`Saving OAuth connection for user ${userId}, platform ${platform}...`);
      const saved = await this._conn.saveOAuthConnection({
        userId,
        platform,
        tokens,
        identity,
        audit: {
          ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip,
          userAgent: req.headers['user-agent'],
        },
      });
      this._logger.log(`✅ OAuth connection saved: id=${saved.platformUsername}`);

      const redirectUrl = `${returnTo}/dashboard/connections?connected=${platform.toLowerCase()}&username=${encodeURIComponent(saved.platformUsername)}`;
      res.redirect(302, redirectUrl);
    } catch (e) {
      const errorMsg = e instanceof ServiceError ? e.message : (e instanceof Error ? e.message : 'OAuth callback failed');
      const errorStack = e instanceof Error ? e.stack : '';
      this._logger.error(`❌ OAuth callback failed: ${errorMsg}\n${errorStack || ''}`);
      res.redirect(302, `${returnTo}/dashboard/connections?error=oauth_failed&message=${encodeURIComponent(errorMsg)}`);
    }
  }

  /**
   * Build the OAuth redirect URI (where the platform sends the callback).
   * This MUST match what's configured in the platform's app dashboard.
   *
   * Uses the request origin so it works behind Vite proxy (port 4200 → 3000)
   * or directly on the backend port (3000).
   */
  private buildRedirectUri(req: Request, platform: Platform): string {
    const baseUrl = process.env.PUBLIC_APP_URL
      || `${req.protocol}://${req.get('host')}`;
    return `${baseUrl}/api/oauth/${platform.toLowerCase()}/callback`;
  }

  /**
   * Build the frontend URL for post-OAuth redirect.
   * When behind Vite proxy, req.get('host') is the frontend port (4200).
   * Falls back to PUBLIC_APP_URL or localhost:4200.
   */
  private buildFrontendUrl(req: Request): string {
    return process.env.PUBLIC_APP_URL
      || `http://${req.get('host') || 'localhost:4200'}`;
  }
}

function parsePlatform(raw: string): Platform {
  const upper = raw.toUpperCase();
  const parsed = PLATFORM_SCHEMA.safeParse(upper);
  if (!parsed.success) {
    throw new ServiceError(
      'VALIDATION_ERROR',
      `Unknown platform: "${raw}"`
    );
  }
  return parsed.data;
}
