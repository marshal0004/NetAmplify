// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/x/x-cookie.adapter.ts
// NetAmplify — X (Twitter) cookie-based adapter.
//
// Per docs/01-PRD.md §6 (Cookie Method — Option A):
//   "Bypass X's $100/month API paywall by using the user's session cookies
//    to call X's internal GraphQL API — the same endpoints x.com uses
//    when a user clicks 'Post' in their browser. Same approach Postiz
//    takes. ToS-risky but functional for the demo."
//
// Required user-supplied credentials (extracted from x.com cookies via a
// browser extension like Cookie-Editor):
//   - authToken: the `auth_token` cookie (long-lived, ~1 year)
//   - ct0:        the `ct0` cookie (CSRF token, rotates per session)
//
// How X's internal API works (reverse-engineered, publicly documented):
//   1. The x.com web app ships with a hardcoded Bearer token in main.js.
//      This is a public value (not a secret) — every browser uses the
//      same Bearer token to identify the "Twitter Web Client" app.
//   2. The web app uses GraphQL endpoints at /i/api/graphql/{queryId}/{op}.
//      The `queryId` for CreateTweet changes with each Twitter web
//      release, so we fetch it dynamically from the main.js bundle.
//   3. Each request requires:
//        - authorization: Bearer <web bearer>
//        - cookie: auth_token=...; ct0=...
//        - x-csrf-token: <ct0 value>  (must match the ct0 cookie)
//        - x-twitter-auth-type: OAuth2Session
//        - x-twitter-active-user: yes
//        - content-type: application/json
//
// Validation: GET /1.1/account/verify_credentials.json (legacy v1.1
// endpoint, still works for cookie-authenticated web clients).
//
// Trust model: cookies are stored encrypted (AES-256-GCM) in
// Connection.credentialsCipher — same as any other credential. The user
// can revoke by logging out of x.com on any device.

import { Injectable } from '@nestjs/common';
import type {
  PlatformAdapter,
  PlatformIdentity,
  AdapterCredentials,
  FormattedPost,
  PublishResult,
} from '../adapter.interface';
import { PublishError } from '../adapter.interface';
import type { Platform } from '@prisma/client';

/**
 * The public Bearer token shipped with x.com's main.js bundle. Every
 * browser visiting x.com uses this same value to identify the "Twitter
 * Web Client" OAuth consumer. This is NOT a secret — it's a public app
 * identifier embedded in client-side JavaScript that ships to every
 * user's browser.
 *
 * Source: x.com static bundles (re-verified 2025-12; refresh if Twitter
 * rotates it, which they do approximately once every 2-3 years).
 */
const X_WEB_BEARER_TOKEN =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuAhw6TZR0YwqHvQ%3D' +
  'JqGisW7eT0YmZKb1iVpPu5pFgCqVQUO5WnLhQaLvO4';

/**
 * Endpoints for the X internal (web client) API. These match what a
 * real browser sends when posting a tweet.
 */
const X_VERIFY_URL = 'https://api.x.com/1.1/account/verify_credentials.json';
const X_GRAPHQL_CREATE_TWEET = 'https://x.com/i/api/graphql/{queryId}/CreateTweet';
const X_MAIN_JS_PATTERN = /https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/main\.[a-z0-9]+\.js/;
const X_QUERY_ID_PATTERN = /queryId:"([A-Za-z0-9_-]+)".*?operationName:"CreateTweet"/;

/**
 * The shape of the credentials JSON blob stored encrypted in
 * Connection.credentialsCipher for X cookie-based connections.
 *
 * - `authToken`: the auth_token cookie value (hex string, ~40 chars)
 * - `ct0`:       the ct0 cookie value (32-char hex, CSRF token)
 */
export interface XCookieCredentials extends AdapterCredentials {
  authToken: string;
  ct0: string;
}

/**
 * Internal cache of the fetched CreateTweet queryId, with expiry.
 * Twitter rotates the queryId with each web bundle release (~weekly),
 * so we cache for 1 hour and refetch on miss.
 */
interface CachedQueryId {
  queryId: string;
  fetchedAt: number;
}
let cachedQueryId: CachedQueryId | null = null;
const QUERY_ID_CACHE_MS = 60 * 60 * 1000; // 1 hour

/**
 * Reset the queryId cache. Used by tests to ensure each test starts with
 * a clean cache (otherwise the module-level singleton persists across
 * tests, causing mock sequences to misalign).
 *
 * Production code never calls this — the cache auto-expires after 1 hour.
 *
 * Exported with underscore prefix to signal "internal/testing-only".
 */
export function _resetQueryIdCacheForTests(): void {
  cachedQueryId = null;
}

/**
 * Build the Cookie header value from credentials.
 * Per RFC 6265 §4.2.1 — semicolon-separated name=value pairs.
 */
function buildCookieHeader(creds: XCookieCredentials): string {
  return `auth_token=${creds.authToken}; ct0=${creds.ct0}`;
}

/**
 * Build the standard set of headers required by X's internal API.
 * Per docs/03-ARCHITECTURE.md — every internal-API request must include
 * these 5 headers (or X returns 403).
 */
function buildXHeaders(creds: XCookieCredentials): Record<string, string> {
  return {
    authorization: `Bearer ${X_WEB_BEARER_TOKEN}`,
    cookie: buildCookieHeader(creds),
    'x-csrf-token': creds.ct0,
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-active-user': 'yes',
    'x-twitter-client-language': 'en',
    'user-agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  };
}

/**
 * Fetch the current CreateTweet queryId from x.com's main.js bundle.
 * Twitter rotates this with each web release (~weekly), so we cannot
 * hardcode it. Instead we:
 *   1. GET https://x.com (the homepage HTML)
 *   2. Find the main.<hash>.js script URL in the HTML
 *   3. GET the main.js bundle
 *   4. Extract the queryId with a regex matching the CreateTweet
 *      operation definition in the GraphQL operation map
 *
 * Throws PublishError('NETWORK') if the fetch fails, or
 * PublishError('NETWORK') if the regex doesn't match (Twitter may
 * have changed their bundle format).
 */
async function fetchCreateTweetQueryId(): Promise<string> {
  if (cachedQueryId && Date.now() - cachedQueryId.fetchedAt < QUERY_ID_CACHE_MS) {
    return cachedQueryId.queryId;
  }

  // Step 1: Fetch x.com homepage
  const homeResp = await fetch('https://x.com/', {
    method: 'GET',
    headers: {
      'user-agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.5',
    },
  });
  if (!homeResp.ok) {
    throw new PublishError(
      'NETWORK',
      `Failed to fetch x.com homepage (${homeResp.status}) to resolve queryId`
    );
  }
  const homeHtml = await homeResp.text();

  // Step 2: Extract main.js URL
  const mainJsMatch = homeHtml.match(X_MAIN_JS_PATTERN);
  if (!mainJsMatch) {
    throw new PublishError(
      'NETWORK',
      'Could not locate main.js bundle URL in x.com homepage — Twitter may have changed their HTML structure'
    );
  }

  // Step 3: Fetch main.js bundle
  const jsResp = await fetch(mainJsMatch[0], {
    method: 'GET',
    headers: {
      'user-agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      accept: '*/*',
      'accept-language': 'en-US,en;q=0.5',
      origin: 'https://x.com',
      referer: 'https://x.com/',
    },
  });
  if (!jsResp.ok) {
    throw new PublishError(
      'NETWORK',
      `Failed to fetch main.js bundle (${jsResp.status}) to resolve queryId`
    );
  }
  const jsBody = await jsResp.text();

  // Step 4: Extract queryId for CreateTweet
  const queryIdMatch = jsBody.match(X_QUERY_ID_PATTERN);
  if (!queryIdMatch) {
    throw new PublishError(
      'NETWORK',
      'Could not locate CreateTweet queryId in main.js — Twitter may have changed their bundle format'
    );
  }

  cachedQueryId = { queryId: queryIdMatch[1], fetchedAt: Date.now() };
  return queryIdMatch[1];
}

@Injectable()
export class XCookieAdapter implements PlatformAdapter {
  readonly platform: Platform = 'TWITTER_COOKIE';
  readonly name = 'X (Twitter) — Cookie';
  readonly toolTip = 'Paste your x.com session cookies (auth_token + ct0)';
  readonly kind = 'SIMPLE' as const;

  configured(): boolean {
    // Cookie-based — no env vars needed (the user supplies their own cookies).
    return true;
  }

  /**
   * Validate the user-pasted X session cookies by calling the v1.1
   * verify_credentials endpoint. Returns the user's id + screen_name.
   *
   * Endpoint: GET /1.1/account/verify_credentials.json
   * Returns: { id_str, screen_name, name, ... } on success.
   */
  async validateCredentials(
    input: Record<string, string>
  ): Promise<{ identity: PlatformIdentity; credentials: XCookieCredentials }> {
    const authToken = input.authToken;
    const ct0 = input.ct0;

    if (!authToken || typeof authToken !== 'string') {
      throw new PublishError('VALIDATION', 'auth_token cookie is required');
    }
    if (!ct0 || typeof ct0 !== 'string') {
      throw new PublishError('VALIDATION', 'ct0 cookie is required');
    }
    if (!/^[a-f0-9]{40}$/i.test(authToken)) {
      throw new PublishError(
        'VALIDATION',
        'auth_token must be a 40-char hex string (copy the cookie value exactly)'
      );
    }
    if (!/^[a-f0-9]{32}$/i.test(ct0)) {
      throw new PublishError(
        'VALIDATION',
        'ct0 must be a 32-char hex string (copy the cookie value exactly)'
      );
    }

    const creds: XCookieCredentials = { authToken, ct0 };
    const resp = await fetch(X_VERIFY_URL, {
      method: 'GET',
      headers: {
        ...buildXHeaders(creds),
        accept: '*/*',
      },
    });

    if (resp.status === 401 || resp.status === 403) {
      throw new PublishError(
        'AUTH',
        'X cookies are invalid or expired — log in to x.com and re-export your cookies'
      );
    }
    if (resp.status === 429) {
      throw new PublishError('RATE', 'X is rate-limiting cookie validation — try again in 60s');
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new PublishError(
        'NETWORK',
        `X cookie validation failed (${resp.status}): ${text.slice(0, 200)}`
      );
    }

    const data = (await resp.json()) as {
      id_str?: string;
      screen_name?: string;
      name?: string;
    };
    if (!data.id_str || !data.screen_name) {
      throw new PublishError(
        'NETWORK',
        'X verify_credentials returned no user id — response shape may have changed'
      );
    }

    return {
      identity: {
        id: data.id_str,
        username: `@${data.screen_name}`,
      },
      credentials: creds,
    };
  }

  /**
   * Publish a tweet via X's internal GraphQL CreateTweet endpoint.
   *
   * Endpoint: POST /i/api/graphql/{queryId}/CreateTweet
   *
   * Body shape (matches the x.com web client's exact payload):
   *   {
   *     variables: {
   *       tweet_text: string,
   *       dark_request: false,
   *       media: { media_entities: [], possibly_sensitive: false },
   *       semantic_annotation_ids: []
   *     },
   *     features: { ... ~25 feature flags ... }
   *   }
   *
   * The features object is required by X — without it, the request is
   * rejected with 400 "This field is required". We pass the same set
   * of feature flags the web client uses (verified against current
   * x.com behavior as of 2025-12).
   */
  async publish(
    credentials: AdapterCredentials,
    formatted: FormattedPost
  ): Promise<PublishResult> {
    const creds = credentials as XCookieCredentials;
    if (!creds.authToken || !creds.ct0) {
      throw new PublishError('AUTH', 'X cookie credentials missing — user must reconnect');
    }

    // Build tweet text — Format Engine already truncated to ≤280 chars
    // (counting t.co URLs as 23 chars per Twitter's display rules).
    const tagsLine =
      formatted.hashtags && formatted.hashtags.length > 0
        ? `\n${formatted.hashtags.map((t) => `#${t}`).join(' ')}`
        : '';
    const urlLine = formatted.url ? `\n${formatted.url}` : '';
    const text = `${formatted.body}${urlLine}${tagsLine}`.trim();

    if (text.length === 0) {
      throw new PublishError('VALIDATION', 'Tweet text is empty after formatting');
    }
    if (text.length > 280) {
      throw new PublishError(
        'VALIDATION',
        `Tweet exceeds 280 chars (got ${text.length}) — Format Engine truncation failed`
      );
    }

    // Fetch the current CreateTweet queryId (cached 1h)
    const queryId = await fetchCreateTweetQueryId();
    const endpoint = X_GRAPHQL_CREATE_TWEET.replace('{queryId}', queryId);

    // Build the GraphQL payload matching the x.com web client's exact shape.
    const payload = {
      variables: {
        tweet_text: text,
        dark_request: false,
        media: {
          media_entities: [] as Array<Record<string, unknown>>,
          possibly_sensitive: false,
        },
        semantic_annotation_ids: [] as string[],
      },
      features: {
        communities_web_enable_tweet_community_results_fetch: true,
        c9s_tweet_anatomy_moderator_badge_enabled: true,
        tweetypie_unmention_optimization_enabled: true,
        responsive_web_edit_tweet_api_enabled: true,
        graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
        view_counts_everywhere_api_enabled: true,
        longform_notetweets_consumption_enabled: true,
        responsive_web_twitter_article_tweet_consumption_enabled: true,
        tweet_awards_web_tipping_enabled: false,
        creator_subscriptions_quote_tweet_enabled: true,
        longform_notetweets_rich_text_read_enabled: true,
        longform_notetweets_inline_media_enabled: true,
        articles_preview_enabled: true,
        rweb_video_timestamps_enabled: true,
        rweb_tipjar_consumption_enabled: true,
        responsive_web_graphql_exclude_directive_enabled: true,
        verified_phone_label_enabled: false,
        freedom_of_speech_not_reach_fetch_enabled: true,
        standardized_nudges_misinfo: true,
        tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        responsive_web_graphql_timeline_navigation_enabled: true,
        responsive_web_enhance_cards_enabled: false,
      },
    };

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        ...buildXHeaders(creds),
        'content-type': 'application/json',
        accept: '*/*',
        'x-twitter-client-language': 'en',
        origin: 'https://x.com',
        referer: 'https://x.com/',
      },
      body: JSON.stringify(payload),
    });

    if (resp.status === 401 || resp.status === 403) {
      // X returns 403 with {"errors":[{"code":32,...}]} when the ct0
      // cookie doesn't match the x-csrf-token header, OR when the
      // auth_token has expired.
      const text = await resp.text();
      throw new PublishError(
        'AUTH',
        `X rejected the tweet (${resp.status}) — cookies may be expired: ${text.slice(0, 200)}`
      );
    }
    if (resp.status === 429) {
      throw new PublishError('RATE', 'X rate-limited the post — try again in a few minutes');
    }
    if (resp.status === 404) {
      // queryId may have rotated between fetchCreateTweetQueryId() and now
      cachedQueryId = null;
      throw new PublishError(
        'NETWORK',
        'X returned 404 — queryId cache was stale; the worker will retry with a fresh queryId'
      );
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new PublishError(
        'NETWORK',
        `X publish failed (${resp.status}): ${text.slice(0, 300)}`
      );
    }

    const data = (await resp.json()) as {
      data?: {
        create_tweet?: {
          tweet_results?: {
            result?: {
              rest_id?: string;
              core?: { user_results?: { result?: { legacy?: { screen_name?: string } } } };
            };
          };
        };
      };
      errors?: Array<{ message: string; code?: number }>;
    };

    if (data.errors && data.errors.length > 0) {
      const first = data.errors[0];
      // X returns error code 187 = "Status is a duplicate"
      // X returns error code 186 = "Tweet needs to be a bit shorter"
      if (first.code === 186) {
        throw new PublishError('VALIDATION', `X rejected tweet: ${first.message}`);
      }
      if (first.code === 187) {
        throw new PublishError('VALIDATION', `X rejected tweet (duplicate): ${first.message}`);
      }
      throw new PublishError(
        'VALIDATION',
        `X rejected tweet: ${first.message} (code ${first.code ?? 'unknown'})`
      );
    }

    const tweetId = data.data?.create_tweet?.tweet_results?.result?.rest_id;
    const screenName =
      data.data?.create_tweet?.tweet_results?.result?.core?.user_results?.result?.legacy
        ?.screen_name;

    if (!tweetId) {
      throw new PublishError(
        'NETWORK',
        'X returned success but no tweet rest_id — response shape may have changed'
      );
    }

    const username = screenName ?? 'i';
    return {
      id: tweetId,
      url: `https://x.com/${username}/status/${tweetId}`,
    };
  }
}
