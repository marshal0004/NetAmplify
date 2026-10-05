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
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

/**
 * Find an available Chromium binary on the system.
 *
 * Searches in this order:
 *   1. Playwright cache (~/.cache/ms-playwright/chromium-XXXX/chrome-linux64/chrome)
 *   2. Playwright headless shell cache (~/.cache/ms-playwright/chromium_headless_shell-XXXX/...)
 *   3. System-installed Chromium/Chrome (via `which` command)
 *   4. Common system binary paths (/usr/bin/chromium, /usr/bin/google-chrome, etc.)
 *
 * Returns the first binary found that exists and is executable.
 */
function findChromiumBinary(): string | undefined {
  const candidates: string[] = [];

  // 1. Scan Playwright cache directory
  const cacheDir = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (fs.existsSync(cacheDir)) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(cacheDir);
    } catch {
      // ignore
    }

    for (const entry of entries) {
      // Headless shell variants (preferred — smaller, faster)
      if (entry.startsWith('chromium_headless_shell-')) {
        candidates.push(path.join(cacheDir, entry, 'chrome-headless-shell-linux64', 'chrome-headless-shell'));
        candidates.push(path.join(cacheDir, entry, 'chrome-headless-shell-mac', 'chrome-headless-shell'));
      }
      // Full chromium variants (fallback — works for headless too)
      if (entry.startsWith('chromium-') && !entry.includes('headless')) {
        candidates.push(path.join(cacheDir, entry, 'chrome-linux64', 'chrome'));
        candidates.push(path.join(cacheDir, entry, 'chrome-linux', 'chrome'));
        candidates.push(path.join(cacheDir, entry, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'));
      }
    }
  }

  // 2. System-installed browsers via `which` (most reliable on Linux)
  //    On Arch: `sudo pacman -S chromium` installs to /usr/bin/chromium
  //    On Ubuntu: `apt install chromium-browser` installs to /usr/bin/chromium-browser
  //    Google Chrome: installs to /usr/bin/google-chrome or /usr/bin/google-chrome-stable
  const systemBins = [
    'chromium',
    'chromium-browser',
    'google-chrome',
    'google-chrome-stable',
    'google-chrome-beta',
    'brave-browser',
  ];
  for (const bin of systemBins) {
    try {
      // `which <bin>` returns the path if found, exits non-zero if not
      const found = execSync(`which ${bin} 2>/dev/null`, { encoding: 'utf-8' }).trim();
      if (found) candidates.push(found);
    } catch {
      // not installed
    }
  }

  // 3. Hardcoded common system paths (fallback if `which` fails)
  candidates.push('/usr/bin/chromium');
  candidates.push('/usr/bin/chromium-browser');
  candidates.push('/usr/bin/google-chrome');
  candidates.push('/usr/bin/google-chrome-stable');
  candidates.push('/snap/bin/chromium');
  candidates.push('/opt/google/chrome/chrome');
  candidates.push('/opt/chromium/chrome');

  // Return the first existing + executable binary
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        // Check if executable (fs.accessSync throws if not)
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      }
    } catch {
      // Not executable, try next
    }
  }

  return undefined;
}

/**
 * List the contents of the Playwright cache directory for debugging.
 * Returns a string describing what was found (or not found).
 */
function describePlaywrightCache(): string {
  const cacheDir = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (!fs.existsSync(cacheDir)) {
    return `Playwright cache dir does not exist: ${cacheDir}`;
  }

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(cacheDir);
  } catch (e) {
    return `Cannot read Playwright cache dir ${cacheDir}: ${e}`;
  }

  if (entries.length === 0) {
    return `Playwright cache dir is empty: ${cacheDir}`;
  }

  const lines = [`Playwright cache dir ${cacheDir} contains:`];
  for (const entry of entries) {
    const entryPath = path.join(cacheDir, entry);
    // Try to list one level deep
    try {
      const subEntries = fs.readdirSync(entryPath);
      lines.push(`  ${entry}/ → [${subEntries.slice(0, 5).join(', ')}${subEntries.length > 5 ? ', ...' : ''}]`);
    } catch {
      lines.push(`  ${entry}/ (cannot read)`);
    }
  }
  return lines.join('\n');
}

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
      // Find any available chromium binary on the system.
      // Playwright's default lookup looks for chrome-headless-shell, but
      // `playwright install chromium` may only install the full chromium.
      // We pass executablePath explicitly to use whichever is available.
      const executablePath = findChromiumBinary();
      if (executablePath) {
        this._logger.log(`Using Chromium binary: ${executablePath}`);
      } else {
        this._logger.warn(
          'No Chromium binary found in Playwright cache OR system paths.\n' +
          describePlaywrightCache() +
          '\nTo fix:\n' +
          '  Option A: Run `pnpm --filter ./apps/backend exec playwright install chromium`\n' +
          '  Option B (Arch Linux): Run `sudo pacman -S chromium`',
        );
      }

      // Launch headless Chromium with realistic Chrome args.
      // --disable-blink-features=AutomationControlled hides the
      // navigator.webdriver = true flag (a bot detection signal).
      browser = await chromium.launch({
        headless: true,
        ...(executablePath ? { executablePath } : {}),
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

      // ===== NEW STRATEGY: Fill the actual form on old.reddit.com/submit =====
      //
      // The previous approach (calling fetch('/api/submit.json') from the page
      // context) was returning HTTP 403 even with real Chromium. Reddit's WAF
      // specifically blocks programmatic POST requests to /api/submit — even
      // from real Chrome with real cookies.
      //
      // This new approach navigates to old.reddit.com/submit and fills in the
      // actual HTML form like a human would:
      //   1. Navigate to https://old.reddit.com/submit
      //   2. Fill in the title input field
      //   3. Fill in the text textarea (or url input for link posts)
      //   4. Fill in the subreddit field
      //   5. Click the "submit" button
      //   6. Wait for the browser to navigate to the new post's page
      //   7. Extract the post URL from the final page URL
      //
      // old.reddit.com uses a traditional server-rendered HTML form. When the
      // user clicks "submit", the browser makes a native form POST — not a
      // fetch() call. Reddit's WAF can't distinguish this from a real human
      // because it IS a real browser doing a real form submission.
      //
      // The cookies (token_v2, csrf_token, reddit_session) work on
      // old.reddit.com because they're set on the .reddit.com domain.
      this._logger.log('Navigating to https://old.reddit.com/submit for form submission');

      await page.goto('https://old.reddit.com/submit', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(2000);

      // Check if redirected to login
      const submitUrl = page.url();
      if (submitUrl.includes('login')) {
        return {
          id: '',
          url: '',
          success: false,
          error:
            'Reddit session expired (redirected to login on old.reddit.com). Please reconnect.',
        };
      }

      this._logger.log(`On submit page: ${submitUrl}`);

      // Verify we're logged in by checking for the user's username in the page
      const isLoggedIn = await page.evaluate(() => {
        // old.reddit.com shows "logout" link when logged in
        return !!document.querySelector('form[action="/logout"]')
          || !!document.querySelector('span.user a');
      });

      if (!isLoggedIn) {
        return {
          id: '',
          url: '',
          success: false,
          error: 'Not logged in on old.reddit.com — cookies may be invalid. Please reconnect.',
        };
      }

      this._logger.log('Logged in on old.reddit.com — filling form');

      // Select the post type — old.reddit.com uses <input type="radio" name="kind">
      // but they're hidden (display:none) — wrapped in <label> elements that
      // act as the visible buttons. We need to click the LABEL, not the input.
      //
      // HTML structure:
      //   <input type="radio" name="kind" value="link" id="link" style="display:none">
      //   <label for="link">Link</label>
      //   <input type="radio" name="kind" value="self" id="self" style="display:none">
      //   <label for="self">Text</label>
      //
      // Alternative: set the radio's checked property via JS (bypasses visibility check)
      const kindValue = isLinkPost ? 'link' : 'self';
      const kindSet = await page.evaluate((val) => {
        const radio = document.querySelector(`input[name="kind"][value="${val}"]`) as HTMLInputElement;
        if (!radio) return false;
        radio.checked = true;
        radio.click(); // also fire the click event so any JS listeners run
        return true;
      }, kindValue);

      if (kindSet) {
        this._logger.log(`Selected post type: ${kindValue} (via JS)`);
        await page.waitForTimeout(500); // let the form update
      } else {
        this._logger.warn('Kind radio not found — proceeding anyway');
      }

      // Fill the subreddit field
      // old.reddit.com/submit has a text input with name="sr" or name="subreddit"
      // (depends on the version). Some versions also use a dropdown.
      const srField = await page.$('input[name="sr"], input[name="subreddit"]');
      if (srField) {
        await srField.fill(subreddit);
        this._logger.log(`Filled subreddit: ${subreddit}`);
        // Trigger the subreddit validation by pressing Tab
        await srField.press('Tab');
        await page.waitForTimeout(1000);
      } else {
        this._logger.warn('Subreddit field not found — may need to select from dropdown');
      }

      // Fill the title field
      const titleField = await page.$('input[name="title"], textarea[name="title"]');
      if (titleField) {
        await titleField.fill(req.formatted.title);
        this._logger.log(`Filled title: ${req.formatted.title}`);
      } else {
        return {
          id: '',
          url: '',
          success: false,
          error: 'Could not find title field on old.reddit.com/submit',
        };
      }

      // Fill the content field (text for self posts, url for link posts)
      if (isLinkPost) {
        const urlField = await page.$('input[name="url"]');
        if (urlField) {
          await urlField.fill(content);
          this._logger.log(`Filled URL: ${content}`);
        }
      } else {
        const textField = await page.$('textarea[name="text"], textarea[name="selftext"]');
        if (textField) {
          await textField.fill(content);
          this._logger.log('Filled text content');
        }
      }

      // Click the submit button — but make sure we click the RIGHT one.
      // old.reddit.com/submit has multiple buttons (sidebar search, etc).
      // The actual submit button is inside the main form#newlink
      // with name="submit" or type="submit" inside div.formtabs.
      const submitButton = await page.$(
        'form#newlink button[type="submit"], ' +
        'form#newlink input[type="submit"], ' +
        'div.formtabs button[type="submit"], ' +
        'button.c-btn-primary[name="submit"], ' +
        'button.btn[name="submit"]',
      );
      if (!submitButton) {
        return {
          id: '',
          url: '',
          success: false,
          error: 'Could not find submit button on old.reddit.com/submit form',
        };
      }

      this._logger.log('Clicking submit button...');

      // Click the button and wait for navigation to the post page
      // After a successful submit, old.reddit.com redirects to:
      //   https://old.reddit.com/r/SUBREDDIT/comments/POST_ID/TITLE/
      // If Reddit rejects, it redirects to /search?q= or shows errors
      try {
        await Promise.all([
          page.waitForNavigation({ timeout: 30000, waitUntil: 'domcontentloaded' }),
          submitButton.click(),
        ]);
      } catch (navErr: any) {
        // Navigation may not happen if the form has client-side validation errors
        const pageText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
        return {
          id: '',
          url: '',
          success: false,
          error: `Form submission failed: ${navErr?.message}. Page text: ${pageText.substring(0, 300)}`,
        };
      }

      const finalUrl = page.url();
      this._logger.log(`After submit — navigated to: ${finalUrl}`);

      // Check for error messages on the page (Reddit sometimes shows errors
      // instead of redirecting)
      const errorMessage = await page.evaluate(() => {
        // old.reddit.com shows errors in .status or .error elements
        const errorEl = document.querySelector('.status, .error, .alert-error');
        return errorEl ? errorEl.textContent?.trim() : '';
      });

      if (errorMessage && errorMessage.length > 0) {
        return {
          id: '',
          url: '',
          success: false,
          error: `Reddit form error: ${errorMessage}`,
        };
      }

      // Check if we ended up on /search — this means Reddit rejected the post
      // silently and redirected to search instead of showing an error
      if (finalUrl.includes('/search')) {
        const pageText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
        return {
          id: '',
          url: '',
          success: false,
          error:
            `Reddit silently rejected the post and redirected to /search. ` +
            `This usually means the subreddit doesn't allow posts from your ` +
            `account (account too new, low karma, or subreddit requires approval). ` +
            `Try r/test (which allows anyone to post) or wait 24h for account aging. ` +
            `Final URL: ${finalUrl}`,
        };
      }

      // Extract the post ID from the URL
      // URL format: https://old.reddit.com/r/SUBREDDIT/comments/POST_ID/POST_TITLE/
      const postIdMatch = finalUrl.match(/\/comments\/([a-z0-9]+)/i);
      if (!postIdMatch) {
        // Maybe we're on an error page — check the page content
        const pageText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
        return {
          id: '',
          url: '',
          success: false,
          error: `Could not extract post ID from URL: ${finalUrl}. Page text: ${pageText.substring(0, 300)}`,
        };
      }

      const postId = postIdMatch[1];
      const postUrl = `https://www.reddit.com/r/${subreddit}/comments/${postId}/`;

      this._logger.log(`✅ SUCCESS! Post ID: ${postId}, URL: ${postUrl}`);

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
      // Find any available chromium binary on the system (see publishToReddit
      // for full explanation — Playwright's default lookup may fail).
      const executablePath = findChromiumBinary();
      if (executablePath) {
        this._logger.log(`Using Chromium binary: ${executablePath}`);
      } else {
        this._logger.warn(
          'No Chromium binary found in Playwright cache OR system paths.\n' +
          describePlaywrightCache() +
          '\nTo fix:\n' +
          '  Option A: Run `pnpm --filter ./apps/backend exec playwright install chromium`\n' +
          '  Option B (Arch Linux): Run `sudo pacman -S chromium`',
        );
      }

      browser = await chromium.launch({
        headless: true,
        ...(executablePath ? { executablePath } : {}),
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
      // auth_token is httpOnly so JS can't read it — we MUST set it via
      // context.addCookies (Playwright's API). Once set, it'll be sent
      // automatically with every request.
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
      await page.waitForTimeout(5000); // wait longer for SPA to load + rotate ct0

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

      // Read the FRESH ct0 from the page after navigation.
      // X rotates ct0 on every page load. The stored ct0 we set via addCookies
      // may be stale — X replaces it with a fresh one when the page loads.
      // We MUST use this fresh ct0 in the x-csrf-token header, otherwise
      // X returns HTTP 401 "Could not authenticate you" (code 32).
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
                  'x-twitter-client-language': 'en',
                  'content-type': 'application/json',
                  accept: '*/*',
                  'accept-language': 'en-US,en;q=0.9',
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
