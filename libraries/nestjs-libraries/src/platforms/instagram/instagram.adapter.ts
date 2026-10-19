// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/instagram/instagram.adapter.ts
// NetAmplify — Instagram adapter (TRUE Standalone Instagram Business Login).
//
// Uses Instagram's OWN OAuth flow — NOT Facebook's. This means:
//   - Does NOT require linking IG to a Facebook Page
//   - Only requires a Professional (Business/Creator) IG account
//   - Uses INSTAGRAM_APP_ID + INSTAGRAM_APP_SECRET (separate from Facebook)
//   - Posts directly to the user's IG account feed
//
// This is the same approach Postiz uses for "Instagram (Standalone)".
//
// IMPORTANT: Instagram's authorize endpoint (api.instagram.com/oauth/authorize)
// REQUIRES an HTTPS redirect URI. http://localhost is rejected by Meta.
// To test locally, set PUBLIC_APP_URL to an HTTPS tunnel URL (e.g. ngrok).
//
// OAuth flow:
//   1. Browser → https://api.instagram.com/oauth/authorize?client_id=...&redirect_uri=...&scope=...
//   2. User authorizes on Instagram
//   3. Instagram → redirect_uri?code=...&state=...
//   4. Backend POSTs to https://api.instagram.com/oauth/access_token
//      → { access_token, user_id }   (user_id IS the IG account ID)
//   5. Backend exchanges short-lived → long-lived (60 days) via
//      https://graph.instagram.com/access_token?grant_type=ig_exchange_token
//   6. Backend fetches username via https://graph.instagram.com/v21.0/me?fields=id,username,account_type
//
// Publishing flow (two-step Content Publishing API on graph.instagram.com):
//   1. POST https://graph.instagram.com/v21.0/{ig-user-id}/media
//      → creates a media container (image_url + caption)
//   2. POST https://graph.instagram.com/v21.0/{ig-user-id}/media_publish?creation_id={container_id}
//      → publishes the container
//
// Instagram REQUIRES an image for every post (no text-only via API).
//
// IMPORTANT: The Content Publishing API endpoint host MUST match the OAuth
// login type. Instagram Login (standalone) → graph.instagram.com.
// Facebook Login → graph.facebook.com. Using the wrong host fails with
// error 190: "Invalid OAuth access token - Cannot parse access token".

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

// Instagram's own OAuth endpoints (NOT Facebook's)
const IG_AUTHORIZE_URL = 'https://api.instagram.com/oauth/authorize';
const IG_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const IG_TOKEN_EXCHANGE_URL = 'https://graph.instagram.com/access_token';
const IG_PROFILE_URL = 'https://graph.instagram.com/v21.0/me';

// Content Publishing endpoints.
//
// Per Meta's official docs (https://developers.facebook.com/documentation/instagram-platform/content-publishing):
//   - Instagram API with Instagram Login (Business Login for Instagram / "standalone")
//     → Host URL: graph.instagram.com   → uses Instagram User access token
//   - Instagram API with Facebook Login
//     → Host URL: graph.facebook.com    → uses Facebook Page access token
//
// We use Instagram Login (standalone OAuth), so we MUST publish to
// graph.instagram.com. Using graph.facebook.com with an Instagram-Login
// token fails with error 190: "Invalid OAuth access token - Cannot
// parse access token" because the FB host cannot parse IG-Login tokens.
const IG_GRAPH_BASE = 'https://graph.instagram.com/v21.0';

// Instagram Business Login scopes (the new API — different from legacy
// instagram_basic / instagram_content_publish which are Facebook Login scopes).
//
// instagram_business_basic            — read profile, username, account_type
// instagram_business_content_publish  — publish media containers
//
// These MUST be enabled in the Meta dashboard under
// Instagram API → Permissions & Features.
const IG_SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
];

export interface InstagramCredentials extends AdapterCredentials {
  /** Instagram access token (from IG Standalone OAuth — NOT FB OAuth) */
  accessToken: string;
  /** Instagram Business/Creator account ID (numeric — returned by IG OAuth as user_id) */
  igUserId?: string;
  /** Instagram username (for display) */
  username?: string;
}

@Injectable()
export class InstagramAdapter implements PlatformAdapter {
  readonly platform: Platform = 'INSTAGRAM';
  readonly name = 'Instagram';
  readonly toolTip = 'Connect your Instagram account (Standalone — no FB Page needed)';
  readonly kind = 'OAUTH' as const;

  /**
   * Returns true when INSTAGRAM_APP_ID + INSTAGRAM_APP_SECRET are set.
   * We do NOT fall back to FACEBOOK_APP_* here — that would silently
   * enable the broken Facebook-OAuth flow that requires IG-to-FB-Page
   * linking. Fail loud instead of falling back to a broken flow.
   */
  configured(): boolean {
    return Boolean(
      process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET,
    );
  }

  /**
   * Build the Instagram Standalone OAuth URL.
   *
   * Hits Instagram's own authorize endpoint (api.instagram.com), NOT
   * Facebook's. This is what gives us a true Instagram access token
   * + user_id (IG account ID) directly — no FB Page linking required.
   *
   * Instagram OAuth does NOT use PKCE — uses server-side secret instead.
   * We accept the pkce parameter for interface compatibility but ignore it.
   *
   * REQUIRES the redirect_uri to be HTTPS. http://localhost is rejected
   * by Meta. Set PUBLIC_APP_URL to an HTTPS URL (e.g. ngrok tunnel) for
   * local development.
   */
  getAuthUrl(_pkce: PkcePair, state: string, redirectUri: string): string {
    const appId = process.env.INSTAGRAM_APP_ID;
    if (!appId) {
      throw new Error(
        'Instagram adapter not configured (missing INSTAGRAM_APP_ID). ' +
          'Add INSTAGRAM_APP_ID + INSTAGRAM_APP_SECRET to .env. ' +
          'Use the Instagram App ID from your Meta dashboard ' +
          '(NOT the Facebook App ID).',
      );
    }
    if (!redirectUri.startsWith('https://')) {
      throw new Error(
        `Instagram Standalone OAuth requires an HTTPS redirect URI. ` +
          `Got: ${redirectUri}. Set PUBLIC_APP_URL to an HTTPS URL ` +
          `(e.g. https://your-tunnel.ngrok-free.app) and restart the backend.`,
      );
    }
    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      state,
      scope: IG_SCOPES.join(','),
      response_type: 'code',
    });
    return `${IG_AUTHORIZE_URL}?${params.toString()}`;
  }

  /**
   * Exchange the authorization code for an Instagram access token.
   *
   * Uses Instagram's OWN token endpoint (api.instagram.com/oauth/access_token),
   * NOT Facebook's. The response includes `user_id` — the IG account ID
   * directly. No FB Pages discovery needed.
   *
   * Then exchanges the short-lived token (1 hour) for a long-lived one
   * (60 days) via graph.instagram.com/access_token.
   */
  async exchangeCode(
    code: string,
    _pkce: PkcePair,
    redirectUri: string,
  ): Promise<OAuthTokens> {
    const appId = process.env.INSTAGRAM_APP_ID;
    const appSecret = process.env.INSTAGRAM_APP_SECRET;
    if (!appId || !appSecret) {
      throw new PublishError(
        'AUTH',
        'Instagram adapter not configured (missing INSTAGRAM_APP_ID or INSTAGRAM_APP_SECRET)',
      );
    }

    // Step 1: Exchange code for short-lived token + IG user_id
    const tokenResp = await fetch(IG_TOKEN_URL, {
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
        `Instagram code exchange failed (${tokenResp.status}): ${text}`,
      );
    }

    const tokenData = (await tokenResp.json()) as {
      access_token: string;
      user_id?: string;
      expires_in?: number;
      token_type?: string;
    };

    if (!tokenData.access_token) {
      throw new PublishError('AUTH', 'Instagram returned no access_token');
    }
    if (!tokenData.user_id) {
      // This should never happen with Instagram's own OAuth endpoint.
      // If it does, the app is misconfigured (using FB OAuth instead of IG).
      throw new PublishError(
        'AUTH',
        'Instagram returned no user_id — the OAuth endpoint may be ' +
          'misconfigured. Ensure you are hitting api.instagram.com/oauth ' +
          '(not facebook.com/dialog/oauth).',
      );
    }

    // Step 2: Exchange short-lived → long-lived (60 days).
    // This uses graph.instagram.com (Instagram's graph endpoint), NOT
    // graph.facebook.com. The grant_type is ig_exchange_token.
    const longLivedUrl = new URL(IG_TOKEN_EXCHANGE_URL);
    longLivedUrl.searchParams.set('grant_type', 'ig_exchange_token');
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
        return {
          accessToken: longLived.access_token,
          expiresAt: longLived.expires_in
            ? Math.floor(Date.now() / 1000) + longLived.expires_in
            : Math.floor(Date.now() / 1000) + 60 * 24 * 3600,
          scopes: IG_SCOPES,
        };
      }
    }

    // Fallback: short-lived token (1 hour — enough for testing)
    return {
      accessToken: tokenData.access_token,
      expiresAt: tokenData.expires_in
        ? Math.floor(Date.now() / 1000) + tokenData.expires_in
        : Math.floor(Date.now() / 1000) + 3600,
      scopes: IG_SCOPES,
    };
  }

  /**
   * Fetch the Instagram user's identity (username + account_type).
   *
   * Uses graph.instagram.com/v21.0/me (Instagram's graph endpoint), NOT
   * graph.facebook.com. The access token from IG Standalone OAuth works
   * with this endpoint directly — no FB Pages discovery needed.
   *
   * The IG account ID is fetched from /me (returns the same value as
   * the user_id from the token exchange — they are equivalent).
   */
  async getIdentity(tokens: OAuthTokens): Promise<PlatformIdentity> {
    const fields = 'id,username,account_type';
    const profileResp = await fetch(
      `${IG_PROFILE_URL}?fields=${fields}&access_token=${encodeURIComponent(tokens.accessToken)}`,
    );

    if (profileResp.status === 401) {
      throw new PublishError('AUTH', 'Instagram access token invalid or expired');
    }
    if (!profileResp.ok) {
      const text = await profileResp.text();
      throw new PublishError(
        'NETWORK',
        `Instagram /me failed (${profileResp.status}): ${text}`,
      );
    }

    const profile = (await profileResp.json()) as {
      id?: string;
      username?: string;
      account_type?: string;
    };

    if (!profile.id) {
      throw new PublishError('NETWORK', 'Instagram /me returned no id');
    }

    const username = profile.username
      ? `@${profile.username}`
      : `IG account ${profile.id}`;

    // Surface a clear error if the IG account is personal (cannot post via API)
    if (profile.account_type && profile.account_type === 'PERSONAL') {
      throw new PublishError(
        'VALIDATION',
        `Instagram account "${profile.username}" is a PERSONAL account. ` +
          `Convert it to a Business or Creator account in the Instagram app ` +
          `(Settings → Account type and tools → Switch to professional account) ` +
          `to enable posting via the API.`,
      );
    }

    return {
      id: profile.id,
      username,
    };
  }

  /**
   * Publish a post to Instagram via the two-step Content Publishing API.
   *
   * Step 1: POST /{ig-user-id}/media — create media container
   *   Required: image_url (IG posts MUST have media)
   *   Optional: caption (the post text)
   *
   * Step 2: POST /{ig-user-id}/media_publish?creation_id={container_id}
   *   This publishes the container — makes it live on Instagram
   *
   * The IG user ID is stored in credentials as 'igUserId', 'userId', or
   * 'memberId'. The saveOAuthConnection() in connections.service.ts stores
   * identity.id as both 'memberId' and 'userId', so we check all three
   * keys for backwards-compatibility.
   */
  async publish(
    credentials: AdapterCredentials,
    formatted: FormattedPost,
  ): Promise<PublishResult> {
    const creds = credentials as InstagramCredentials;
    if (!creds.accessToken) {
      throw new PublishError(
        'AUTH',
        'Instagram access token missing — user must reconnect',
      );
    }

    // The IG user ID is stored under igUserId, userId, or memberId
    // (saveOAuthConnection stores identity.id as both userId and memberId).
    const igUserId =
      (creds.igUserId as string | undefined) ||
      (creds.userId as string | undefined) ||
      (creds.memberId as string | undefined) ||
      '';
    if (!igUserId) {
      throw new PublishError(
        'AUTH',
        'Instagram account ID missing from credentials — user must reconnect',
      );
    }

    // Get image URL from options — IG REQUIRES an image
    const rawImageUrl = formatted.options?.imageUrl as string | undefined;
    if (!rawImageUrl) {
      throw new PublishError(
        'VALIDATION',
        'Instagram posts require an image. Upload an image in the PostCard editor.',
      );
    }

    // Instagram's servers MUST be able to fetch the image_url over the public
    // internet. If the URL points to localhost (which happens when:
    //   (a) the PostCard was created before PUBLIC_APP_URL was set, OR
    //   (b) the upload controller wasn't read with PUBLIC_APP_URL), Meta's
    // servers cannot reach localhost and the publish fails with:
    //   "Timeout" / error_subcode 2207003 (media download took too long).
    //
    // Fix: rewrite any localhost URL to use PUBLIC_APP_URL (typically the
    // ngrok HTTPS tunnel URL). If PUBLIC_APP_URL is not set, throw a clear
    // error — Instagram publishing cannot work without a public URL.
    const imageUrl = rewriteLocalhostUrlForMeta(rawImageUrl);

    // Build caption
    const tagsLine =
      formatted.hashtags && formatted.hashtags.length > 0
        ? `\n${formatted.hashtags.map((t) => `#${t}`).join(' ')}`
        : '';
    const urlLine = formatted.url ? `\n${formatted.url}` : '';
    const caption = `${formatted.title}\n\n${formatted.body}${urlLine}${tagsLine}`;

    // Step 1: Create the media container
    const createBody = new URLSearchParams({
      image_url: imageUrl,
      caption,
      access_token: creds.accessToken,
    });

    const createResp = await fetch(`${IG_GRAPH_BASE}/${igUserId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: createBody.toString(),
    });

    if (createResp.status === 401) {
      throw new PublishError('AUTH', 'Instagram access token expired — user must reconnect');
    }
    if (createResp.status === 403) {
      const text = await createResp.text();
      throw new PublishError(
        'AUTH',
        `Instagram permission denied: ${text}. ` +
          `App may need instagram_business_content_publish review ` +
          `or the IG account is not Business/Creator.`,
      );
    }
    if (!createResp.ok) {
      const text = await createResp.text();
      throw new PublishError(
        'NETWORK',
        `Instagram /media create failed (${createResp.status}): ${text}`,
      );
    }

    const createData = (await createResp.json()) as {
      id?: string;
      error?: { message: string };
    };
    if (createData.error) {
      throw new PublishError('VALIDATION', `Instagram rejected media: ${createData.error.message}`);
    }
    if (!createData.id) {
      throw new PublishError('NETWORK', 'Instagram returned no container id');
    }

    const containerId = createData.id;

    // Step 2: Wait 3s for image processing, then publish.
    // The IG Content Publishing API requires a processing delay between
    // container creation and publishing — otherwise media_publish fails
    // with "Media is still processing".
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const publishBody = new URLSearchParams({
      creation_id: containerId,
      access_token: creds.accessToken,
    });

    const publishResp = await fetch(`${IG_GRAPH_BASE}/${igUserId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: publishBody.toString(),
    });

    if (publishResp.status === 401) {
      throw new PublishError('AUTH', 'Instagram access token expired during publish');
    }
    if (!publishResp.ok) {
      const text = await publishResp.text();
      throw new PublishError(
        'NETWORK',
        `Instagram /media_publish failed (${publishResp.status}): ${text}`,
      );
    }

    const publishData = (await publishResp.json()) as {
      id?: string;
      error?: { message: string };
    };
    if (publishData.error) {
      throw new PublishError('VALIDATION', `Instagram publish rejected: ${publishData.error.message}`);
    }
    if (!publishData.id) {
      throw new PublishError('NETWORK', 'Instagram returned no post id');
    }

    return {
      id: publishData.id,
      url: `https://www.instagram.com/`,
    };
  }
}

/**
 * Rewrite a localhost URL to use PUBLIC_APP_URL (typically ngrok HTTPS).
 *
 * Meta's servers (Facebook Graph API + Instagram Graph API) must be able to
 * fetch image URLs over the public internet. Localhost URLs (e.g.
 * http://localhost:3000/uploads/xxx.jpg) are unreachable from Meta's cloud
 * and cause publish failures:
 *   - Facebook: error 324 "Missing or invalid image file"
 *   - Instagram: error 2207003 "Timeout — media download took too long"
 *
 * This function:
 *   1. If the URL does NOT contain "localhost" → returns it unchanged.
 *   2. If the URL contains "localhost" AND PUBLIC_APP_URL is set →
 *      returns a new URL with the path preserved but the host replaced.
 *   3. If the URL contains "localhost" AND PUBLIC_APP_URL is NOT set →
 *      throws a PublishError with a clear message.
 *
 * Examples:
 *   rewriteLocalhostUrlForMeta('http://localhost:3000/uploads/abc.jpg')
 *     → 'https://abc-xyz.ngrok-free.app/uploads/abc.jpg'
 *       (when PUBLIC_APP_URL=https://abc-xyz.ngrok-free.app)
 *
 *   rewriteLocalhostUrlForMeta('https://example.com/image.jpg')
 *     → 'https://example.com/image.jpg' (unchanged)
 *
 * Exported for unit testing.
 */
export function rewriteLocalhostUrlForMeta(url: string): string {
  if (!url.includes('localhost') && !url.includes('127.0.0.1')) {
    return url;
  }

  const publicAppUrl = process.env.PUBLIC_APP_URL;
  if (!publicAppUrl) {
    throw new PublishError(
      'VALIDATION',
      `Instagram cannot fetch image from localhost URL: ${url}. ` +
        `Set PUBLIC_APP_URL in .env to an HTTPS tunnel URL (e.g. ngrok) ` +
        `so Meta's servers can download the image.`,
    );
  }

  try {
    const parsed = new URL(url);
    const publicParsed = new URL(publicAppUrl);
    // Preserve the path + query, replace the host/protocol with PUBLIC_APP_URL
    const rewritten = `${publicParsed.protocol}//${publicParsed.host}${parsed.pathname}${parsed.search}`;
    return rewritten;
  } catch {
    throw new PublishError(
      'VALIDATION',
      `Cannot parse image URL: ${url}. Ensure it is a valid URL.`,
    );
  }
}
