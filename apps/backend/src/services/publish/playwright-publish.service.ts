// /home/z/my-project/netamplify-app/apps/backend/src/services/publish/playwright-publish.service.ts
// NetAmplify — Playwright-based publish for cookie platforms (Reddit, X).
//
// WHY PLAYWRIGHT (not Tauri WebView):
// Tauri uses WebKitGTK on Linux. Reddit's WAF fingerprints the TLS layer
// (JA3, HTTP/2 frame ordering) and detects WebKitGTK even when we spoof
// Chrome's User-Agent. Playwright spawns a real Chromium binary, which
// uses real BoringSSL TLS — same as Chrome. This passes Reddit's WAF.
//
// ARCHITECTURE:
//   1. Frontend calls POST /api/publish/reddit-cookie-web with formatted post
//   2. Backend spawns headless Chromium via Playwright
//   3. Sets the user's cookies on .reddit.com (from the encrypted vault)
//   4. Navigates to https://www.reddit.com/ (refreshes csrf_token + token_v2)
//   5. Reads the fresh csrf_token from document.cookie (JS-readable, not httpOnly)
//   6. Calls fetch('/api/submit.json', ...) from inside the page context
//      (same-origin → cookies sent automatically → real Chrome TLS)
//   7. Returns the post URL to the frontend
//
// Same approach for X (Twitter) — just different endpoint + headers.

import { Injectable, Logger } from '@nestjs/common';

export interface PlaywrightPublishRequest {
  cookies: Record<string, string>;
  formatted: {
    title: string;
    body: string;
    url?: string;
    hashtags?: string[];
    options?: Record<string, unknown>;
  };
}

export interface PlaywrightPublishResult {
  id: string;
  url: string;
  success: boolean;
  error?: string;
}

@Injectable()
export class PlaywrightPublishService {
  private readonly _logger = new Logger(PlaywrightPublishService.name);

  /**
   * Publish to Reddit via headless Chromium.
   *
   * The cookies must include `token_v2` (httpOnly session cookie) and
   * `csrf_token` (CSRF token). We pass them to Chromium's cookie store
   * so the browser sends them automatically with credentials: 'include'.
   */
  async publishToReddit(
    req: PlaywrightPublishRequest,
  ): Promise<PlaywrightPublishResult> {
    this._logger.log('Publishing to Reddit via Playwright (headless Chromium)');

    // Validate cookies
    if (!req.cookies.token_v2) {
      return {
        id: '',
        url: '',
        success: false,
        error:
          'Missing token_v2 cookie. Please Disconnect and click Auto-Capture again.',
      };
    }

    // Extract subreddit from options (default to 'test')
    const subreddit = String(
      req.formatted.options?.subreddit ?? 'test',
    ).replace(/^r\//, '');

    const isLinkPost = Boolean(req.formatted.url);
    const content = isLinkPost
      ? (req.formatted.url as string)
      : req.formatted.body;

    // Dynamic import — Playwright is an optional dependency. If the user
    // hasn't run `playwright install chromium` yet, we get a clear error
    // instead of a startup crash.
    let chromium: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pw = await import('playwright');
      chromium = pw.chromium;
    } catch (e) {
      return {
        id: '',
        url: '',
        success: false,
        error:
          'Playwright is not installed. Run: pnpm --filter ./apps/backend add playwright && pnpm --filter ./apps/backend exec playwright install chromium',
      };
    }

    let browser: any = null;
    try {
      // Launch headless Chromium with realistic Chrome args.
      // --disable-blink-features=AutomationControlled hides the
      // navigator.webdriver = true flag (a bot detection signal).
      browser = await chromium.launch({
        headless: true,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage', // important for Docker / low-RAM hosts
        ],
      });

      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        viewport: { width: 1366, height: 768 },
        locale: 'en-US',
      });

      // Set the user's cookies on .reddit.com
      // token_v2 is httpOnly — can ONLY be set via the browser context
      // (not via document.cookie in JS). This is why we need Playwright.
      const cookieList = Object.entries(req.cookies).map(([name, value]) => ({
        name,
        value,
        domain: '.reddit.com',
        path: '/',
        httpOnly: name === 'token_v2' || name === 'reddit_session',
        secure: true,
        sameSite: 'Lax' as const,
      }));
      await context.addCookies(cookieList);

      const page = await context.newPage();

      // Navigate to Reddit homepage. This refreshes the csrf_token + token_v2
      // via Set-Cookie headers — critical because the stored token_v2 may
      // be hours/days old and Reddit rotates it on every page load.
      this._logger.log('Navigating to https://www.reddit.com/ for cookie refresh');
      await page.goto('https://www.reddit.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // Wait for the page to fully load SPA (Reddit uses React)
      await page.waitForTimeout(2000);

      // Check if we got redirected to login (means token_v2 expired)
      const currentUrl = page.url();
      if (currentUrl.includes('login')) {
        return {
          id: '',
          url: '',
          success: false,
          error:
            'Reddit session expired. Please Disconnect and click Auto-Capture again.',
        };
      }

      // Read the FRESH csrf_token from document.cookie.
      // The csrf_token cookie is NOT httpOnly, so JS can read it.
      // We use page.evaluate to run this in the page context.
      const freshCsrfToken = await page.evaluate(() => {
        const match = document.cookie.match(/csrf_token=([^;]+)/);
        return match ? match[1] : '';
      });

      if (!freshCsrfToken || freshCsrfToken.length < 8) {
        return {
          id: '',
          url: '',
          success: false,
          error: `Failed to read fresh csrf_token from page (got length ${freshCsrfToken.length})`,
        };
      }

      this._logger.log(
        `Fresh csrf_token: ${freshCsrfToken.length} chars — making /api/submit call`,
      );

      // Make the publish request from INSIDE the page context.
      // This is the key: the request goes out with Chromium's real TLS
      // fingerprint + same-origin cookies (token_v2 + csrf_token).
      const result = await page.evaluate(
        async ({ subreddit, title, kind, content, csrfToken }) => {
          try {
            const enc = encodeURIComponent;
            const parts = [
              'api_type=json',
              'sr=' + enc(subreddit),
              'title=' + enc(title),
              'kind=' + enc(kind),
            ];
            if (kind === 'link') {
              parts.push('url=' + enc(content));
            } else {
              parts.push('text=' + enc(content));
            }
            const body = parts.join('&');

            // Use fetch() — inside real Chrome, fetch works perfectly
            // (no WebKitGTK DOMException issues here).
            const resp = await fetch(
              'https://www.reddit.com/api/submit.json' +
                '?app=reddit-web-v3&raw_json=1&ui_bot_mutation=false',
              {
                method: 'POST',
                headers: {
                  'x-csrf-token': csrfToken,
                  'content-type': 'application/x-www-form-urlencoded',
                  accept: 'application/json, text/plain, */*',
                  'accept-language': 'en-US,en;q=0.9',
                },
                body,
                credentials: 'include',
              },
            );

            const status = resp.status;
            const text = await resp.text();
            return { status, text: text.substring(0, 2000) };
          } catch (e: any) {
            return {
              status: 0,
              text: 'JS error: ' + (e?.message || String(e)),
            };
          }
        },
        {
          subreddit,
          title: req.formatted.title,
          kind: isLinkPost ? 'link' : 'self',
          content,
          csrfToken: freshCsrfToken,
        },
      );

      this._logger.log(
        `Reddit response: HTTP ${result.status} — ${result.text.substring(0, 200)}`,
      );

      // Parse the response
      if (result.status === 0) {
        return {
          id: '',
          url: '',
          success: false,
          error: result.text,
        };
      }

      if (result.status !== 200) {
        return {
          id: '',
          url: '',
          success: false,
          error: `Reddit HTTP ${result.status} — ${result.text.substring(0, 400)}`,
        };
      }

      // Try to parse JSON
      let data: any;
      try {
        data = JSON.parse(result.text);
      } catch (e) {
        return {
          id: '',
          url: '',
          success: false,
          error: `Reddit returned non-JSON (HTTP ${result.status}): ${result.text.substring(0, 300)}`,
        };
      }

      // Check for Reddit errors array
      const errors = data?.json?.errors;
      if (Array.isArray(errors) && errors.length > 0) {
        const errMsg = Array.isArray(errors[0])
          ? errors[0][1] || JSON.stringify(errors[0])
          : JSON.stringify(errors[0]);
        return {
          id: '',
          url: '',
          success: false,
          error: `Reddit: ${errMsg}`,
        };
      }

      // Extract post ID + URL
      const postId =
        data?.json?.data?.id || data?.json?.data?.name || '';
      const postUrl =
        data?.json?.data?.url ||
        (postId ? `https://www.reddit.com/comments/${postId}/` : '');

      if (!postId) {
        return {
          id: '',
          url: '',
          success: false,
          error: `No post ID in Reddit response: ${result.text.substring(0, 400)}`,
        };
      }

      return {
        id: postId,
        url: postUrl,
        success: true,
      };
    } catch (e: any) {
      this._logger.error(`Playwright publish failed: ${e?.message}`, e?.stack);
      return {
        id: '',
        url: '',
        success: false,
        error: `Playwright error: ${e?.message || String(e)}`,
      };
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Publish to X (Twitter) via headless Chromium.
   *
   * Same approach as Reddit — set cookies on .x.com, navigate to x.com,
   * then call fetch() to the CreateTweet GraphQL endpoint from the page.
   */
  async publishToX(
    req: PlaywrightPublishRequest,
  ): Promise<PlaywrightPublishResult> {
    this._logger.log('Publishing to X via Playwright (headless Chromium)');

    if (!req.cookies.auth_token || !req.cookies.ct0) {
      return {
        id: '',
        url: '',
        success: false,
        error:
          'Missing auth_token or ct0 cookie. Please Disconnect and click Auto-Capture again.',
      };
    }

    // Build tweet text (body + url + hashtags)
    const tagsLine =
      req.formatted.hashtags && req.formatted.hashtags.length > 0
        ? '\n' +
          req.formatted.hashtags.map((t) => `#${t}`).join(' ')
        : '';
    const urlLine = req.formatted.url ? '\n' + req.formatted.url : '';
    const tweetText = req.formatted.body + urlLine + tagsLine;

    if (tweetText.length > 280) {
      return {
        id: '',
        url: '',
        success: false,
        error: `Tweet exceeds 280 chars (got ${tweetText.length})`,
      };
    }

    // X's public Bearer token (shipped in x.com's main.js — not a secret)
    const X_BEARER =
      'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuAhw6TZR0YwqHvQ%3D' +
      'JqGisW7eT0YmZKb1iVpPu5pFgCqVQUO5WnLhQaLvO4';

    let chromium: any;
    try {
      const pw = await import('playwright');
      chromium = pw.chromium;
    } catch (e) {
      return {
        id: '',
        url: '',
        success: false,
        error: 'Playwright is not installed. Run: pnpm --filter ./apps/backend exec playwright install chromium',
      };
    }

    let browser: any = null;
    try {
      browser = await chromium.launch({
        headless: true,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
        ],
      });

      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        viewport: { width: 1366, height: 768 },
      });

      // Set X cookies on .x.com
      await context.addCookies([
        {
          name: 'auth_token',
          value: req.cookies.auth_token,
          domain: '.x.com',
          path: '/',
          httpOnly: true,
          secure: true,
          sameSite: 'Lax' as const,
        },
        {
          name: 'ct0',
          value: req.cookies.ct0,
          domain: '.x.com',
          path: '/',
          httpOnly: false,
          secure: true,
          sameSite: 'Lax' as const,
        },
      ]);

      const page = await context.newPage();

      this._logger.log('Navigating to https://x.com/home');
      await page.goto('https://x.com/home', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(3000);

      // Check if redirected to login
      const currentUrl = page.url();
      if (currentUrl.includes('login') || currentUrl.includes('flow/login')) {
        return {
          id: '',
          url: '',
          success: false,
          error: 'X session expired. Please Disconnect and click Auto-Capture again.',
        };
      }

      // Read ct0 from the page (the cookie may have rotated)
      const ct0 = await page.evaluate(() => {
        const match = document.cookie.match(/ct0=([^;]+)/);
        return match ? match[1] : '';
      });

      if (!ct0) {
        return {
          id: '',
          url: '',
          success: false,
          error: 'Failed to read ct0 from page',
        };
      }

      this._logger.log('Got ct0 — fetching main.js to find CreateTweet queryId');

      // Fetch the CreateTweet queryId from x.com's main.js bundle
      const queryId = await page.evaluate(
        async () => {
          try {
            const homeResp = await fetch('https://x.com/', {
              credentials: 'include',
            });
            const homeHtml = await homeResp.text();
            const mainJsMatch = homeHtml.match(
              /https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/main\.[a-z0-9]+\.js/,
            );
            if (!mainJsMatch) return '';

            const jsResp = await fetch(mainJsMatch[0]);
            const jsBody = await jsResp.text();
            const queryIdMatch = jsBody.match(
              /queryId:"([A-Za-z0-9_-]+)".*?operationName:"CreateTweet"/,
            );
            return queryIdMatch ? queryIdMatch[1] : '';
          } catch {
            return '';
          }
        },
      );

      if (!queryId) {
        return {
          id: '',
          url: '',
          success: false,
          error: 'Could not find CreateTweet queryId in x.com main.js',
        };
      }

      this._logger.log(`CreateTweet queryId: ${queryId}`);

      // Make the CreateTweet request from inside the page
      const result = await page.evaluate(
        async ({ queryId, tweetText, bearer, ct0 }) => {
          try {
            const payload = {
              variables: {
                tweet_text: tweetText,
                dark_request: false,
                media: { media_entities: [], possibly_sensitive: false },
                semantic_annotation_ids: [],
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
                creator_subscriptions_quote_tweet_enabled: true,
                longform_notetweets_rich_text_read_enabled: true,
                longform_notetweets_inline_media_enabled: true,
                rweb_video_timestamps_enabled: true,
                rweb_tipjar_consumption_enabled: true,
                responsive_web_graphql_exclude_directive_enabled: true,
                verified_phone_label_enabled: false,
                responsive_web_graphql_timeline_navigation_enabled: true,
                responsive_web_enhance_cards_enabled: false,
              },
            };

            const resp = await fetch(
              `https://x.com/i/api/graphql/${queryId}/CreateTweet`,
              {
                method: 'POST',
                headers: {
                  authorization: `Bearer ${bearer}`,
                  'x-csrf-token': ct0,
                  'x-twitter-auth-type': 'OAuth2Session',
                  'x-twitter-active-user': 'yes',
                  'content-type': 'application/json',
                },
                body: JSON.stringify(payload),
                credentials: 'include',
              },
            );

            const status = resp.status;
            const text = await resp.text();
            return { status, text: text.substring(0, 2000) };
          } catch (e: any) {
            return { status: 0, text: 'JS error: ' + (e?.message || String(e)) };
          }
        },
        { queryId, tweetText, bearer: X_BEARER, ct0 },
      );

      this._logger.log(
        `X response: HTTP ${result.status} — ${result.text.substring(0, 200)}`,
      );

      if (result.status !== 200) {
        return {
          id: '',
          url: '',
          success: false,
          error: `X HTTP ${result.status} — ${result.text.substring(0, 400)}`,
        };
      }

      let data: any;
      try {
        data = JSON.parse(result.text);
      } catch {
        return {
          id: '',
          url: '',
          success: false,
          error: `X returned non-JSON: ${result.text.substring(0, 300)}`,
        };
      }

      if (data.errors && data.errors.length > 0) {
        return {
          id: '',
          url: '',
          success: false,
          error: `X: ${data.errors[0].message}`,
        };
      }

      const tweetId = data?.data?.create_tweet?.tweet_results?.result?.rest_id;
      const screenName =
        data?.data?.create_tweet?.tweet_results?.result?.core?.user_results
          ?.result?.legacy?.screen_name || 'i';

      if (!tweetId) {
        return {
          id: '',
          url: '',
          success: false,
          error: `X returned success but no tweet ID: ${result.text.substring(0, 300)}`,
        };
      }

      return {
        id: tweetId,
        url: `https://x.com/${screenName}/status/${tweetId}`,
        success: true,
      };
    } catch (e: any) {
      this._logger.error(`Playwright X publish failed: ${e?.message}`, e?.stack);
      return {
        id: '',
        url: '',
        success: false,
        error: `Playwright error: ${e?.message || String(e)}`,
      };
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch {
          // ignore
        }
      }
    }
  }
}
