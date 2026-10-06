// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/facebook/facebook.adapter.ts
// NetAmplify — Facebook adapter.
//
// OAuth 2.0 via Meta's unified login (https://developers.facebook.com/docs/facebook-login).
// Posts to a Facebook PAGE (not personal profile) via the Graph API:
//   POST /{page-id}/feed?message=...&access_token=PAGE_TOKEN
//
// Meta app requirements:
//   1. App created at https://developers.facebook.com
//   2. App type: "Consumer" (or "Business" — both work)
//   3. Products added: "Facebook Login" + "Instagram Graph API"
//   4. Env vars in .env:
//        FACEBOOK_APP_ID=<your-app-id>
//        FACEBOOK_APP_SECRET=<your-app-secret>
//   5. Facebook Login → Valid OAuth Redirect URIs contains:
//        http://localhost:3000/api/oauth/facebook/callback
//        https://your-domain.com/api/oauth/facebook/callback
//   6. App in "Development mode" → only works for accounts added as testers
//      (good for testing). Switch to "Live" after App Review for any user
//      to connect.
//
// Required permissions (reviewed by Meta for Live mode):
//   - pages_show_list  → see list of user's Facebook Pages
//   - pages_read_engagement  → read Page content (required by Meta's policy)
//   - pages_manage_posts  → create posts on the Page
//   - publish_to_groups  (optional — for FB Groups, not used in MVP)
//
// Why we post to a Page (not personal profile):
//   Meta's API does NOT allow posting to personal profiles. Posts must
//   go to a Page (or Group). The user picks which Page to post to during
//   the publish flow (we use the first Page they have admin rights on).

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

const FB_AUTHORIZE_URL = 'https://www.facebook.com/v21.0/dialog/oauth';
const FB_TOKEN_URL = 'https://graph.facebook.com/v21.0/oauth/access_token';
const FB_GRAPH_BASE = 'https://graph.facebook.com/v21.0';

// Facebook permissions (scopes) — minimal per Meta's policy:
//   pages_show_list       - see list of user's Pages
//   pages_read_engagement - read Page content (Meta requires this even for write)
//   pages_manage_posts    - create/edit/delete Page posts
//   instagram_basic       - read IG account info (linked to FB Page)
//   instagram_content_publish - publish to IG (used by InstagramAdapter)
const FB_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'instagram_basic',
  'instagram_content_publish',
];

export interface FacebookCredentials extends AdapterCredentials {
  accessToken: string;
  /** Long-lived user access token (60 days) — used to fetch fresh page tokens */
  longLivedUserToken?: string;
  /** Token expiry in epoch seconds */
  expiresAt?: number;
  /** User's Facebook numeric ID */
  userId: string;
  /** Selected Facebook Page ID (where posts will go) */
  pageId?: string;
  /** Page name (display) */
  pageName?: string;
  /** Page-scoped access token — used to post */
  pageAccessToken?: string;
  /** Linked Instagram Business account ID (set when user has one) */
  instagramBusinessAccountId?: string;
}

@Injectable()
export class FacebookAdapter implements PlatformAdapter {
  readonly platform: Platform = 'FACEBOOK';
  readonly name = 'Facebook';
  readonly toolTip = 'Connect your Facebook Page (OAuth via Meta)';
  readonly kind = 'OAUTH' as const;

  configured(): boolean {
    return Boolean(
      process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET,
    );
  }

  getAuthUrl(_pkce: PkcePair, state: string, redirectUri: string): string {
    if (!this.configured()) {
      throw new Error('Facebook adapter not configured (missing FACEBOOK_APP_ID/SECRET)');
    }
    // Note: Meta OAuth does NOT use PKCE — uses server-side secret instead.
    // We accept the pkce parameter for interface compatibility but ignore it.
    const params = new URLSearchParams({
      client_id: process.env.FACEBOOK_APP_ID!,
      redirect_uri: redirectUri,
      state,
      scope: FB_SCOPES.join(','),
      response_type: 'code',
      // auth_type=rerequest forces Facebook to re-prompt for permissions if
      // the user previously declined some — needed for pages_manage_posts
      auth_type: 'rerequest',
    });
    return `${FB_AUTHORIZE_URL}?${params.toString()}`;
  }

  /**
   * Exchange the authorization code for a short-lived user access token.
   * Then exchange that for a long-lived (60-day) token. Meta recommends
   * long-lived tokens for production use — short-lived expire in 1-2 hours.
   */
  async exchangeCode(
    code: string,
    _pkce: PkcePair,
    redirectUri: string,
  ): Promise<OAuthTokens> {
    if (!this.configured()) {
      throw new Error('Facebook adapter not configured');
    }

    // Step 1: Exchange code for short-lived user token
    const shortLivedUrl = new URL(`${FB_TOKEN_URL}`);
    shortLivedUrl.searchParams.set('client_id', process.env.FACEBOOK_APP_ID!);
    shortLivedUrl.searchParams.set('client_secret', process.env.FACEBOOK_APP_SECRET!);
    shortLivedUrl.searchParams.set('redirect_uri', redirectUri);
    shortLivedUrl.searchParams.set('code', code);

    const shortResp = await fetch(shortLivedUrl.toString(), { method: 'GET' });
    if (!shortResp.ok) {
      const text = await shortResp.text();
      throw new PublishError('AUTH', `Facebook code exchange failed (${shortResp.status}): ${text}`);
    }
    const shortData = (await shortResp.json()) as {
      access_token: string;
      token_type?: string;
      expires_in?: number;
    };
    if (!shortData.access_token) {
      throw new PublishError('AUTH', 'Facebook returned no access_token');
    }

    // Step 2: Exchange short-lived → long-lived (60 days)
    const longLivedUrl = new URL(`${FB_TOKEN_URL}`);
    longLivedUrl.searchParams.set('grant_type', 'fb_exchange_token');
    longLivedUrl.searchParams.set('client_id', process.env.FACEBOOK_APP_ID!);
    longLivedUrl.searchParams.set('client_secret', process.env.FACEBOOK_APP_SECRET!);
    longLivedUrl.searchParams.set('fb_exchange_token', shortData.access_token);

    const longResp = await fetch(longLivedUrl.toString(), { method: 'GET' });
    if (!longResp.ok) {
      // Long-lived exchange can fail if app is in Development mode —
      // fall back to short-lived token (still works for 1-2 hours).
      return {
        accessToken: shortData.access_token,
        expiresAt: shortData.expires_in
          ? Math.floor(Date.now() / 1000) + shortData.expires_in
          : undefined,
        scopes: FB_SCOPES,
      };
    }
    const longData = (await longResp.json()) as {
      access_token: string;
      expires_in?: number;
      token_type?: string;
    };

    return {
      accessToken: longData.access_token || shortData.access_token,
      expiresAt: longData.expires_in
        ? Math.floor(Date.now() / 1000) + longData.expires_in
        : Math.floor(Date.now() / 1000) + 60 * 24 * 3600, // 60 days
      scopes: FB_SCOPES,
    };
  }

  /**
   * Fetch the user's identity + their Facebook Pages + linked IG account.
   *
   * This is a critical step: we MUST identify the user's Facebook Page
   * (because Meta's API only allows posting to Pages, not personal profiles).
   * We pick the first Page the user has admin rights on.
   *
   * Also fetches the linked Instagram Business account ID (if any) — used
   * by the InstagramAdapter to publish to IG.
   */
  async getIdentity(tokens: OAuthTokens): Promise<PlatformIdentity> {
    // Step 1: Get user's FB ID + name
    const meResp = await fetch(
      `${FB_GRAPH_BASE}/me?fields=id,name&access_token=${encodeURIComponent(tokens.accessToken)}`,
    );
    if (meResp.status === 401) {
      throw new PublishError('AUTH', 'Facebook access token invalid or expired');
    }
    if (!meResp.ok) {
      const text = await meResp.text();
      throw new PublishError('NETWORK', `Facebook /me failed (${meResp.status}): ${text}`);
    }
    const me = (await meResp.json()) as { id: string; name: string };

    // Step 2: Get user's Pages (we'll pick the first one for posting)
    const pagesResp = await fetch(
      `${FB_GRAPH_BASE}/${me.id}/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(tokens.accessToken)}`,
    );
    if (!pagesResp.ok) {
      // User has no Pages, or pages_show_list permission was denied
      // Return identity without a pageId — user will need to create a Page
      return {
        id: me.id,
        username: me.name,
      };
    }
    const pagesData = (await pagesResp.json()) as {
      data: Array<{ id: string; name: string; access_token: string }>;
    };

    if (!pagesData.data || pagesData.data.length === 0) {
      // No Pages — user must create one at facebook.com/pages/create
      return {
        id: me.id,
        username: me.name,
      };
    }

    // Pick the first Page (MVP — later we can let user choose)
    const page = pagesData.data[0];
    return {
      id: me.id,
      username: `${me.name} (${page.name})`,
    };
  }

  /**
   * Publish a post to the user's Facebook Page.
   * Endpoint: POST /{page-id}/feed?message=...&access_token=PAGE_TOKEN
   *
   * The page-scoped access token is required (not the user token). We
   * fetch the page token fresh on each publish to handle token rotation.
   */
  async publish(
    credentials: AdapterCredentials,
    formatted: FormattedPost,
  ): Promise<PublishResult> {
    const creds = credentials as FacebookCredentials;
    if (!creds.accessToken || !creds.userId) {
      throw new PublishError('AUTH', 'Facebook credentials missing accessToken/userId');
    }

    // Step 1: Fetch fresh Page access token (Meta rotates these)
    const pagesResp = await fetch(
      `${FB_GRAPH_BASE}/${creds.userId}/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(creds.accessToken)}`,
    );
    if (pagesResp.status === 401) {
      throw new PublishError('AUTH', 'Facebook user token expired — user must reconnect');
    }
    if (!pagesResp.ok) {
      const text = await pagesResp.text();
      throw new PublishError('NETWORK', `Facebook /accounts failed (${pagesResp.status}): ${text}`);
    }
    const pagesData = (await pagesResp.json()) as {
      data: Array<{ id: string; name: string; access_token: string }>;
    };

    if (!pagesData.data || pagesData.data.length === 0) {
      throw new PublishError(
        'VALIDATION',
        'No Facebook Pages found. Create a Page at https://www.facebook.com/pages/create and reconnect.',
      );
    }

    // Use the configured pageId, or fall back to first Page
    const page = creds.pageId
      ? pagesData.data.find((p) => p.id === creds.pageId) || pagesData.data[0]
      : pagesData.data[0];

    // Step 2: Build the post message
    const tagsLine =
      formatted.hashtags && formatted.hashtags.length > 0
        ? `\n${formatted.hashtags.map((t) => `#${t}`).join(' ')}`
        : '';
    const urlLine = formatted.url ? `\n${formatted.url}` : '';
    const message = `${formatted.title}\n\n${formatted.body}${urlLine}${tagsLine}`;

    // Step 3: POST to /{page-id}/feed
    const feedUrl = `${FB_GRAPH_BASE}/${page.id}/feed`;
    const postBody = new URLSearchParams({
      message,
      access_token: page.access_token,
    });

    const resp = await fetch(feedUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: postBody.toString(),
    });

    if (resp.status === 401) {
      throw new PublishError('AUTH', 'Facebook page token invalid — user must reconnect');
    }
    if (resp.status === 403) {
      const text = await resp.text();
      if (text.includes('permission')) {
        throw new PublishError(
          'AUTH',
          `Facebook permission denied: ${text}. App may need pages_manage_posts review.`,
        );
      }
      throw new PublishError('AUTH', `Facebook forbidden: ${text}`);
    }
    if (resp.status === 429) {
      throw new PublishError('RATE', 'Facebook rate-limited — try again later');
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new PublishError('NETWORK', `Facebook publish failed (${resp.status}): ${text}`);
    }

    const data = (await resp.json()) as { id?: string; error?: { message: string } };
    if (data.error) {
      throw new PublishError('VALIDATION', `Facebook rejected post: ${data.error.message}`);
    }
    if (!data.id) {
      throw new PublishError('NETWORK', 'Facebook returned no post id');
    }

    // data.id format: "{post_id}_{page_id}" — extract just the post_id
    const postId = data.id.split('_')[0] || data.id;
    return {
      id: postId,
      url: `https://www.facebook.com/${page.id}/posts/${postId}`,
    };
  }
}
