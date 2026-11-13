// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/x/chromium-binary.test.ts
// Vitest unit tests for the shared Chromium-binary discovery + auto-install helper.
//
// Pins down the behaviour that stops the "Executable doesn't exist" error from
// re-breaking X (Twitter) every time node_modules is touched:
//   - findChromiumBinary scans the whole cache + PATH (a partial cache still works)
//   - ensureChromiumAvailable auto-installs via `npx playwright install chromium`
//     when nothing is found, and throws a copy-pasteable manual-fix error only
//     if the auto-install itself fails.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mutable mock state shared with the hoisted module mocks. vi.hoisted runs
// before the vi.mock factories are evaluated, so the factories can close over it.
const state = vi.hoisted(() => ({
  /** Set of filesystem paths that fs.existsSync reports as existing. */
  existingPaths: new Set<string>(),
  /** Directory entries returned by fs.readdirSync for the Playwright cache dir. */
  cacheEntries: [] as string[],
  /** Map of `which <bin>` → resolved path, for the system-binary fallback. */
  systemBins: new Map<string, string>(),
  /** Whether the next `npx playwright install chromium` call should fail. */
  installFails: false,
}));

vi.mock('fs', () => ({
  existsSync: vi.fn((p: string) => state.existingPaths.has(p)),
  readdirSync: vi.fn(() => state.cacheEntries),
  // accessSync is a no-op — candidates are considered executable if they exist.
  accessSync: vi.fn(() => undefined),
  constants: { X_OK: 1 },
}));

vi.mock('os', () => ({
  homedir: vi.fn(() => '/home/testuser'),
}));

vi.mock('child_process', () => ({
  execSync: vi.fn((cmd: string) => {
    if (cmd.startsWith('which ')) {
      const bin = cmd.split(' ')[1];
      const found = state.systemBins.get(bin);
      if (found) return found;
      throw new Error(`which: ${bin}: not found`);
    }
    if (cmd.includes('playwright install')) {
      if (state.installFails) {
        throw new Error('network timeout');
      }
      // Simulate a successful install: the chrome binary now exists in the cache.
      state.cacheEntries.push('chromium-1208');
      state.existingPaths.add('/home/testuser/.cache/ms-playwright');
      state.existingPaths.add(
        '/home/testuser/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome',
      );
      return '';
    }
    return '';
  }),
}));

import * as fs from 'fs';
import { execSync } from 'child_process';
import { ensureChromiumAvailable, findChromiumBinary } from './chromium-binary';

const CHROME_1208 = '/home/testuser/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome';
const CACHE_DIR = '/home/testuser/.cache/ms-playwright';

function noopLogger() {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

beforeEach(() => {
  state.existingPaths.clear();
  state.cacheEntries.length = 0;
  state.systemBins.clear();
  state.installFails = false;
  vi.clearAllMocks();
});

describe('findChromiumBinary', () => {
  it('returns undefined when the cache is missing and no system browser is on PATH', () => {
    expect(findChromiumBinary()).toBeUndefined();
  });

  it('returns a cached chromium binary when present and executable', () => {
    state.cacheEntries.push('chromium-1208');
    state.existingPaths.add(CACHE_DIR);
    state.existingPaths.add(CHROME_1208);
    expect(findChromiumBinary()).toBe(CHROME_1208);
  });

  it('returns a headless-shell binary when only that variant is cached', () => {
    state.cacheEntries.push('chromium_headless_shell-1208');
    state.existingPaths.add(CACHE_DIR);
    state.existingPaths.add(
      '/home/testuser/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell',
    );
    expect(findChromiumBinary()).toBe(
      '/home/testuser/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell',
    );
  });

  it('falls back to a system-installed chromium when the cache is empty', () => {
    state.systemBins.set('chromium', '/usr/bin/chromium');
    state.existingPaths.add('/usr/bin/chromium');
    expect(findChromiumBinary()).toBe('/usr/bin/chromium');
  });

  it('skips candidates that exist but are not executable', () => {
    // The cache entry is present and existsSync=true, but accessSync throws →
    // it should be skipped and the function should keep looking.
    state.cacheEntries.push('chromium-1208');
    state.existingPaths.add(CACHE_DIR);
    state.existingPaths.add(CHROME_1208);
    vi.mocked(fs.accessSync).mockImplementationOnce(() => {
      throw new Error('EACCES');
    });
    expect(findChromiumBinary()).toBeUndefined();
  });
});

describe('ensureChromiumAvailable', () => {
  it('returns the found binary WITHOUT auto-installing when findChromiumBinary succeeds', () => {
    state.cacheEntries.push('chromium-1208');
    state.existingPaths.add(CACHE_DIR);
    state.existingPaths.add(CHROME_1208);
    const logger = noopLogger();

    const result = ensureChromiumAvailable(logger);

    expect(result).toBe(CHROME_1208);
    const installCalls = vi.mocked(execSync).mock.calls.filter((c) =>
      String(c[0]).includes('playwright install'),
    );
    expect(installCalls).toHaveLength(0);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('auto-installs via `npx playwright install chromium` when nothing is found, then returns the binary', () => {
    // Initially nothing exists → findChromiumBinary returns undefined →
    // ensureChromiumAvailable runs `npx playwright install chromium`
    // (the mock side-effect then "installs" the chrome binary) → re-scan finds it.
    const logger = noopLogger();

    const result = ensureChromiumAvailable(logger);

    expect(result).toBe(CHROME_1208);
    const installCalls = vi.mocked(execSync).mock.calls.filter((c) =>
      String(c[0]).includes('playwright install'),
    );
    expect(installCalls).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('throws an Error with copy-pasteable manual curl+unzip instructions when auto-install fails', () => {
    state.installFails = true;
    const logger = noopLogger();

    let thrown: unknown;
    try {
      ensureChromiumAvailable(logger);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(Error);
    const msg = (thrown as Error).message;
    expect(msg).toContain('Manual fix');
    expect(msg).toContain('curl -L');
    expect(msg).toContain('unzip /tmp/chromium.zip');
    expect(logger.error).toHaveBeenCalled();
  });
});
