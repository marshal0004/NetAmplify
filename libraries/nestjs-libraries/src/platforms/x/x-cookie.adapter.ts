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

import { Injectable, Logger } from '@nestjs/common';
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
import { ensureChromiumAvailable, findChromiumBinary } from './chromium-binary';
import { isVideoMedia, readLocalUploadFile } from '../../services/uploads-dir';

export interface XCookieCredentials extends AdapterCredentials {
  authToken: string;
  ct0: string;
}

/**
 * Find an available Chromium binary on the system.
 * Searches Playwright cache + system-installed browsers.
 *
 * @deprecated Use {@link ensureChromiumAvailable} from `./chromium-binary` —
 *   it also auto-installs when nothing is found. This re-export is kept only
 *   for backward compatibility with any external callers.
 */
export { findChromiumBinary };

@Injectable()
export class XCookieAdapter implements PlatformAdapter {
  private readonly _logger = new Logger('XCookieAdapter');
  readonly platform: Platform = 'TWITTER_COOKIE';
  readonly name = 'X (Twitter)';
  readonly toolTip = 'Log in to X (Twitter) — we auto-capture your session securely';
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

    // Resolve a Chromium executable (scans cache + PATH, auto-installs if missing).
    // Passing executablePath makes launch resilient to a partial Playwright cache
    // (the #1 cause of "Executable doesn't exist" errors after pnpm install).
    let executablePath: string | undefined;
    try {
      executablePath = ensureChromiumAvailable(this._logger);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new PublishError('NETWORK', msg);
    }
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

      // Wait for the tweet text editor to appear (X's compose page loads
      // asynchronously — the editor may not be ready immediately).
      // 30s timeout for slow connections; was failing with immediate $() query.
      let editor = await page.$(
        '[data-testid="tweetTextarea_0"], div[role="textbox"][data-testid="tweetTextarea"]',
      );
      if (!editor) {
        // Retry with explicit wait
        try {
          await page.waitForSelector(
            '[data-testid="tweetTextarea_0"], div[role="textbox"][data-testid="tweetTextarea"]',
            { timeout: 30000 },
          );
          editor = await page.$(
            '[data-testid="tweetTextarea_0"], div[role="textbox"][data-testid="tweetTextarea"]',
          );
        } catch {
          throw new PublishError('NETWORK', 'Could not find tweet text editor on x.com/compose/post after 30s wait');
        }
      }
      if (!editor) {
        throw new PublishError('NETWORK', 'Tweet text editor found but null after wait');
      }

      // Type the tweet text with realistic delays
      await editor.click();
      await page.waitForTimeout(500);
      await page.keyboard.type(tweetText, { delay: 50 });
      await page.waitForTimeout(1000);

      // If an image URL is provided, download it and attach it to the tweet.
      //
      // X's compose page has a hidden <input type="file"> for image/video
      // uploads. We use Playwright's setInputFiles() to attach the image.
      //
      // X frequently changes the file input's `accept` attribute, so we try
      // multiple selectors in order. The first one that returns a non-null
      // element is used.
      //
      // Failures here are NOT silently swallowed — we log them clearly so the
      // user knows why their tweet went out as text-only. We do NOT throw,
      // because a text-only tweet is still a valid post (better than no post).
      const mediaUrl = formatted.options?.imageUrl as string | undefined;
      let imageAttached = false;
      if (mediaUrl) {
        const isVideo = isVideoMedia(mediaUrl);
        this._logger.log(
          `Media URL provided, attempting to attach: ${mediaUrl} (type: ${isVideo ? 'video' : 'image'})`
        );
        try {
          // Read the LOCAL file from disk FIRST — bypasses the ngrok/404/
          // interstitial roundtrip entirely (the backend fetching its own
          // ngrok URL was returning 404, and ngrok-free serves an HTML
          // "Visit Site" interstitial to non-browser User-Agents like Node
          // fetch). If the URL isn't a local /uploads/ URL (external CDN),
          // fall back to HTTP fetch with the ngrok-skip-browser-warning header.
          let mediaBuffer: Buffer;
          let ext: string;
          const localFile = readLocalUploadFile(mediaUrl);
          if (localFile) {
            mediaBuffer = localFile;
            ext = isVideo
              ? 'mp4'
              : (mediaUrl.match(/\.(png|gif|webp)$/i)?.[1] || 'jpg');
            this._logger.log(
              `Read local file from disk (${mediaBuffer.byteLength} bytes)`
            );
          } else {
            const mediaResp = await fetch(mediaUrl, {
              headers: { 'ngrok-skip-browser-warning': 'skip' },
            });
            if (!mediaResp.ok) {
              throw new Error(`HTTP ${mediaResp.status} fetching ${mediaUrl}`);
            }
            mediaBuffer = Buffer.from(await mediaResp.arrayBuffer());
            const contentType = mediaResp.headers.get('content-type') || '';
            ext = isVideo
              ? 'mp4'
              : contentType.includes('png') ? 'png'
              : contentType.includes('gif') ? 'gif'
              : contentType.includes('webp') ? 'webp'
              : 'jpg';
            this._logger.log(
              `Downloaded media via HTTP (${mediaBuffer.byteLength} bytes)`
            );
          }

          const tmpDir = os.tmpdir();
          const tmpPath = path.join(tmpDir, `tweet-media-${Date.now()}.${ext}`);
          fs.writeFileSync(tmpPath, mediaBuffer);
          this._logger.log(
            `Media saved to temp file: ${tmpPath} (${mediaBuffer.byteLength} bytes)`
          );

          // X's compose page has multiple file inputs. Try them in order:
          //   1. input[type="file"] with accept containing "image"
          //   2. input[type="file"] with accept containing "video"
          //   3. input[type="file"] with accept containing "*"
          //   4. Any input[type="file"] (last resort)
          //
          // The old code only tried #1, which often returns null because X
          // uses accept="image/*,video/*" (no "image" substring match in
          // some HTML attribute orderings).
          const fileInputSelectors = [
            'input[type="file"][accept*="image"]',
            'input[type="file"][accept*="video"]',
            'input[type="file"][accept*="*"]',
            'input[type="file"]',
          ];
          let fileInput: any = null;
          let usedSelector = '';
          for (const selector of fileInputSelectors) {
            fileInput = await page.$(selector);
            if (fileInput) {
              usedSelector = selector;
              this._logger.log(`Found file input using selector: ${selector}`);
              break;
            }
          }

          if (!fileInput) {
            this._logger.warn(
              `No file input found on x.com/compose/post. Tried ${fileInputSelectors.length} selectors. ` +
                `Tweet will be posted as text-only.`
            );
          } else {
            await fileInput.setInputFiles(tmpPath);
            this._logger.log(`setInputFiles() called via selector: ${usedSelector}`);
            // Wait for X to finish uploading the media. X disables the Post
            // button during upload + shows a progress spinner. We poll until:
            //   1. The Post button is enabled (upload complete), OR
            //   2. Timeout (180s for video, 30s for image).
            const isVideoMedia = /\.(mp4|webm|mov|m4v|ogg)$/i.test(mediaUrl.split(/[?#]/)[0]);
            const uploadTimeout = isVideoMedia ? 180_000 : 30_000;
            const uploadDeadline = Date.now() + uploadTimeout;
            let uploadComplete = false;
            while (Date.now() < uploadDeadline) {
              await page.waitForTimeout(2000);
              const btnEnabled = await page.evaluate(() => {
                const btn = document.querySelector('button[data-testid="tweetButton"]') as HTMLButtonElement | null;
                return btn ? !btn.disabled : false;
              });
              if (btnEnabled) {
                uploadComplete = true;
                break;
              }
            }
            if (!uploadComplete) {
              throw new PublishError(
                'VALIDATION',
                `Media upload to X did not complete within ${uploadTimeout / 1000}s ` +
                  `(${isVideoMedia ? 'video' : 'image'}). The file may be too large or in an unsupported format.`,
              );
            }
            imageAttached = true;
            this._logger.log(`Media attached successfully (upload waited ${Math.round((Date.now() - (uploadDeadline - uploadTimeout)) / 1000)}s)`);
          }

          // Clean up temp file
          try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        } catch (e) {
          this._logger.warn(
            `Media attachment failed: ${e instanceof Error ? e.message : String(e)}. ` +
              `Tweet will be posted as text-only.`
          );
        }
      } else {
        this._logger.log(`No media URL provided — posting text-only tweet`);
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

      // Poll for confirmation — 30s (was 15s, too short for media posts)
      let posted = false;
      let duplicateError = false;
      for (let i = 0; i < 30; i++) {
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
        this._logger.log(
          `Tweet posted successfully (image attached: ${imageAttached ? 'yes' : 'no'})`
        );
        return {
          id: 'ui-posted',
          url: 'https://x.com/home',
        };
      }

      throw new PublishError('NETWORK', 'Could not confirm tweet was posted after 30s');
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
