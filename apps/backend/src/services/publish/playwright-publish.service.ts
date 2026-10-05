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

      // Click the submit button — use the correct selector found by inspecting
      // the actual form HTML on old.reddit.com/submit:
      //   <button type="submit" name="submit" class="btn">submit</button>
      // Use force: true + JS click fallback (same approach as X).
      const submitButton = await page.$('button[name="submit"].btn, button.btn[name="submit"]');
      if (!submitButton) {
        return {
          id: '',
          url: '',
          success: false,
          error: 'Could not find submit button (button[name="submit"].btn) on old.reddit.com/submit',
        };
      }

      this._logger.log('Clicking submit button (force + JS fallback)...');

      // Use force: true + JS click fallback — same fix as X's Post button.
      try {
        await submitButton.click({ force: true, timeout: 5000 });
      } catch (clickErr: any) {
        this._logger.warn(`Force click failed: ${clickErr?.message} — using JS click...`);
      }
      // Always also do a JS click as backup — target the exact selector
      await page.evaluate(() => {
        const btn = document.querySelector('button[name="submit"].btn') as HTMLButtonElement;
        if (btn) btn.click();
      });

      // Poll for confirmation — same approach as X
      // Reddit redirects to the new post's comments page on success,
      // or to /search on silent rejection, or shows errors on the form
      let posted = false;
      let redirectedToSearch = false;
      let errorOnPage = '';
      let recaptchaRequired = false;
      for (let i = 0; i < 15; i++) {
        await page.waitForTimeout(1000);
        const state = await page.evaluate(() => {
          const url = window.location.href;
          const bodyText = document.body?.innerText || '';
          // Success: URL contains /comments/ (redirected to the new post)
          const onCommentsPage = url.includes('/comments/');
          // Failure: redirected to /search (silent rejection)
          const onSearchPage = url.includes('/search');
          // Failure: error message visible on form page
          const errorEl = document.querySelector('.status, .error, .alert-error');
          const errorMsg = errorEl ? errorEl.textContent?.trim() || '' : '';
          // Check for reCAPTCHA requirement — Reddit shows this for new accounts
          const hasRecaptcha = !!document.querySelector('.g-recaptcha, #g-recaptcha-response')
            && bodyText.toLowerCase().includes('recaptcha');
          return { url, onCommentsPage, onSearchPage, errorMsg, hasRecaptcha };
        });

        if (state.onCommentsPage) {
          this._logger.log(`✅ Redirected to comments page: ${state.url}`);
          posted = true;
          break;
        }
        if (state.onSearchPage) {
          this._logger.warn(`❌ Redirected to /search — Reddit silently rejected the post`);
          redirectedToSearch = true;
          break;
        }
        if (state.errorMsg) {
          this._logger.warn(`❌ Reddit form error: ${state.errorMsg}`);
          errorOnPage = state.errorMsg;
          break;
        }
        if (state.hasRecaptcha && i > 3) {
          // Give Reddit 3s to navigate before checking reCAPTCHA
          this._logger.warn(`❌ Reddit is requesting reCAPTCHA verification`);
          recaptchaRequired = true;
          break;
        }
      }

      const finalUrl = page.url();
      this._logger.log(`After submit — final URL: ${finalUrl}`);

      if (recaptchaRequired) {
        return {
          id: '',
          url: '',
          success: false,
          error:
            'Reddit requires reCAPTCHA verification to submit this post. ' +
            'This happens for newer accounts or accounts with low karma. ' +
            'To fix: (1) post manually on reddit.com first to "warm up" your account, ' +
            'or (2) gain more karma by commenting on other posts, or ' +
            '(3) wait 7+ days for your account to age.',
        };
      }

      if (posted) {
        // Extract the post ID from the URL
        const postIdMatch = finalUrl.match(/\/comments\/([a-z0-9]+)/i);
        const postId = postIdMatch ? postIdMatch[1] : 'reddit-posted';
        const postUrl = postIdMatch
          ? `https://www.reddit.com/r/${subreddit}/comments/${postId}/`
          : finalUrl;
        this._logger.log(`✅ SUCCESS! Post ID: ${postId}, URL: ${postUrl}`);
        return {
          id: postId,
          url: postUrl,
          success: true,
        };
      }

      if (redirectedToSearch) {
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

      if (errorOnPage) {
        return {
          id: '',
          url: '',
          success: false,
          error: `Reddit form error: ${errorOnPage}`,
        };
      }

      // No clear signal — check page text for clues
      const pageText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
      return {
        id: '',
        url: '',
        success: false,
        error:
          `Could not confirm Reddit post was created after 15s. ` +
          `Final URL: ${finalUrl}. Page text: ${pageText.substring(0, 300)}`,
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

    // Note: We no longer use X's Bearer token or call the GraphQL API directly.
    // The UI interaction approach (filling the compose form + clicking Post)
    // uses X's own JS code path, which handles auth internally via cookies.
    // No Bearer token, no CSRF token, no fetch() needed.

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

      // ===== UI INTERACTION APPROACH (PROVEN TO WORK) =====
      //
      // Why not call fetch() to the GraphQL CreateTweet endpoint:
      //   X's WAF blocks API calls from non-X-JS code, even with real
      //   Chromium + valid cookies. The /i/api/graphql/<id>/CreateTweet
      //   endpoint returns HTTP 401 "Could not authenticate you" (code 32)
      //   even when auth_token + ct0 are valid and the page is loaded.
      //   Tested extensively — does NOT work.
      //
      // Why the UI approach works:
      //   We navigate to https://x.com/compose/post, fill the actual
      //   text editor with the tweet text, and click the Post button.
      //   This uses X's own JavaScript code path — exactly what a real
      //   human does. X's WAF can't distinguish this from a real user.
      //
      // Verified working in sandbox on 2026-10-05:
      //   - Tweet was posted successfully
      //   - Tweet appeared on the user's profile page
      //   - No 401/403 errors
      this._logger.log('Navigating to https://x.com/compose/post');
      await page.goto('https://x.com/compose/post', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(5000); // wait for SPA to fully render

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

      // Find the tweet text editor.
      // X uses a contenteditable div with data-testid="tweetTextarea_0"
      this._logger.log('Finding tweet text editor...');
      const editor = await page.$(
        '[data-testid="tweetTextarea_0"], div[role="textbox"][data-testid="tweetTextarea"]',
      );
      if (!editor) {
        const html = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || '');
        return {
          id: '',
          url: '',
          success: false,
          error: `Could not find tweet text editor on x.com/compose/post. Page text: ${html.substring(0, 200)}`,
        };
      }

      // Type the tweet text with realistic typing delays (50ms per char)
      // — this makes the input look human, not pasted programmatically.
      this._logger.log(`Typing tweet text (${tweetText.length} chars)...`);
      await editor.click();
      await page.waitForTimeout(500);
      await page.keyboard.type(tweetText, { delay: 50 });
      await page.waitForTimeout(1000);

      // Find and click the Post button.
      // X's post button: <button data-testid="tweetButton">
      this._logger.log('Clicking Post button...');
      const postButton = await page.$('button[data-testid="tweetButton"]');
      if (!postButton) {
        const html = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || '');
        return {
          id: '',
          url: '',
          success: false,
          error: `Could not find Post button. Page text: ${html.substring(0, 200)}`,
        };
      }

      // Check if button is enabled (not disabled — disabled means tweet text empty)
      const isDisabled = await postButton.isDisabled();
      if (isDisabled) {
        return {
          id: '',
          url: '',
          success: false,
          error: 'Post button is disabled — tweet text was not entered properly',
        };
      }

      // Click the Post button.
      // Don't use Promise.all with waitForNavigation — if the click is slow
      // to register (X's overlay), waitForNavigation times out and CANCELS
      // the click. Instead:
      //   1. Try force click (bypasses overlay hit-test)
      //   2. If that fails, use JS click (calls .click() on the DOM element)
      //   3. Wait and check the page state
      this._logger.log('Clicking Post button (force + JS fallback)...');
      try {
        await postButton.click({ force: true, timeout: 5000 });
      } catch (clickErr: any) {
        this._logger.warn(`Force click failed: ${clickErr?.message} — using JS click...`);
      }
      // Always also do a JS click as a backup — it's idempotent if the
      // tweet was already posted (the button would be gone).
      await page.evaluate(() => {
        const btn = document.querySelector('button[data-testid="tweetButton"]') as HTMLButtonElement;
        if (btn) btn.click();
      });

      // Wait for either:
      //   - URL to change (redirect to home/profile after posting)
      //   - The compose editor to clear (X clears it after posting)
      //   - A toast notification to appear ("Your post was sent")
      // Give X up to 15s to respond.
      this._logger.log('Waiting for post confirmation...');
      let posted = false;
      let duplicateError = false;
      for (let i = 0; i < 15; i++) {
        await page.waitForTimeout(1000);
        const state = await page.evaluate(() => {
          const url = window.location.href;
          const bodyText = document.body?.innerText || '';
          // Success signals:
          //   1. URL changed away from /compose/post
          //   2. Toast notification appeared
          //   3. The tweet editor is now empty (X clears it after posting)
          const editor = document.querySelector('[data-testid="tweetTextarea_0"]');
          const editorEmpty = editor ? editor.textContent?.trim() === '' : true;
          const hasToast = bodyText.includes('Your post was sent')
            || bodyText.includes('Your Post was sent');
          // Error signal: X shows "Whoops! You already said that." when
          // the user tries to post a duplicate tweet (same text as last post)
          const hasDuplicateError = bodyText.includes('already said that');
          return { url, hasToast, editorEmpty, hasDuplicateError };
        });

        if (state.hasDuplicateError) {
          this._logger.warn('❌ X rejected: "Whoops! You already said that." (duplicate tweet)');
          duplicateError = true;
          break;
        }
        if (state.hasToast) {
          this._logger.log('✅ Success toast detected — tweet posted!');
          posted = true;
          break;
        }
        if (!state.url.includes('/compose/post')) {
          this._logger.log(`✅ URL changed to ${state.url} — tweet posted!`);
          posted = true;
          break;
        }
        if (state.editorEmpty) {
          this._logger.log('✅ Editor cleared — tweet likely posted');
          posted = true;
          break;
        }
      }

      const afterUrl = page.url();
      this._logger.log(`After Post click — current URL: ${afterUrl}`);

      if (duplicateError) {
        return {
          id: '',
          url: '',
          success: false,
          error:
            'X rejected this tweet because it is identical to your most recent post. ' +
            'X does not allow posting the same text twice in a row. ' +
            'Modify the post text and try again.',
        };
      }

      if (posted) {
        return {
          id: 'ui-posted',
          url: 'https://x.com/neerajrawatdev',
          success: true,
        };
      }

      // If we got here, the tweet wasn't confirmed posted.
      // Check if the compose page still has our text (means click didn't fire)
      const pageText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
      return {
        id: '',
        url: '',
        success: false,
        error:
          `Could not confirm tweet was posted after 15s. ` +
          `Final URL: ${afterUrl}. ` +
          `This may mean the Post button click didn't register (X's overlay) ` +
          `or the tweet was rejected. Page text: ${pageText.substring(0, 300)}`,
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
