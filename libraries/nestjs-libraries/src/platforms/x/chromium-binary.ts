// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/x/chromium-binary.ts
// NetAmplify — shared Chromium binary discovery + auto-install helper.
//
// Both the X (Twitter) publish adapter and the TwitterCaptureService (OAuth
// connect flow) launch Playwright Chromium. Playwright's default
// `chromium.launch()` looks for ONE hardcoded path
// (~/.cache/ms-playwright/chromium-<rev>/chrome-linux64/chrome) and throws
// "Executable doesn't exist" the moment that single file is missing — even if
// another Chromium build, or a system chromium, IS available.
//
// This module makes launching resilient:
//   1. findChromiumBinary() scans the whole Playwright cache + system PATH for
//      ANY usable Chromium executable, so a partial cache or a system chrome
//      still works.
//   2. ensureChromiumAvailable() runs findChromiumBinary() first; if nothing is
//      found it attempts `npx playwright install chromium` automatically, and
//      only if THAT fails does it throw a clear, copy-pasteable manual-fix
//      error (the exact curl+unzip commands). This is what stops the
//      "Executable doesn't exist" error from re-breaking X every time
//      node_modules is touched.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

/** Minimal logger shape so this util works with Nest's Logger or a plain object. */
export interface ChromiumLogger {
  log?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
}

/**
 * Find an available Chromium binary on the system.
 * Searches the Playwright cache (every chromium-* variant) + system-installed
 * browsers. Returns the first existing + executable path, or undefined.
 */
export function findChromiumBinary(): string | undefined {
  const candidates: string[] = [];
  const cacheDir = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (fs.existsSync(cacheDir)) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(cacheDir);
    } catch {
      /* ignore */
    }
    for (const entry of entries) {
      if (entry.startsWith('chromium_headless_shell-')) {
        candidates.push(
          path.join(cacheDir, entry, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
        );
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
    } catch {
      /* not installed */
    }
  }
  candidates.push('/usr/bin/chromium', '/usr/bin/google-chrome');
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      }
    } catch {
      /* not executable */
    }
  }
  return undefined;
}

/**
 * Ensure a Chromium binary is available for Playwright.
 *
 * 1. Try findChromiumBinary() — usually succeeds even with a partial cache.
 * 2. If nothing is found, run `npx playwright install chromium` (auto-install).
 *    This blocks for 1-10 min on slow networks; the caller is a user-initiated
 *    capture/publish so that is acceptable, and it is far better than failing.
 * 3. Re-scan. If still missing, throw an Error whose message contains the exact
 *    manual curl+unzip commands (system unzip, which is reliable on machines
 *    where Playwright's Node.js unzip silently hangs).
 *
 * @returns the executable path to pass to chromium.launch({ executablePath }),
 *          or undefined if the default Playwright path should be used (caller
 *          may still choose to omit executablePath).
 */
export function ensureChromiumAvailable(logger?: ChromiumLogger): string | undefined {
  const found = findChromiumBinary();
  if (found) {
    return found;
  }

  logger?.warn?.(
    'Playwright Chromium not found in cache or PATH. Auto-installing via `npx playwright install chromium` (this can take 1-10 min on slow networks)...',
  );
  try {
    execSync('npx --yes playwright install chromium', {
      stdio: 'pipe',
      timeout: 10 * 60 * 1000, // 10 min hard cap
      encoding: 'utf-8',
    });
    logger?.log?.('Playwright Chromium auto-install completed.');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger?.error?.(`Playwright Chromium auto-install failed: ${msg}`);
    throw new Error(
      'Playwright Chromium binary is missing and auto-install failed.\n' +
        `Auto-install error: ${msg}\n\n` +
        'Manual fix — run these commands in your terminal:\n' +
        '  curl -L -o /tmp/chromium.zip https://cdn.playwright.dev/builds/cft/145.0.7632.6/linux64/chrome-linux64.zip\n' +
        '  rm -rf ~/.cache/ms-playwright/chromium-1208\n' +
        '  mkdir -p ~/.cache/ms-playwright/chromium-1208\n' +
        '  unzip /tmp/chromium.zip -d ~/.cache/ms-playwright/chromium-1208/\n' +
        '  chmod +x ~/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome\n' +
        '  rm /tmp/chromium.zip',
    );
  }

  const afterInstall = findChromiumBinary();
  if (!afterInstall) {
    throw new Error(
      'Playwright Chromium auto-install reported success but no executable was found. ' +
        'Run the manual curl+unzip commands (see earlier log) or `npx playwright install chromium` from your shell.',
    );
  }
  return afterInstall;
}
