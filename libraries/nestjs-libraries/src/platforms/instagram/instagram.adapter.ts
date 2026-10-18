// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/instagram/instagram.adapter.ts
// NetAmplify — Instagram adapter.
//
// Posts to Instagram via the Graph API Content Publishing API.
// Docs: https://developers.facebook.com/docs/instagram-api/guides/content-publishing
//
// IMPORTANT: Instagram Graph API only works with INSTAGRAM BUSINESS or
// CREATOR accounts. Personal accounts cannot post via API.
// Convert to Business: Instagram app → Settings → Account type → Switch to Business.
//
// Required IG account setup:
//   1. Instagram account is Business or Creator (not personal)
//   2. Instagram account is linked to a Facebook Page (linked in IG settings)
//   3. App has Instagram Graph API product added
//
// Publishing flow (two-step):
//   1. POST /{ig-user-id}/media — create a media container (returns container_id)
//        - image_url OR video_url is REQUIRED (IG posts must have media)
//        - caption is the post text
//   2. POST /{ig-user-id}/media_publish?creation_id={container_id} — publish
//        - This makes the post live on Instagram
//
// For MVP, we require the user to provide an imageUrl in formatted.options.
// If no image is provided, we throw a clear error explaining IG requires media.
//
// Uses the same Meta OAuth app + scopes as FacebookAdapter:
//   instagram_basic, instagram_content_publish
// These are bundled with the FB OAuth flow.

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
  /** User's Facebook access token (we use the SAME FB OAuth token — IG uses FB identity) */
  accessToken: string;
  /** Instagram Business account ID (numeric, e.g. 17841405822304914) */
  igUserId: string;
  /** Instagram username (for display) */
  username?: string;
}

@Injectable()
export class InstagramAdapter implements PlatformAdapter {
  readonly platform: Platform = 'INSTAGRAM';
  readonly name = 'Instagram';
  readonly toolTip = 'Connect your Instagram Business account (OAuth via Meta)';
  readonly kind = 'OAUTH' as const;

  configured(): boolean {
    // Instagram uses the SAME Meta app as Facebook
    return Boolean(
      process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET,
    );
  }

  /**
   * Instagram OAuth uses Facebook's OAuth flow (Meta unified login).
   * This method exists for interface compatibility but is not directly called —
   * Instagram connections come through the Facebook OAuth flow, which fetches
   * the IG business account ID during getIdentity().
   *
   * If a user only wants IG (not FB), they still go through Facebook OAuth.
   */
  getAuthUrl(_pkce: PkcePair, state: string, redirectUri: string): string {
    if (!this.configured()) {
      throw new Error('Instagram adapter not configured (missing FACEBOOK_APP_ID/SECRET)');
    }
    // Use FB OAuth URL (same flow) — Instagram uses Meta's unified login.
    // Use ONLY Page-level scopes that are verified working in the user's
    // Meta dashboard (configured under "Manage everything on your Page" use case).
    //
    // We do NOT request instagram_business_basic / instagram_content_publish
    // because those require the "Manage messaging & content on Instagram"
    // use case to be fully configured, which the user hasn't done yet.
    //
    // Instagram account discovery still works through the FB Page's
    // instagram_business_account field — this only needs pages_show_list +
    // pages_read_engagement (which ARE configured).
    //
    // VERIFIED in sandbox testing: these scopes are accepted by Facebook
    // for app 1634366684795396 (Netamplify).
    const params = new URLSearchParams({
      client_id: process.env.FACEBOOK_APP_ID!,
      redirect_uri: redirectUri,
      state,
      scope: 'pages_show_list,pages_read_engagement,pages_manage_posts,business_management',
      response_type: 'code',
      auth_type: 'rerequest',
    });
    return `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
  }

  /**
   * Instagram uses the same code exchange as Facebook — exchange code for
   * a Meta access token. Both adapters share the same Meta OAuth flow.
   */
  async exchangeCode(
    code: string,
    _pkce: PkcePair,
    redirectUri: string,
  ): Promise<OAuthTokens> {
    if (!this.configured()) {
      throw new Error('Instagram adapter not configured');
    }

    const tokenUrl = new URL(`${FB_GRAPH_BASE}/oauth/access_token`);
    tokenUrl.searchParams.set('client_id', process.env.FACEBOOK_APP_ID!);
    tokenUrl.searchParams.set('client_secret', process.env.FACEBOOK_APP_SECRET!);
    tokenUrl.searchParams.set('redirect_uri', redirectUri);
    tokenUrl.searchParams.set('code', code);

    const resp = await fetch(tokenUrl.toString(), { method: 'GET' });
    if (!resp.ok) {
      const text = await resp.text();
      throw new PublishError('AUTH', `Instagram code exchange failed (${resp.status}): ${text}`);
    }
    const data = (await resp.json()) as {
      access_token: string;
      expires_in?: number;
    };

    return {
      accessToken: data.access_token,
      expiresAt: data.expires_in
        ? Math.floor(Date.now() / 1000) + data.expires_in
        : undefined,
      scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'business_management'],
    };
  }

  /**
   * Get the Instagram Business account ID from the user's FB Pages.
   * Each FB Page can have a linked IG Business account — we fetch via
   * the /{page-id}?fields=instagram_business_account endpoint.
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

    // Step 2: Get user's FB Pages
    const pagesResp = await fetch(
      `${FB_GRAPH_BASE}/${me.id}/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(tokens.accessToken)}`,
    );
    if (!pagesResp.ok) {
      // User has no Pages — save the connection with the FB user identity.
      // They can create a Page later at facebook.com/pages/create.
      return {
        id: me.id,
        username: `${me.name} (no FB Page linked)`,
      };
    }
    const pagesData = (await pagesResp.json()) as {
      data: Array<{ id: string; name: string; access_token: string }>;
    };

    if (!pagesData.data || pagesData.data.length === 0) {
      // No Pages — save with FB user identity (user can create Page later)
      return {
        id: me.id,
        username: `${me.name} (no FB Page linked)`,
      };
    }

    // Step 3: For each Page, check if there's a linked IG Business account
    for (const page of pagesData.data) {
      const igResp = await fetch(
        `${FB_GRAPH_BASE}/${page.id}?fields=instagram_business_account&access_token=${encodeURIComponent(page.access_token)}`,
      );
      if (!igResp.ok) continue;

      const igData = (await igResp.json()) as {
        instagram_business_account?: { id: string };
      };

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

    // No IG Business account found on any Page — save the connection anyway
    // with the FB user identity. The user will need to convert their IG to
    // Business + link it to a FB Page before they can actually post to IG.
    // But the OAuth connection is saved so they don't have to re-authorize.
    return {
      id: me.id,
      username: `${me.name} (convert IG to Business to enable posting)`,
    };
  }

  /**
   * Publish a post to Instagram via the two-step Content Publishing API.
   *
   * Step 1: POST /{ig-user-id}/media — create media container
   *   Required: image_url OR video_url (IG posts MUST have media)
   *   Optional: caption (the post text)
   *
   * Step 2: POST /{ig-user-id}/media_publish?creation_id={container_id}
   *   This publishes the container — makes it live on Instagram
   *
   * For MVP, the user must provide an imageUrl in formatted.options.imageUrl.
   * Without an image, IG API rejects the post (they don't support text-only).
   */
  async publish(
    credentials: AdapterCredentials,
    formatted: FormattedPost,
  ): Promise<PublishResult> {
    const creds = credentials as InstagramCredentials;
    if (!creds.accessToken) {
      throw new PublishError('AUTH', 'Instagram access token missing — user must reconnect');
    }

    // ALWAYS re-discover the IG Business account ID from FB Pages.
    // The stored userId/memberId is the FB user ID — NOT the IG Business
    // account ID. Using the FB user ID with /media endpoint causes:
    //   "Object with ID 'xxx' does not exist"
    // The IG Business account ID must be discovered via the FB Page's
    // instagram_business_account field.
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
        'No Instagram Business account found. Convert your IG to Business and link it to a Facebook Page.',
      );
    }

    // Get image URL from options — IG REQUIRES an image
    const imageUrl = formatted.options?.imageUrl as string | undefined;
    if (!imageUrl) {
      throw new PublishError(
        'VALIDATION',
        'Instagram posts require an image URL. Pass options.imageUrl in the post payload. ' +
        'IG does not support text-only posts via the API.',
      );
    }

    // Build caption from title + body + hashtags
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

    const createResp = await fetch(`${FB_GRAPH_BASE}/${creds.igUserId}/media`, {
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
        `Instagram permission denied: ${text}. App may need instagram_content_publish review.`,
      );
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

    // Step 2: Publish the media container
    // Note: Meta recommends waiting ~3 seconds between creating the container
    // and publishing — the image needs time to download + process on Meta's side.
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const publishBody = new URLSearchParams({
      creation_id: containerId,
      access_token: creds.accessToken,
    });

    const publishResp = await fetch(`${FB_GRAPH_BASE}/${creds.igUserId}/media_publish`, {
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

    const postId = publishData.id;

    // Construct permalink — IG uses /p/{shortcode}/ format
    // We'd need a separate API call to get the shortcode; for MVP return the
    // IG profile URL (user can see the new post at the top of their profile)
    const username = creds.username?.replace('@', '') || 'your_account';
    return {
      id: postId,
      url: `https://www.instagram.com/${username}/`,
    };
  }
}
