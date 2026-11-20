// /home/z/my-project/netamplify-ref/libraries/nestjs-libraries/src/platforms/threads/threads.adapter.ts
// NetAmplify — Threads adapter (official Meta Threads API).
//
// Uses the official Threads API (graph.threads.net) — OAuth 2.0 + two-step
// content publishing. This is the FREE, legitimate, non-paywall-bypassing
// integration: Threads has no paid API tier, and the Content Publishing API
// is free within Meta's per-app quota (250 publishes / 24h per app by default).
//
// API docs: https://developers.facebook.com/documentation/threads
//
// OAuth flow:
//   1. Browser → https://threads.net/oauth/authorize?client_id=...&redirect_uri=...&scope=...
//   2. User authorizes on Threads
//   3. Threads → redirect_uri?code=...&state=...
//   4. Backend POSTs to https://graph.threads.net/oauth/access_token
//      → { access_token, user_id, expires_in }   (user_id IS the Threads profile id)
//   5. Backend exchanges short-lived (~1h) → long-lived (60 days) via
//      https://graph.threads.net/oauth/access_token?grant_type=th_exchange_token
//   6. Backend fetches username via https://graph.threads.net/v1.0/me?fields=id,username
//
// Publishing flow (two-step Content Publishing API, same shape as Instagram):
//   1. POST https://graph.threads.net/v1.0/{threads-id}/threads
//      → creates a media container (media_type=TEXT or IMAGE + text)
//   2. POST https://graph.threads.net/v1.0/{threads-id}/threads_publish?creation_id={id}
//      → publishes the container
//
// Threads supports text-only posts (unlike Instagram which requires media).
// When an image URL is supplied via formatted.options.imageUrl, an IMAGE post
// is created instead.
//
// IMPORTANT: Threads (Meta family) REQUIRES an HTTPS redirect URI for OAuth,
// exactly like Instagram. http://localhost is rejected by Meta. The
// oauth-redirect.ts helper routes THREADS to PUBLIC_APP_URL. To test locally,
// set PUBLIC_APP_URL to an HTTPS tunnel URL (e.g. ngrok).
//
// Threads long-lived tokens (60 days) CAN be refreshed via
//   GET https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token
// The refresh() method is implemented so the publish worker can extend a
// token before it expires (avoids a reconnect loop for active users).

import { Injectable } from '@nestjs/common';
import type {
  PlatformAdapter,
  PkcePair,
  OAuthTokens,
  PlatformIdentity,
  AdapterCredentials,
  FormattedPost,
  PublishResult,
} from '../adapter.interface';
import { PublishError } from '../adapter.interface';
import type { Platform } from '@prisma/client';
// Reuse the Meta-family localhost-rewriter already exported by the Instagram
// adapter (Meta's servers must be able to fetch image URLs over the public
// internet — same constraint for Threads as for Instagram + Facebook).
import { rewriteLocalhostUrlForMeta } from '../instagram/instagram.adapter';

// Threads OAuth endpoints (Meta family — distinct from Instagram's
// api.instagram.com host, but the same Graph API publish shape).
const THREADS_AUTHORIZE_URL = 'https://threads.net/oauth/authorize';
const THREADS_TOKEN_URL = 'https://graph.threads.net/oauth/access_token';
const THREADS_TOKEN_EXCHANGE_URL = 'https://graph.threads.net/oauth/access_token';
const THREADS_REFRESH_URL = 'https://graph.threads.net/refresh_access_token';
const THREADS_GRAPH_BASE = 'https://graph.threads.net/v1.0';
const THREADS_PROFILE_URL = `${THREADS_GRAPH_BASE}/me`;

// Threads API scopes (Meta convention: space-separated in the authorize URL).
//
//   threads_basic                — read profile, username
//   threads_content_publish      — publish media containers
//
// threads_manage_replies / threads_manage_insights are NOT requested: the MVP
// only publishes, and per the trust model (docs/01-PRD.md §7) we request the
// minimal scope set. They can be added later when reply/insight features ship.
const THREADS_SCOPES = ['threads_basic', 'threads_content_publish'];

/** Threads text post limit per Meta docs (500 chars). */
const THREADS_TEXT_LIMIT = 500;

/**
 * The shape of the credentials JSON blob stored encrypted in
 * Connection.credentialsCipher for Threads.
 *
 * saveOAuthConnection() in connections.service.ts stores identity.id as both
 * `memberId` and `userId`, so we read all three keys for robustness.
 */
export interface ThreadsCredentials extends AdapterCredentials {
  /** Threads long-lived access token (60 days, refreshable). */
  accessToken: string;
  /** Threads profile id (numeric — returned by OAuth as user_id). */
  threadsUserId?: string;
  /** Threads username (without leading @). Fetched at publish time for permalink. */
  username?: string;
  /** Optional refresh token (Threads long-lived tokens are self-refreshable
   * via the access_token itself; refreshToken is stored for symmetry). */
  refreshToken?: string;
}

@Injectable()
export class ThreadsAdapter implements PlatformAdapter {
  readonly platform: Platform = 'THREADS';
  readonly name = 'Threads';
  readonly toolTip = 'Connect your Threads account (Meta OAuth)';
  readonly kind = 'OAUTH' as const;

  /**
   * Returns true when THREADS_APP_ID + THREADS_APP_SECRET are set.
   * Threads uses its own Meta App credentials (the same Meta App that powers
   * Instagram can expose a Threads product, but the env vars are distinct so
   * a misconfigured Instagram app doesn't silently break Threads).
   */
  configured(): boolean {
    return Boolean(
      process.env.THREADS_APP_ID && process.env.THREADS_APP_SECRET,
    );
  }

  /**
   * Build the Threads OAuth authorize URL.
   *
   * Threads (Meta family) REQUIRES an HTTPS redirect URI — http://localhost
   * is rejected by Meta. The oauth-redirect.ts helper already routes THREADS
   * to PUBLIC_APP_URL, but we defend in depth here too: if the redirectUri
   * passed in is not HTTPS, throw a clear error rather than letting Meta
   * return an opaque "redirect_uri not allowed" page.
   *
   * Threads OAuth does NOT use PKCE (server-side secret instead, like
   * Instagram). We accept the pkce parameter for interface compatibility but
   * ignore it.
   */
  getAuthUrl(_pkce: PkcePair, state: string, redirectUri: string): string {
    const appId = process.env.THREADS_APP_ID;
    if (!appId) {
      throw new Error(
        'Threads adapter not configured (missing THREADS_APP_ID). ' +
          'Add THREADS_APP_ID + THREADS_APP_SECRET to .env. ' +
          'Use the App ID from your Meta dashboard with the Threads product enabled.',
      );
    }
    if (!redirectUri.startsWith('https://')) {
      throw new Error(
        `Threads OAuth requires an HTTPS redirect URI. Got: ${redirectUri}. ` +
          `Set PUBLIC_APP_URL to an HTTPS URL (e.g. https://your-tunnel.ngrok-free.app) ` +
          `and restart the backend.`,
      );
    }
    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      state,
      scope: THREADS_SCOPES.join(' '),
      response_type: 'code',
    });
    return `${THREADS_AUTHORIZE_URL}?${params.toString()}`;
  }

  /**
   * Exchange the authorization code for a Threads access token.
   *
   * Two sub-steps:
   *   1. POST /oauth/access_token with code → short-lived token + user_id
   *   2. GET /oauth/access_token?grant_type=th_exchange_token → long-lived (60d)
   *
   * The short-lived token (1h) is sufficient for a one-shot publish, but the
   * long-lived token avoids forcing the user to reconnect every hour. We
   * always attempt the long-lived exchange; if it fails (rare — Meta API
   * hiccup), we fall back to the short-lived token so the flow still
   * completes.
   */
  async exchangeCode(
    code: string,
    _pkce: PkcePair,
    redirectUri: string,
  ): Promise<OAuthTokens> {
    const appId = process.env.THREADS_APP_ID;
    const appSecret = process.env.THREADS_APP_SECRET;
    if (!appId || !appSecret) {
      throw new PublishError(
        'AUTH',
        'Threads adapter not configured (missing THREADS_APP_ID or THREADS_APP_SECRET)',
      );
    }

    // Step 1: Exchange code for short-lived token + Threads user_id.
    const tokenResp = await fetch(THREADS_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code,
      }).toString(),
    });

    if (!tokenResp.ok) {
      const text = await tokenResp.text();
      throw new PublishError(
        'AUTH',
        `Threads code exchange failed (${tokenResp.status}): ${text}`,
      );
    }

    const tokenData = (await tokenResp.json()) as {
      access_token: string;
      user_id?: string;
      expires_in?: number;
      token_type?: string;
    };

    if (!tokenData.access_token) {
      throw new PublishError('AUTH', 'Threads returned no access_token');
    }
    if (!tokenData.user_id) {
      throw new PublishError(
        'AUTH',
        'Threads returned no user_id — the OAuth endpoint may be misconfigured. ' +
          'Ensure the Threads product is enabled in your Meta App.',
      );
    }

    // Step 2: Exchange short-lived → long-lived (60 days).
    // Uses graph.threads.net (Threads' graph endpoint), NOT graph.facebook.com.
    const longLivedUrl = new URL(THREADS_TOKEN_EXCHANGE_URL);
    longLivedUrl.searchParams.set('grant_type', 'th_exchange_token');
    longLivedUrl.searchParams.set('client_secret', appSecret);
    longLivedUrl.searchParams.set('access_token', tokenData.access_token);

    const longLivedResp = await fetch(longLivedUrl.toString()).catch(
      () => null,
    );

    if (longLivedResp && longLivedResp.ok) {
      const longLived = (await longLivedResp.json()) as {
        access_token?: string;
        token_type?: string;
        expires_in?: number;
      };
      if (longLived.access_token) {
        // Stash the Threads user_id + token type in the encrypted blob via
        // the same cast pattern the LinkedIn adapter uses for memberId.
        return {
          accessToken: longLived.access_token,
          expiresAt: longLived.expires_in
            ? Math.floor(Date.now() / 1000) + longLived.expires_in
            : Math.floor(Date.now() / 1000) + 60 * 24 * 3600,
          scopes: THREADS_SCOPES,
          ...(tokenData.user_id
            ? ({ threadsUserId: tokenData.user_id } as Record<string, unknown>)
            : {}),
        } as OAuthTokens;
      }
    }

    // Fallback: short-lived token (1h — enough for a first publish).
    // The user will need to reconnect when it expires, but the connection
    // is at least usable immediately.
    return {
      accessToken: tokenData.access_token,
      expiresAt: tokenData.expires_in
        ? Math.floor(Date.now() / 1000) + tokenData.expires_in
        : Math.floor(Date.now() / 1000) + 3600,
      scopes: THREADS_SCOPES,
      ...(tokenData.user_id
        ? ({ threadsUserId: tokenData.user_id } as Record<string, unknown>)
        : {}),
    } as OAuthTokens;
  }

  /**
   * Fetch the Threads user's identity (id + username).
   *
   * Uses graph.threads.net/v1.0/me — the access token from Threads OAuth
   * works with this endpoint directly.
   */
  async getIdentity(tokens: OAuthTokens): Promise<PlatformIdentity> {
    const fields = 'id,username';
    const profileResp = await fetch(
      `${THREADS_PROFILE_URL}?fields=${fields}&access_token=${encodeURIComponent(tokens.accessToken)}`,
    );

    if (profileResp.status === 401) {
      throw new PublishError('AUTH', 'Threads access token invalid or expired');
    }
    if (!profileResp.ok) {
      const text = await profileResp.text();
      throw new PublishError(
        'NETWORK',
        `Threads /me failed (${profileResp.status}): ${text}`,
      );
    }

    const profile = (await profileResp.json()) as {
      id?: string;
      username?: string;
    };

    if (!profile.id) {
      throw new PublishError('NETWORK', 'Threads /me returned no id');
    }

    const username = profile.username
      ? `@${profile.username}`
      : `Threads account ${profile.id}`;

    return {
      id: profile.id,
      username,
    };
  }

  /**
   * Refresh a Threads long-lived access token (extends the 60-day window).
   *
   * Threads long-lived tokens are refreshable as long as they have not
   * expired. The refresh endpoint returns a NEW token with a fresh 60-day
   * window; the old token is invalidated.
   *
   * Called by the publish worker before publish if the token expires within
   * the next 24h (proactive refresh avoids mid-publish AUTH failures).
   */
  async refresh(tokens: OAuthTokens): Promise<OAuthTokens> {
    if (!tokens.accessToken) {
      throw new PublishError('AUTH', 'Cannot refresh: no access token present');
    }
    const refreshUrl = new URL(THREADS_REFRESH_URL);
    refreshUrl.searchParams.set('grant_type', 'th_refresh_token');
    refreshUrl.searchParams.set('access_token', tokens.accessToken);

    const resp = await fetch(refreshUrl.toString());
    if (resp.status === 401) {
      throw new PublishError(
        'AUTH',
        'Threads token expired past refresh window — user must reconnect',
      );
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new PublishError(
        'NETWORK',
        `Threads token refresh failed (${resp.status}): ${text}`,
      );
    }
    const data = (await resp.json()) as {
      access_token?: string;
      token_type?: string;
      expires_in?: number;
    };
    if (!data.access_token) {
      throw new PublishError('NETWORK', 'Threads refresh returned no access_token');
    }
    // The prior token may carry a stashed threadsUserId (set in exchangeCode).
    // OAuthTokens has no index signature, so read it via a double cast through
    // `unknown` — the runtime object is the encrypted blob which has the field.
    const priorThreadsUserId = (tokens as unknown as Record<string, unknown>).threadsUserId as
      | string
      | undefined;
    return {
      accessToken: data.access_token,
      // Carry forward the Threads user id + scopes from the prior token.
      expiresAt: data.expires_in
        ? Math.floor(Date.now() / 1000) + data.expires_in
        : Math.floor(Date.now() / 1000) + 60 * 24 * 3600,
      scopes: tokens.scopes ?? THREADS_SCOPES,
      ...(priorThreadsUserId ? { threadsUserId: priorThreadsUserId } : {}),
    } as OAuthTokens & { threadsUserId?: string };
  }

  /**
   * Publish a post to Threads via the two-step Content Publishing API.
   *
   * Text-only posts are the default (Threads is text-first). When
   * formatted.options.imageUrl is supplied, an IMAGE container is created
   * instead (Meta fetches the image from the public URL — localhost URLs
   * are rewritten to PUBLIC_APP_URL via the shared Meta rewriter).
   *
   * Step 1: POST /{threads-id}/threads — create container
   *   TEXT post:  media_type=TEXT, text={caption}
   *   IMAGE post: media_type=IMAGE, image_url={url}, text={caption}
   *
   * Step 2: POST /{threads-id}/threads_publish?creation_id={container_id}
   *   Publishes the container — makes it live on Threads.
   *
   * The Threads user id is stored in credentials as 'threadsUserId',
   * 'memberId', or 'userId' (saveOAuthConnection stores identity.id as both
   * memberId and userId).
   */
  async publish(
    credentials: AdapterCredentials,
    formatted: FormattedPost,
  ): Promise<PublishResult> {
    const creds = credentials as ThreadsCredentials;
    if (!creds.accessToken) {
      throw new PublishError(
        'AUTH',
        'Threads access token missing — user must reconnect',
      );
    }

    const threadsUserId =
      (creds.threadsUserId as string | undefined) ||
      (creds.userId as string | undefined) ||
      (creds.memberId as string | undefined) ||
      '';
    if (!threadsUserId) {
      throw new PublishError(
        'AUTH',
        'Threads account ID missing from credentials — user must reconnect',
      );
    }

    // Build the caption (Threads is text-first: title + body + url + hashtags).
    // Per-platform override: formatted.options.caption replaces the auto-built
    // caption entirely (user wrote a custom one in the per-platform panel).
    const tagsLine =
      formatted.hashtags && formatted.hashtags.length > 0
        ? `\n${formatted.hashtags.map((t) => `#${t}`).join(' ')}`
        : '';
    const urlLine = formatted.url ? `\n${formatted.url}` : '';
    const autoCaption = `${formatted.title}\n\n${formatted.body}${urlLine}${tagsLine}`;
    const optCaption = (formatted.options?.caption as string | undefined)?.trim();
    const rawCaption = optCaption || autoCaption;

    // Enforce Threads' 500-char limit (truncate with ellipsis — better than
    // rejecting the whole publish, which would fail the entire Amplify batch).
    const caption =
      rawCaption.length > THREADS_TEXT_LIMIT
        ? rawCaption.slice(0, THREADS_TEXT_LIMIT - 1) + '…'
        : rawCaption;

    if (!caption.trim()) {
      throw new PublishError(
        'VALIDATION',
        'Threads post text is empty — supply a title or body',
      );
    }

    // Build the container-creation form body.
    const rawImageUrl = formatted.options?.imageUrl as string | undefined;
    const isImagePost = Boolean(rawImageUrl);
    const createBody = new URLSearchParams();
    createBody.set('access_token', creds.accessToken);
    if (isImagePost) {
      // Meta must be able to fetch the image publicly — rewrite localhost.
      createBody.set('media_type', 'IMAGE');
      createBody.set('image_url', rewriteLocalhostUrlForMeta(rawImageUrl as string));
      createBody.set('text', caption);
    } else {
      createBody.set('media_type', 'TEXT');
      createBody.set('text', caption);
    }

    // Step 1: Create the media container.
    const createResp = await fetch(`${THREADS_GRAPH_BASE}/${threadsUserId}/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: createBody.toString(),
    });

    if (createResp.status === 401) {
      throw new PublishError('AUTH', 'Threads access token expired — user must reconnect');
    }
    if (createResp.status === 403) {
      const text = await createResp.text();
      throw new PublishError(
        'AUTH',
        `Threads permission denied: ${text}. ` +
          `App may need threads_content_publish review or the Threads product ` +
          `is not enabled in the Meta App.`,
      );
    }
    if (createResp.status === 429) {
      throw new PublishError('RATE', 'Threads rate-limited — try again later (250 publishes / 24h per app)');
    }
    if (!createResp.ok) {
      const text = await createResp.text();
      throw new PublishError(
        'NETWORK',
        `Threads /threads create failed (${createResp.status}): ${text}`,
      );
    }

    const createData = (await createResp.json()) as {
      id?: string;
      error?: { message: string };
    };
    if (createData.error) {
      throw new PublishError('VALIDATION', `Threads rejected container: ${createData.error.message}`);
    }
    if (!createData.id) {
      throw new PublishError('NETWORK', 'Threads returned no container id');
    }
    const containerId = createData.id;

    // Step 2: Publish the container.
    // No processing delay is required for Threads (unlike Instagram's 3s wait)
    // because Threads' container is synchronous for TEXT/IMAGE.
    const publishBody = new URLSearchParams({
      creation_id: containerId,
      access_token: creds.accessToken,
    });

    const publishResp = await fetch(
      `${THREADS_GRAPH_BASE}/${threadsUserId}/threads_publish`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: publishBody.toString(),
      },
    );

    if (publishResp.status === 401) {
      throw new PublishError('AUTH', 'Threads access token expired during publish');
    }
    if (publishResp.status === 429) {
      throw new PublishError('RATE', 'Threads rate-limited during publish — try again later');
    }
    if (!publishResp.ok) {
      const text = await publishResp.text();
      throw new PublishError(
        'NETWORK',
        `Threads /threads_publish failed (${publishResp.status}): ${text}`,
      );
    }

    const publishData = (await publishResp.json()) as {
      id?: string;
      error?: { message: string };
    };
    if (publishData.error) {
      throw new PublishError('VALIDATION', `Threads publish rejected: ${publishData.error.message}`);
    }
    if (!publishData.id) {
      throw new PublishError('NETWORK', 'Threads returned no post id');
    }

    // Threads does not return a permalink in the publish response. The
    // canonical permalink format is https://www.threads.net/@{username}/post/{id}.
    // The username is not available in the credentials blob at publish time
    // (saveOAuthConnection stores identity.username in a separate column), so
    // we return the profile root — matching the Instagram adapter's precedent.
    // The post id is captured for retry / status polling.
    return {
      id: publishData.id,
      url: `https://www.threads.net/`,
    };
  }
}
