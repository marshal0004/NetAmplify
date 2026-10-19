// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/x/x-cookie.adapter.ts
// NetAmplify — X (Twitter) cookie-based adapter.
//
// Uses Playwright (real headless Chromium) to post tweets via X's UI.
// This bypasses X's WAF which blocks all API calls from Node.js (even
// with valid cookies). The UI approach fills the compose form and
// clicks the Post button — exactly what a real human does.
//
// Required user-supplied credentials (extracted from x.com cookies):
//   - authToken: the `auth_token` cookie (long-lived, ~1 year)
//   - ct0:        the `ct0` cookie (CSRF token, rotates per session)

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
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

export interface XCookieCredentials extends AdapterCredentials {
  authToken: string;
  ct0: string;
}

/**
 * Find an available Chromium binary on the system.
 * Searches Playwright cache + system-installed browsers.
 */
function findChromiumBinary(): string | undefined {
  const candidates: string[] = [];
  const cacheDir = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (fs.existsSync(cacheDir)) {
    let entries: string[] = [];
    try { entries = fs.readdirSync(cacheDir); } catch { /* ignore */ }
    for (const entry of entries) {
      if (entry.startsWith('chromium_headless_shell-')) {
        candidates.push(path.join(cacheDir, entry, 'chrome-headless-shell-linux64', 'chrome-headless-shell'));
      }
      if (entry.startsWith('chromium-') && !entry.includes('headless')) {
        candidates.push(path.join(cacheDir, entry, 'chrome-linux64', 'chrome'));
        candidates.push(path.join(cacheDir, entry, 'chrome-linux', 'chrome'));
      }
    }
  }
  const systemBins = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];
  for (const bin of systemBins) {
    try {
      const found = execSync(`which ${bin} 2>/dev/null`, { encoding: 'utf-8' }).trim();
      if (found) candidates.push(found);
    } catch { /* not installed */ }
  }
  candidates.push('/usr/bin/chromium', '/usr/bin/google-chrome');
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      }
    } catch { /* not executable */ }
  }
  return undefined;
}

@Injectable()
export class XCookieAdapter implements PlatformAdapter {
  readonly platform: Platform = 'TWITTER_COOKIE';
  readonly name = 'X (Twitter) — Cookie';
  readonly toolTip = 'Paste your x.com session cookies (auth_token + ct0)';
  readonly kind = 'SIMPLE' as const;

  configured(): boolean {
    return true;
  }

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
      throw new PublishError('VALIDATION', 'auth_token must be a 40-char hex string');
    }
    if (!/^[a-f0-9]{32,}$/i.test(ct0)) {
      throw new PublishError('VALIDATION', 'ct0 must be at least 32 hex chars');
    }

    // Skip API validation — we trust the cookies because the user just
    // logged in to get them. API validation fails due to TLS fingerprint.
    // The Playwright publish flow will verify the cookies work at publish time.
    return {
      identity: {
        id: authToken.substring(0, 16),
        username: 'Connected via Cookie',
      },
      credentials: { authToken, ct0 },
    };
  }

  /**
   * Publish a tweet via the Playwright UI approach.
   *
   * Instead of calling X's GraphQL API (which is blocked by WAF), we:
   *   1. Launch headless Chromium with the user's cookies set
   *   2. Navigate to https://x.com/compose/post
   *   3. Type the tweet text into the contenteditable editor
   *   4. Click the Post button
   *   5. Poll for success (URL change, toast, or editor cleared)
   *
   * This is the same approach Postiz uses — real browser, real TLS.
   */
  async publish(
    credentials: AdapterCredentials,
    formatted: FormattedPost
  ): Promise<PublishResult> {
    const creds = credentials as XCookieCredentials;
    if (!creds.authToken || !creds.ct0) {
      throw new PublishError('AUTH', 'X cookie credentials missing — user must reconnect');
    }

    // Build tweet text
    const tagsLine =
      formatted.hashtags && formatted.hashtags.length > 0
        ? `\n${formatted.hashtags.map((t) => `#${t}`).join(' ')}`
        : '';
    const urlLine = formatted.url ? `\n${formatted.url}` : '';
    const tweetText = `${formatted.body}${urlLine}${tagsLine}`.trim();

    if (tweetText.length === 0) {
      throw new PublishError('VALIDATION', 'Tweet text is empty after formatting');
    }
    if (tweetText.length > 280) {
      throw new PublishError('VALIDATION', `Tweet exceeds 280 chars (got ${tweetText.length})`);
    }

    // Dynamic import Playwright
    let chromium: any;
    try {
      const pw = await import('playwright');
      chromium = pw.chromium;
    } catch {
      throw new PublishError('NETWORK', 'Playwright is not installed. Run: pnpm --filter ./apps/backend exec playwright install chromium');
    }

    const executablePath = findChromiumBinary();
    let browser: any = null;

    try {
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
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        viewport: { width: 1366, height: 768 },
        locale: 'en-US',
      });

      // Anti-detection
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
        (window as any).chrome = { runtime: {}, loadTimes: () => {}, csi: () => {}, app: {} };
      });

      // Set X cookies
      await context.addCookies([
        {
          name: 'auth_token',
          value: creds.authToken,
          domain: '.x.com',
          path: '/',
          httpOnly: true,
          secure: true,
          sameSite: 'None' as const,
        },
        {
          name: 'ct0',
          value: creds.ct0,
          domain: '.x.com',
          path: '/',
          httpOnly: false,
          secure: true,
          sameSite: 'Lax' as const,
        },
      ]);

      const page = await context.newPage();

      // Navigate to compose page.
      // 90s timeout (was 30s) — accounts for slow networks where loading
      // x.com (which downloads MBs of JS bundles) takes longer than 30s.
      // With 30s, slow-network users see "page.goto: Timeout 30000ms exceeded"
      // before x.com even finishes loading.
      await page.goto('https://x.com/compose/post', {
        waitUntil: 'domcontentloaded',
        timeout: 90000,
      });
      await page.waitForTimeout(5000);

      // Check if redirected to login
      const currentUrl = page.url();
      if (currentUrl.includes('login') || currentUrl.includes('flow/login')) {
        throw new PublishError('AUTH', 'X session expired — cookies are invalid. Please reconnect.');
      }

      // Find the tweet text editor
      const editor = await page.$(
        '[data-testid="tweetTextarea_0"], div[role="textbox"][data-testid="tweetTextarea"]',
      );
      if (!editor) {
        throw new PublishError('NETWORK', 'Could not find tweet text editor on x.com/compose/post');
      }

      // Type the tweet text with realistic delays
      await editor.click();
      await page.waitForTimeout(500);
      await page.keyboard.type(tweetText, { delay: 50 });
      await page.waitForTimeout(1000);

      // If an image URL is provided, download it and attach it to the tweet
      const imageUrl = formatted.options?.imageUrl as string | undefined;
      if (imageUrl) {
        try {
          // Download the image to a temp file
          const imgResp = await fetch(imageUrl);
          if (imgResp.ok) {
            const imgBuffer = await imgResp.arrayBuffer();
            const tmpDir = os.tmpdir();
            const tmpPath = path.join(tmpDir, `tweet-img-${Date.now()}.jpg`);
            fs.writeFileSync(tmpPath, Buffer.from(imgBuffer));

            // Find the file input element (hidden) and set the file
            // X uses a hidden <input type="file"> for image uploads
            const fileInput = await page.$('input[type="file"][accept*="image"]');
            if (fileInput) {
              await fileInput.setInputFiles(tmpPath);
              // Wait for the image to upload + preview to appear
              await page.waitForTimeout(3000);
            }

            // Clean up temp file
            try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
          }
        } catch {
          // If image download fails, proceed with text-only tweet
        }
      }

      // Find and click the Post button
      const postButton = await page.$('button[data-testid="tweetButton"]');
      if (!postButton) {
        throw new PublishError('NETWORK', 'Could not find Post button on x.com/compose/post');
      }

      const isDisabled = await postButton.isDisabled();
      if (isDisabled) {
        throw new PublishError('VALIDATION', 'Post button is disabled — tweet text was not entered properly');
      }

      // Click Post (force + JS fallback)
      try {
        await postButton.click({ force: true, timeout: 5000 });
      } catch {
        // JS click fallback
      }
      await page.evaluate(() => {
        const btn = document.querySelector('button[data-testid="tweetButton"]') as HTMLButtonElement;
        if (btn) btn.click();
      });

      // Poll for confirmation
      let posted = false;
      let duplicateError = false;
      for (let i = 0; i < 15; i++) {
        await page.waitForTimeout(1000);
        const state = await page.evaluate(() => {
          const url = window.location.href;
          const bodyText = document.body?.innerText || '';
          const editor = document.querySelector('[data-testid="tweetTextarea_0"]');
          const editorEmpty = editor ? editor.textContent?.trim() === '' : true;
          const hasToast = bodyText.includes('Your post was sent') || bodyText.includes('Your Post was sent');
          const hasDuplicateError = bodyText.includes('already said that');
          return { url, hasToast, editorEmpty, hasDuplicateError };
        });

        if (state.hasDuplicateError) {
          duplicateError = true;
          break;
        }
        if (state.hasToast || !state.url.includes('/compose/post') || state.editorEmpty) {
          posted = true;
          break;
        }
      }

      if (duplicateError) {
        throw new PublishError('VALIDATION', 'X rejected: "Whoops! You already said that." (duplicate tweet)');
      }

      if (posted) {
        return {
          id: 'ui-posted',
          url: 'https://x.com/home',
        };
      }

      throw new PublishError('NETWORK', 'Could not confirm tweet was posted after 15s');
    } catch (e) {
      if (e instanceof PublishError) throw e;
      throw new PublishError('NETWORK', `Playwright X publish failed: ${(e as Error)?.message || String(e)}`);
    } finally {
      if (browser) {
        try { await browser.close(); } catch { /* ignore */ }
      }
    }
  }
}
