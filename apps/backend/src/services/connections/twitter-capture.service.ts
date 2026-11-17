// /home/z/my-project/netamplify-app/apps/backend/src/services/connections/twitter-capture.service.ts
// NetAmplify — TwitterCaptureService.
//
// Launches a HEADFUL Playwright Chromium window to https://x.com/i/flow/login.
// The user logs in normally (username, password, 2FA, or Google SSO). We poll
// for the `auth_token` + `ct0` cookies every 2 seconds. When both are present,
// we also scrape the user's @username from the home page, then close the browser.
//
// Anti-bot-detection measures (X aggressively blocks automated browsers —
// without these, X shows "An unexpected error occurred. Please try again."
// inside Chromium during the Google SSO handoff, never sets the session
// cookies, and the capture silently times out):
//   1. launchPersistentContext with a stable user-data dir — X sees a real
//      browser profile (history + cookies persist), not a throwaway context.
//   2. No hardcoded userAgent — the previous Chrome/120 string mismatched the
//      bundled binary (Chrome 145), and a UA/version mismatch is a strong bot
//      signal. Let Playwright use the default UA that matches the binary.
//   3. addInitScript removes navigator.webdriver (the AutomationControlled flag
//      alone does NOT clear it; X checks this property).
//
// Diagnostic logging: during the 5-minute login wait, the backend logs the
// current URL, page title, cookie names, and detects X's bot-block error page
// every 10s — so a capture failure is NEVER silent (the previous code logged
// nothing between "Waiting for user to log in" and the timeout).
//
// Requirements:
//   - Backend must run on a machine with a display (X11/Wayland on Linux,
//     macOS, or Windows). On headless servers, this fails — use the manual
//     cookie input fallback.
//   - Playwright's chromium must be installed (postinstall script handles this).
//
// Security:
//   - The browser window is launched by the backend, on the backend's display.
//     The user's password is typed into x.com directly — NetAmplify NEVER sees
//     the password. We only read the resulting session cookies.
//   - Cookies are immediately encrypted via TokenVault before storage.
//   - The browser is closed as soon as cookies are captured — no lingering session.

import { Injectable, Logger } from '@nestjs/common';
import { chromium, type BrowserContext, type Page, type Cookie } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ServiceError } from '@netamplify/nestjs-libraries/services/error.mapper';
import { ensureChromiumAvailable } from '@netamplify/nestjs-libraries/platforms/x/chromium-binary';

/** Result of a successful Twitter capture session. */
export interface TwitterCaptureResult {
  /** The auth_token cookie value (40-char hex). */
  authToken: string;
  /** The ct0 cookie value (32-char hex, CSRF token). */
  ct0: string;
  /** The user's @username (e.g., "neerajrawatdev" — without the @). */
  username: string;
}

/** Maximum time to wait for the user to complete login (5 minutes). */
const CAPTURE_TIMEOUT_MS = 5 * 60 * 1000;

/** How often to poll for cookies (every 2 seconds). */
const POLL_INTERVAL_MS = 2000;

/** How often to log diagnostic state during the poll (every 10 seconds). */
const DIAGNOSTIC_LOG_INTERVAL_MS = 10_000;

@Injectable()
export class TwitterCaptureService {
  private readonly _logger = new Logger('TwitterCaptureService');

  /**
   * Launch a headful Chromium browser, navigate to x.com login, and wait for
   * the user to log in. Once `auth_token` + `ct0` cookies are present, extract
   * them + the user's @username, close the browser, and return the result.
   *
   * @throws ServiceError if:
   *   - Playwright fails to launch (no display, missing browser binary)
   *   - User doesn't log in within 5 minutes
   *   - User closes the browser before logging in
   *   - X blocks the login with its bot-detection error page
   */
  async captureSession(): Promise<TwitterCaptureResult> {
    this._logger.log('Launching headful Chromium for X (Twitter) login capture...');

    let context: BrowserContext | null = null;

    try {
      // Resolve a Chromium executable before launching. ensureChromiumAvailable
      // scans the Playwright cache + system PATH, and auto-installs via
      // `npx playwright install chromium` if nothing is found.
      let executablePath: string | undefined;
      try {
        executablePath = ensureChromiumAvailable(this._logger);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new ServiceError('INTERNAL', msg);
      }

      // Persistent user-data dir — X sees a real browser profile (history,
      // cookies, saved logins persist across capture attempts). This is the
      // single biggest reducer of X's "An unexpected error occurred" bot-block
      // on the Google SSO login handoff: a fresh newContext() every run is
      // trivially detected as automated; a persistent profile is not.
      const userDataDir = path.join(os.homedir(), '.netamplify', 'chromium-profile-x');
      fs.mkdirSync(userDataDir, { recursive: true });

      // Launch headful persistent Chromium. NO custom userAgent — the previous
      // hardcoded Chrome/120 string mismatched the bundled binary (Chrome 145),
      // and a UA/version mismatch is a strong bot signal that X uses to block
      // the Google SSO login. Let Playwright use the default UA that matches
      // the launched binary.
      context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        ...(executablePath ? { executablePath } : {}),
        viewport: { width: 1280, height: 800 },
        locale: 'en-US',
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-features=AutomationControlled,IsolateOrigins,site-per-process',
          '--disable-dev-shm-usage',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-infobars',
        ],
      });

      // Remove navigator.webdriver. --disable-blink-features=AutomationControlled
      // hides the "Chrome is being controlled by automated software" banner but
      // does NOT clear navigator.webdriver (which X checks). This init script
      // runs before any page script on every navigation.
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });

      this._logger.log(`Chromium launched (headful, persistent profile: ${userDataDir})`);

      const page = await context.newPage();

      // Navigate to X's login flow
      this._logger.log('Navigating to https://x.com/i/flow/login ...');
      await page.goto('https://x.com/i/flow/login', {
        waitUntil: 'domcontentloaded',
        timeout: 60000, // 60s — x.com can be slow to load
      });

      // Detect if the browser was closed by the user before login completed.
      // captureComplete is set to true right before the success return, so the
      // close handler (which ALSO fires when we close the browser ourselves in
      // the finally block after a successful capture) doesn't log a spurious
      // "User closed the browser window before login completed" WARN right
      // after "✓ Capture complete".
      let userClosedBrowser = false;
      let captureComplete = false;
      page.on('close', () => {
        userClosedBrowser = true;
        if (!captureComplete) {
          this._logger.warn('User closed the browser window before login completed');
        }
      });

      // Poll for auth_token + ct0 cookies.
      // X sets these cookies ONLY after the user successfully logs in.
      // - auth_token: long-lived session token (~1 year)
      // - ct0: CSRF token (rotates per session)
      this._logger.log(
        `Waiting for user to log in (timeout: ${CAPTURE_TIMEOUT_MS / 1000}s, polling every ${POLL_INTERVAL_MS / 1000}s)...`,
      );

      const startTime = Date.now();
      let authToken = '';
      let ct0 = '';
      let lastDiagnosticLog = 0;

      while (Date.now() - startTime < CAPTURE_TIMEOUT_MS) {
        if (userClosedBrowser) {
          throw new ServiceError(
            'VALIDATION_ERROR',
            'You closed the browser window before logging in. Please try again and complete the login.',
          );
        }

        // Get all cookies for .x.com / .twitter.com domains
        const cookies = await context.cookies('https://x.com');
        for (const cookie of cookies) {
          if (cookie.name === 'auth_token' && cookie.value) {
            authToken = cookie.value;
          }
          if (cookie.name === 'ct0' && cookie.value) {
            ct0 = cookie.value;
          }
        }

        if (authToken && ct0) {
          this._logger.log('✓ auth_token + ct0 cookies captured');
          break;
        }

        // Diagnostic logging every ~10s so the backend is NEVER silent during
        // the 5-min wait. Logs current URL, page title, cookie names, AND
        // detects X's bot-block error page ("An unexpected error occurred.
        // Please try again.") — the #1 cause of silent capture failures. X
        // shows its own error page inside Chromium, cookies never get set, and
        // without this log the failure is completely invisible.
        const now = Date.now();
        if (now - lastDiagnosticLog >= DIAGNOSTIC_LOG_INTERVAL_MS) {
          lastDiagnosticLog = now;
          await this._logDiagnosticState(page, cookies, now - startTime);
        }

        // Wait before polling again
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }

      if (!authToken || !ct0) {
        // Log the final browser state so the user can see WHY it timed out.
        await this._logFinalState(page);
        throw new ServiceError(
          'VALIDATION_ERROR',
          `Login timed out after ${CAPTURE_TIMEOUT_MS / 1000}s — auth_token + ct0 cookies were never set. ` +
            `X likely blocked the login (bot detection) or you didn't complete the login. ` +
            `Try again, or use username+password instead of Google SSO, or use the manual cookie input fallback. ` +
            `See backend [capture poll] / [capture timeout] logs for the browser state.`,
        );
      }

      // Now that we have the cookies, scrape the user's @username from x.com/home.
      // The home page has a link like <a href="/neerajrawatdev"> in the side nav.
      this._logger.log('Capturing @username from x.com/home ...');
      let username = '';

      try {
        // Navigate to home — we're already logged in (cookies are in the context)
        await page.goto('https://x.com/home', {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        // Wait a bit for the page to render the side nav
        await page.waitForTimeout(3000);

        const usernameSelectors = [
          // Primary: the side nav profile link
          'a[data-testid="AppTabBar_Profile_Link"]',
          // Fallback: any link with href="/<username>" (no slashes after)
          'a[role="link"][href^="/"][href*=""]',
        ];

        for (const selector of usernameSelectors) {
          try {
            const link = await page.$(selector);
            if (link) {
              const href = await link.getAttribute('href');
              if (href) {
                // href is like "/neerajrawatdev" — strip the leading /
                const candidate = href.replace(/^\//, '').split('/')[0];
                if (candidate && !candidate.includes('?') && candidate.length > 0) {
                  username = candidate;
                  this._logger.log(`✓ Username captured from ${selector}: @${username}`);
                  break;
                }
              }
            }
          } catch {
            // Try next selector
          }
        }

        // If we still don't have the username, try the account switcher button
        if (!username) {
          try {
            const accountBtn = await page.$('[data-testid="SideNav_AccountSwitcher_Button"]');
            if (accountBtn) {
              const ariaLabel = await accountBtn.getAttribute('aria-label');
              // aria-label is like "Account menu, @neerajrawatdev" or "Account menu, Neeraj Rawat"
              if (ariaLabel) {
                const match = ariaLabel.match(/@([a-zA-Z0-9_]+)/);
                if (match) {
                  username = match[1];
                  this._logger.log(`✓ Username captured from account switcher: @${username}`);
                }
              }
            }
          } catch {
            // ignore
          }
        }
      } catch (e) {
        this._logger.warn(
          `Failed to scrape @username (non-fatal): ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      if (!username) {
        // Username scraping is non-fatal — we still have valid cookies.
        // Use a placeholder; the publish flow will work regardless.
        username = 'X user';
        this._logger.warn('Could not scrape @username — using placeholder "X user"');
      }

      captureComplete = true;
      this._logger.log(`✓ Capture complete: @${username}`);
      return { authToken, ct0, username };
    } catch (e) {
      // Re-throw ServiceError as-is
      if (e instanceof ServiceError) {
        throw e;
      }
      // Wrap other errors
      const msg = e instanceof Error ? e.message : String(e);
      this._logger.error(`Capture failed: ${msg}`);
      if (msg.includes('Missing X server') || msg.includes('DISPLAY') || msg.includes('headless')) {
        throw new ServiceError(
          'VALIDATION_ERROR',
          'Auto-capture requires a desktop display. If running on a server, use the manual cookie input instead.',
        );
      }
      throw new ServiceError('INTERNAL', `Twitter capture failed: ${msg}`);
    } finally {
      // Always close the context (saves the persistent profile), even on error
      if (context) {
        try {
          await context.close();
          this._logger.log('Chromium closed');
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Log the current browser state during the login poll: URL, page title,
   * cookie names present, elapsed time. Also detects X's bot-block error page
   * ("An unexpected error occurred. Please try again.") and throws a clear
   * ServiceError so the failure is visible + actionable instead of a silent
   * 5-minute timeout.
   */
  private async _logDiagnosticState(
    page: Page,
    cookies: Cookie[],
    elapsedMs: number,
  ): Promise<void> {
    let url = '<unknown>';
    let title = '<no title>';
    let bodyText = '';
    try {
      url = page.url();
      title = await page.title();
      bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 600) ?? '');
    } catch {
      // page navigated / closed mid-evaluate — log what we have
    }

    const cookieNames = cookies.map((c) => c.name).join(',') || '<none>';
    this._logger.log(
      `[capture poll] url=${url}\n` +
        `  title="${title}"\n` +
        `  cookies=[${cookieNames}]\n` +
        `  elapsed=${Math.round(elapsedMs / 1000)}s`,
    );

    // Detect X's bot-block / error page. X shows "An unexpected error occurred.
    // Please try again." inside Chromium when it detects the automated browser
    // and refuses to complete the (Google SSO) login. Cookies are never set.
    if (
      bodyText.includes('An unexpected error occurred') ||
      bodyText.includes('Something went wrong. Try reloading.')
    ) {
      this._logger.error(
        `[capture] X is showing a bot-block / error page inside Chromium:\n` +
          `  "${bodyText.replace(/\s+/g, ' ').slice(0, 250)}"\n` +
          `  This is X detecting the automated browser and refusing to complete login. ` +
          `auth_token + ct0 will never be set. Aborting.`,
      );
      throw new ServiceError(
        'VALIDATION_ERROR',
        'X (Twitter) blocked the login inside the browser window with "An unexpected error ' +
          'occurred. Please try again." — this is X\'s bot detection on the automated Chromium. ' +
          'Try again (the persistent profile + stealth flags reduce detection), or log in with ' +
          'username + password instead of Google SSO (Google SSO is more aggressively blocked), ' +
          'or use the manual cookie input fallback (paste auth_token + ct0 directly).',
      );
    }
  }

  /**
   * Log the final browser state when the capture times out, so the user can see
   * what state the browser was in (on the login form? on Google SSO? on X's
   * error page?) instead of just a bare "timed out" message.
   */
  private async _logFinalState(page: Page): Promise<void> {
    try {
      const url = page.url();
      const title = await page.title();
      this._logger.error(
        `[capture timeout] auth_token/ct0 never captured.\n` +
          `  Final browser state: url=${url}, title="${title}"\n` +
          `  Most common cause: X blocked the login (bot detection) — review the [capture poll] ` +
          `logs above. If the URL was on accounts.google.com, the Google SSO handoff didn't complete.`,
      );
    } catch {
      this._logger.error('[capture timeout] auth_token/ct0 never captured (browser already closed)');
    }
  }
}
