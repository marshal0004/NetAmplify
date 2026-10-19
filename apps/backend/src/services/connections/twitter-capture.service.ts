// /home/z/my-project/netamplify-app/apps/backend/src/services/connections/twitter-capture.service.ts
// NetAmplify — TwitterCaptureService.
//
// Launches a HEADFUL Playwright Chromium window to https://x.com/i/flow/login.
// The user logs in normally (username, password, 2FA if needed). We poll for
// the `auth_token` + `ct0` cookies every 2 seconds. When both are present, we
// also scrape the user's @username from the home page, then close the browser.
//
// This is the same UX as Postiz: one click → browser opens → user logs in →
// cookies auto-captured → "Connected as @username".
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
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { ServiceError } from '@netamplify/nestjs-libraries/services/error.mapper';

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
   */
  async captureSession(): Promise<TwitterCaptureResult> {
    this._logger.log('Launching headful Chromium for X (Twitter) login capture...');

    let browser: Browser | null = null;
    let context: BrowserContext | null = null;

    try {
      // Launch headful Chromium. We use headful so the user can see + interact
      // with the login form. Playwright's chromium.launch() defaults to headless
      // — we explicitly set headless: false.
      browser = await chromium.launch({
        headless: false,
        args: [
          '--disable-blink-features=AutomationControlled', // hide "Chrome is being controlled by automated software" banner
          '--no-first-run',
          '--no-default-browser-check',
        ],
      });
      this._logger.log('Chromium launched (headful)');

      // Create a new browser context (separate from any existing sessions)
      context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        locale: 'en-US',
        // X's login page doesn't work well with a mobile user agent
        userAgent:
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });

      const page = await context.newPage();

      // Navigate to X's login flow
      this._logger.log('Navigating to https://x.com/i/flow/login ...');
      await page.goto('https://x.com/i/flow/login', {
        waitUntil: 'domcontentloaded',
        timeout: 60000, // 60s — x.com can be slow to load
      });

      // Detect if the browser was closed by the user before login completed.
      // page.on('close', ...) fires when the user closes the tab/window.
      let userClosedBrowser = false;
      page.on('close', () => {
        userClosedBrowser = true;
        this._logger.warn('User closed the browser window before login completed');
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

        // Wait before polling again
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }

      if (!authToken || !ct0) {
        throw new ServiceError(
          'VALIDATION_ERROR',
          `Login timed out after ${CAPTURE_TIMEOUT_MS / 1000}s. Please try again and complete the login within 5 minutes.`,
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

        // The side nav has a link to the user's profile: <a href="/username">
        // The link is inside an <a> element with role="link" and aria-label containing the username.
        // Try multiple selectors.
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
      // Always close the browser, even on error
      if (browser) {
        try {
          await browser.close();
          this._logger.log('Chromium closed');
        } catch {
          // ignore
        }
      }
    }
  }
}
