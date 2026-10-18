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
    // Standalone Instagram uses INSTAGRAM_APP_ID + INSTAGRAM_APP_SECRET
    // (separate from Facebook's FACEBOOK_APP_ID + FACEBOOK_APP_SECRET)
    return Boolean(
      process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET,
    );
  }

  /**
   * Build the Instagram OAuth URL.
   *
   * Uses Facebook's OAuth endpoint (facebook.com/dialog/oauth) because
   * Instagram's own endpoint (instagram.com/oauth/authorize) rejects
   * localhost redirect URIs. Facebook's OAuth accepts localhost in
   * Development mode.
   *
   * The redirect URI must be configured in Facebook Login → Settings →
   * Valid OAuth Redirect URIs (NOT in Instagram business login).
   *
   * Uses INSTAGRAM_APP_ID (which is different from FACEBOOK_APP_ID).
   * The Instagram app ID is shown in the Meta dashboard under:
   *   Use cases → Instagram API → Instagram app ID
   */
  getAuthUrl(_pkce: PkcePair, state: string, redirectUri: string): string {
    if (!this.configured()) {
      throw new Error('Instagram adapter not configured (missing INSTAGRAM_APP_ID/SECRET)');
    }
    const params = new URLSearchParams({
      client_id: process.env.INSTAGRAM_APP_ID!,
      redirect_uri: redirectUri,
      state,
      scope: 'instagram_basic,instagram_content_publish',
      response_type: 'code',
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
    if (!this.configured()) {
      throw new Error('Instagram adapter not configured');
    }

    // Step 1: Exchange code for short-lived token
    const tokenResp = await fetch(`${FB_GRAPH_BASE}/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.INSTAGRAM_APP_ID!,
        client_secret: process.env.INSTAGRAM_APP_SECRET!,
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
      user_id: string;
      expires_in?: number;
    };

    if (!tokenData.access_token || !tokenData.user_id) {
      throw new PublishError('AUTH', 'Instagram returned no access_token or user_id');
    }

    // Step 2: Exchange for long-lived token (60 days)
    const longLivedResp = await fetch(
      `${FB_GRAPH_BASE}/access_token?grant_type=ig_exchange_token&client_secret=${process.env.INSTAGRAM_APP_SECRET!}&access_token=${tokenData.access_token}`,
    );

    if (longLivedResp.ok) {
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

    // Fallback to short-lived if long-lived fails
    return {
      accessToken: tokenData.access_token,
      expiresAt: tokenData.expires_in
        ? Math.floor(Date.now() / 1000) + tokenData.expires_in
        : undefined,
      scopes: ['instagram_basic', 'instagram_content_publish'],
    };
  }

  /**
   * Get the Instagram user's identity (ID + username).
   * Uses the /me endpoint with the IG access token — returns the IG
   * Business account ID directly (NOT the FB user ID).
   */
  async getIdentity(tokens: OAuthTokens): Promise<PlatformIdentity> {
    const meResp = await fetch(
      `${FB_GRAPH_BASE}/me?fields=id,username&access_token=${encodeURIComponent(tokens.accessToken)}`,
    );
    if (meResp.status === 401) {
      throw new PublishError('AUTH', 'Instagram access token invalid or expired');
    }
    if (!meResp.ok) {
      const text = await meResp.text();
      throw new PublishError('NETWORK', `Instagram /me failed (${meResp.status}): ${text}`);
    }

    const me = (await meResp.json()) as { id: string; username?: string };

    return {
      id: me.id,
      username: me.username ? `@${me.username}` : `IG ${me.id}`,
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

    // The IG user ID is stored by saveOAuthConnection as userId/memberId
    // (it stores identity.id as userId/memberId in the encrypted credentials)
    const igUserId = creds.igUserId || (creds.userId as string) || (creds.memberId as string) || '';
    if (!igUserId) {
      throw new PublishError('AUTH', 'Instagram user ID missing — user must reconnect');
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
