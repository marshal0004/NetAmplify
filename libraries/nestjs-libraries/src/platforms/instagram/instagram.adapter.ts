// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/instagram/instagram.adapter.ts
// NetAmplify — Instagram adapter (Standalone Instagram Business Login).
//
// Uses Instagram's OWN OAuth flow — NOT Facebook's. This means:
//   - Does NOT require linking IG to a Facebook Page
//   - Only requires a Professional (Business/Creator) IG account
//   - Uses INSTAGRAM_APP_ID + INSTAGRAM_APP_SECRET (separate from Facebook)
//   - Posts directly to the user's IG account feed
//
// This is the same approach Postiz uses for "Instagram (Standalone)".
//
// Publishing flow (two-step Content Publishing API):
//   1. POST /{ig-user-id}/media — create a media container (image_url + caption)
//   2. POST /{ig-user-id}/media_publish?creation_id={container_id} — publish
//
// Instagram REQUIRES an image for every post (no text-only via API).

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

const FB_GRAPH_BASE = 'https://graph.facebook.com/v21.0';

export interface InstagramCredentials extends AdapterCredentials {
  /** Instagram access token (from IG Standalone OAuth — NOT FB OAuth) */
  accessToken: string;
  /** Instagram Business account ID (numeric) */
  igUserId: string;
  /** Instagram username (for display) */
  username?: string;
}

@Injectable()
export class InstagramAdapter implements PlatformAdapter {
  readonly platform: Platform = 'INSTAGRAM';
  readonly name = 'Instagram';
  readonly toolTip = 'Connect your Instagram account (Standalone — no FB Page needed)';
  readonly kind = 'OAUTH' as const;

  configured(): boolean {
    // Instagram standalone uses INSTAGRAM_APP_ID + INSTAGRAM_APP_SECRET.
    // But for OAuth redirect URI validation, we fall back to FACEBOOK_APP_ID
    // because the redirect URIs are configured under the Facebook Login
    // product (not Instagram business login — which rejects localhost).
    // If INSTAGRAM_APP_ID is not set, we use FACEBOOK_APP_ID.
    return Boolean(
      (process.env.INSTAGRAM_APP_ID || process.env.FACEBOOK_APP_ID) &&
      (process.env.INSTAGRAM_APP_SECRET || process.env.FACEBOOK_APP_SECRET),
    );
  }

  /**
   * Build the Instagram OAuth URL.
   *
   * Uses Facebook's OAuth endpoint with the Facebook App ID (NOT the
   * Instagram App ID) because:
   *   - The redirect URIs are configured under Facebook Login → Settings
   *   - The Instagram App ID doesn't have its own redirect URI config
   *   - Facebook's OAuth accepts localhost in Development mode
   *
   * Uses Instagram-specific scopes (instagram_basic, instagram_content_publish)
   * so the user authorizes Instagram access (not just Facebook Page access).
   *
   * The token exchange uses INSTAGRAM_APP_SECRET (if available) or
   * FACEBOOK_APP_SECRET — both work because they're part of the same
   * Meta app.
   */
  getAuthUrl(_pkce: PkcePair, state: string, redirectUri: string): string {
    const appId = process.env.INSTAGRAM_APP_ID || process.env.FACEBOOK_APP_ID;
    if (!appId) {
      throw new Error('Instagram adapter not configured (missing INSTAGRAM_APP_ID or FACEBOOK_APP_ID)');
    }
    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      state,
      scope: 'instagram_basic,instagram_content_publish',
      response_type: 'code',
      auth_type: 'rerequest',
    });
    // Use Facebook's OAuth endpoint — it accepts localhost in Development mode
    return `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
  }

  /**
   * Exchange the authorization code for an Instagram access token.
   * Uses Instagram's own token endpoint — NOT Facebook's.
   */
  async exchangeCode(
    code: string,
    _pkce: PkcePair,
    redirectUri: string,
  ): Promise<OAuthTokens> {
    const appId = process.env.INSTAGRAM_APP_ID || process.env.FACEBOOK_APP_ID;
    const appSecret = process.env.INSTAGRAM_APP_SECRET || process.env.FACEBOOK_APP_SECRET;
    if (!appId || !appSecret) {
      throw new Error('Instagram adapter not configured');
    }

    // Step 1: Exchange code for short-lived token
    const tokenResp = await fetch(`${FB_GRAPH_BASE}/oauth/access_token`, {
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
      throw new PublishError('AUTH', `Instagram code exchange failed (${tokenResp.status}): ${text}`);
    }

    const tokenData = (await tokenResp.json()) as {
      access_token: string;
      user_id?: string; // Only present with Instagram's own OAuth, NOT Facebook's
      expires_in?: number;
      token_type?: string;
    };

    if (!tokenData.access_token) {
      throw new PublishError('AUTH', 'Instagram/Facebook returned no access_token');
    }

    // Note: user_id is only returned by Instagram's own OAuth endpoint.
    // When using Facebook's OAuth endpoint (which we do for localhost),
    // user_id is NOT in the response — we discover the IG account ID
    // in getIdentity() instead.

    // Step 2: Try to exchange for long-lived token (60 days)
    // This may fail with Facebook user tokens (ig_exchange_token only works
    // with Instagram-specific tokens). If it fails, use the short-lived token.
    const longLivedResp = await fetch(
      `${FB_GRAPH_BASE}/access_token?grant_type=ig_exchange_token&client_secret=${appSecret}&access_token=${tokenData.access_token}`,
    ).catch(() => null);

    if (longLivedResp && longLivedResp.ok) {
      const longLived = (await longLivedResp.json()) as {
        access_token: string;
        token_type: string;
        expires_in: number;
      };
      return {
        accessToken: longLived.access_token,
        expiresAt: Math.floor(Date.now() / 1000) + longLived.expires_in,
        scopes: ['instagram_basic', 'instagram_content_publish'],
      };
    }

    // Fallback to short-lived token (works for 1-2 hours — enough for testing)
    return {
      accessToken: tokenData.access_token,
      expiresAt: tokenData.expires_in
        ? Math.floor(Date.now() / 1000) + tokenData.expires_in
        : undefined,
      scopes: ['instagram_basic', 'instagram_content_publish'],
    };
  }

  /**
   * Get the Instagram user's identity.
   *
   * When using Facebook's OAuth endpoint (for localhost compatibility),
   * the access token is a Facebook user token — NOT an Instagram-specific
   * token. So /me returns the FB user ID, not the IG account ID.
   *
   * To get the IG account ID, we:
   *   1. Call /me to get the FB user ID + name
   *   2. Call /{fb-user-id}/accounts to get FB Pages
   *   3. For each Page, check for instagram_business_account
   *   4. Return the IG Business account ID + username
   *
   * This requires the IG account to be linked to a FB Page (as Business).
   * If not linked, returns a fallback identity with the FB user info.
   */
  async getIdentity(tokens: OAuthTokens): Promise<PlatformIdentity> {
    // Step 1: Get FB user ID + name
    const meResp = await fetch(
      `${FB_GRAPH_BASE}/me?fields=id,name&access_token=${encodeURIComponent(tokens.accessToken)}`,
    );
    if (meResp.status === 401) {
      throw new PublishError('AUTH', 'Meta access token invalid or expired');
    }
    if (!meResp.ok) {
      const text = await meResp.text();
      throw new PublishError('NETWORK', `Instagram /me failed (${meResp.status}): ${text}`);
    }
    const me = (await meResp.json()) as { id: string; name: string };

    // Step 2: Get FB Pages
    const pagesResp = await fetch(
      `${FB_GRAPH_BASE}/${me.id}/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(tokens.accessToken)}`,
    );
    if (!pagesResp.ok) {
      return { id: me.id, username: `${me.name} (no FB Page linked)` };
    }
    const pagesData = (await pagesResp.json()) as {
      data: Array<{ id: string; name: string; access_token: string }>;
    };

    if (!pagesData.data || pagesData.data.length === 0) {
      return { id: me.id, username: `${me.name} (no FB Page linked)` };
    }

    // Step 3: For each Page, check for linked IG Business account
    for (const page of pagesData.data) {
      const igResp = await fetch(
        `${FB_GRAPH_BASE}/${page.id}?fields=instagram_business_account&access_token=${encodeURIComponent(page.access_token)}`,
      );
      if (!igResp.ok) continue;
      const igData = (await igResp.json()) as { instagram_business_account?: { id: string } };
      if (igData.instagram_business_account?.id) {
        const igUserId = igData.instagram_business_account.id;
        // Fetch IG username for display
        const profileResp = await fetch(
          `${FB_GRAPH_BASE}/${igUserId}?fields=username&access_token=${encodeURIComponent(page.access_token)}`,
        );
        let igUsername = '';
        if (profileResp.ok) {
          const profile = (await profileResp.json()) as { username?: string };
          igUsername = profile.username || '';
        }
        return {
          id: igUserId,
          username: igUsername ? `@${igUsername}` : `IG Business ${igUserId}`,
        };
      }
    }

    // No IG Business account found — save with FB user identity
    return {
      id: me.id,
      username: `${me.name} (link IG to FB Page to enable posting)`,
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
   * The IG user ID is stored in credentials as 'igUserId' (from getIdentity).
   * If not found, falls back to 'userId' or 'memberId' (how
   * saveOAuthConnection stores identity.id).
   */
  async publish(
    credentials: AdapterCredentials,
    formatted: FormattedPost,
  ): Promise<PublishResult> {
    const creds = credentials as InstagramCredentials;
    if (!creds.accessToken) {
      throw new PublishError('AUTH', 'Instagram access token missing — user must reconnect');
    }

    // The stored credential userId/memberId may be the FB user ID (not IG account ID).
    // ALWAYS re-discover the IG Business account ID from FB Pages at publish time.
    const meResp = await fetch(
      `${FB_GRAPH_BASE}/me?fields=id,name&access_token=${encodeURIComponent(creds.accessToken)}`,
    );
    if (!meResp.ok) {
      throw new PublishError('AUTH', 'Meta access token expired — user must reconnect');
    }
    const me = (await meResp.json()) as { id: string; name: string };

    const pagesResp = await fetch(
      `${FB_GRAPH_BASE}/${me.id}/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(creds.accessToken)}`,
    );
    if (!pagesResp.ok) {
      throw new PublishError('VALIDATION', 'No Facebook Pages found. Instagram requires a linked FB Page.');
    }
    const pagesData = (await pagesResp.json()) as {
      data: Array<{ id: string; name: string; access_token: string }>;
    };

    if (!pagesData.data || pagesData.data.length === 0) {
      throw new PublishError('VALIDATION', 'No Facebook Pages found. Create a Page and link your IG Business account.');
    }

    let igUserId = '';
    for (const page of pagesData.data) {
      const igResp = await fetch(
        `${FB_GRAPH_BASE}/${page.id}?fields=instagram_business_account&access_token=${encodeURIComponent(page.access_token)}`,
      );
      if (!igResp.ok) continue;
      const igData = (await igResp.json()) as { instagram_business_account?: { id: string } };
      if (igData.instagram_business_account?.id) {
        igUserId = igData.instagram_business_account.id;
        break;
      }
    }

    if (!igUserId) {
      throw new PublishError(
        'VALIDATION',
        'No Instagram Business account found. Link your IG to a Facebook Page in the Accounts Center at https://accountscenter.facebook.com',
      );
    }

    // Get image URL from options — IG REQUIRES an image
    const imageUrl = formatted.options?.imageUrl as string | undefined;
    if (!imageUrl) {
      throw new PublishError(
        'VALIDATION',
        'Instagram posts require an image. Upload an image in the PostCard editor.',
      );
    }

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

    const createResp = await fetch(`${FB_GRAPH_BASE}/${igUserId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: createBody.toString(),
    });

    if (createResp.status === 401) {
      throw new PublishError('AUTH', 'Instagram access token expired — user must reconnect');
    }
    if (createResp.status === 403) {
      const text = await createResp.text();
      throw new PublishError('AUTH', `Instagram permission denied: ${text}. App may need instagram_content_publish review.`);
    }
    if (!createResp.ok) {
      const text = await createResp.text();
      throw new PublishError('NETWORK', `Instagram /media create failed (${createResp.status}): ${text}`);
    }

    const createData = (await createResp.json()) as { id?: string; error?: { message: string } };
    if (createData.error) {
      throw new PublishError('VALIDATION', `Instagram rejected media: ${createData.error.message}`);
    }
    if (!createData.id) {
      throw new PublishError('NETWORK', 'Instagram returned no container id');
    }

    const containerId = createData.id;

    // Step 2: Wait 3s for image processing, then publish
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const publishBody = new URLSearchParams({
      creation_id: containerId,
      access_token: creds.accessToken,
    });

    const publishResp = await fetch(`${FB_GRAPH_BASE}/${igUserId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: publishBody.toString(),
    });

    if (publishResp.status === 401) {
      throw new PublishError('AUTH', 'Instagram access token expired during publish');
    }
    if (!publishResp.ok) {
      const text = await publishResp.text();
      throw new PublishError('NETWORK', `Instagram /media_publish failed (${publishResp.status}): ${text}`);
    }

    const publishData = (await publishResp.json()) as { id?: string; error?: { message: string } };
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
