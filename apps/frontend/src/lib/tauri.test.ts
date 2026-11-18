// /home/z/my-project/netamplify-app/apps/frontend/src/lib/tauri.test.ts
// Vitest unit tests for the Tauri bridge module.
//
// Tests:
//   1. isTauri() detection (browser vs Tauri runtime)
//   2. captureAndConnect() flow (capture → proxy → result)
//   3. Error handling (Tauri not available, capture fails, proxy fails)
//
// Per docs/09-TESTING-STRATEGY.md Rule #1: "Mock at the HTTP boundary only."
// We mock the Tauri invoke function, not the bridge module's internal logic.

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  isTauri,
  captureXCookies,
  proxyCookieConnection,
  captureAndConnect,
  checkCookieExpiry,
} from './tauri';

describe('tauri bridge', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // Clean up any Tauri globals injected by tests
    const w = window as unknown as Record<string, unknown>;
    delete w.__TAURI_INTERNALS__;
    delete w.__TAURI__;
  });

  describe('isTauri()', () => {
    it('returns false when no Tauri globals are present (browser mode)', () => {
      const w = window as unknown as Record<string, unknown>;
      delete w.__TAURI_INTERNALS__;
      delete w.__TAURI__;
      expect(isTauri()).toBe(false);
    });

    it('returns true when __TAURI_INTERNALS__ is present (Tauri 2.0)', () => {
      const w = window as unknown as Record<string, unknown>;
      w.__TAURI_INTERNALS__ = { invoke: vi.fn() };
      expect(isTauri()).toBe(true);
    });

    it('returns true when __TAURI__ is present (Tauri 1.0 compat)', () => {
      const w = window as unknown as Record<string, unknown>;
      delete w.__TAURI_INTERNALS__;
      w.__TAURI__ = { invoke: vi.fn() };
      expect(isTauri()).toBe(true);
    });

    it('returns false when window is undefined (SSR)', () => {
      const originalWindow = global.window;
      // @ts-expect-error — intentionally undefined for SSR test
      delete global.window;
      expect(isTauri()).toBe(false);
      global.window = originalWindow;
    });
  });

  describe('captureXCookies()', () => {
    it('throws a descriptive error when not running in Tauri', async () => {
      const w = window as unknown as Record<string, unknown>;
      delete w.__TAURI_INTERNALS__;
      await expect(captureXCookies()).rejects.toThrow(/desktop app/i);
    });

    it('invokes the capture_x_cookies Tauri command when in Tauri', async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        platform: 'TWITTER_COOKIE',
        cookies: { auth_token: 'hex-here', ct0: 'csrf-here' },
        username: '@testuser',
        user_id: '123',
        captured_at: '2026-09-19T12:00:00Z',
      });
      const w = window as unknown as Record<string, unknown>;
      w.__TAURI_INTERNALS__ = { invoke: mockInvoke };

      const result = await captureXCookies();

      expect(mockInvoke).toHaveBeenCalledWith('capture_x_cookies', undefined);
      expect(result.platform).toBe('TWITTER_COOKIE');
      expect(result.cookies.auth_token).toBe('hex-here');
    });
  });

  describe('proxyCookieConnection()', () => {
    it('throws a descriptive error when not running in Tauri', async () => {
      const w = window as unknown as Record<string, unknown>;
      delete w.__TAURI_INTERNALS__;
      await expect(
        proxyCookieConnection('TWITTER_COOKIE', {}, 'jwt')
      ).rejects.toThrow(/desktop app/i);
    });

    it('invokes the proxy_cookie_connection command with correct args', async () => {
      const mockInvoke = vi.fn().mockResolvedValue({ id: 'conn-123', username: '@test' });
      const w = window as unknown as Record<string, unknown>;
      w.__TAURI_INTERNALS__ = { invoke: mockInvoke };

      const cookies = { auth_token: 'hex', ct0: 'csrf' };
      const result = await proxyCookieConnection('TWITTER_COOKIE', cookies, 'netamplify-jwt');

      expect(mockInvoke).toHaveBeenCalledWith('proxy_cookie_connection', {
        platform: 'TWITTER_COOKIE',
        cookies,
        jwtToken: 'netamplify-jwt',
      });
      expect(result.id).toBe('conn-123');
      expect(result.username).toBe('@test');
    });
  });

  describe('captureAndConnect()', () => {
    it('throws when Tauri is not available', async () => {
      const w = window as unknown as Record<string, unknown>;
      delete w.__TAURI_INTERNALS__;
      await expect(
        captureAndConnect('TWITTER_COOKIE', 'jwt')
      ).rejects.toThrow(/desktop app/i);
    });

    it('chains capture + proxy for X', async () => {
      const mockInvoke = vi.fn()
        .mockResolvedValueOnce({
          platform: 'TWITTER_COOKIE',
          cookies: { auth_token: 'hex', ct0: 'csrf' },
          username: '@test',
          user_id: '123',
          captured_at: '2026-09-19T12:00:00Z',
        })
        .mockResolvedValueOnce({ id: 'conn-2', username: '@test' });
      const w = window as unknown as Record<string, unknown>;
      w.__TAURI_INTERNALS__ = { invoke: mockInvoke };

      const result = await captureAndConnect('TWITTER_COOKIE', 'netamplify-jwt');

      expect(mockInvoke).toHaveBeenCalledTimes(2);
      expect(mockInvoke).toHaveBeenNthCalledWith(1, 'capture_x_cookies', undefined);
      expect(result.id).toBe('conn-2');
    });

    it('propagates errors from the capture step', async () => {
      const mockInvoke = vi.fn().mockRejectedValue({
        code: 'USER_CANCELLED',
        message: 'Login window was closed',
      });
      const w = window as unknown as Record<string, unknown>;
      w.__TAURI_INTERNALS__ = { invoke: mockInvoke };

      await expect(
        captureAndConnect('TWITTER_COOKIE', 'jwt')
      ).rejects.toEqual({
        code: 'USER_CANCELLED',
        message: 'Login window was closed',
      });

      // Only the capture command should have been called, not the proxy
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });
  });

  describe('checkCookieExpiry()', () => {
    it('invokes the check_cookie_expiry command with the token', async () => {
      const mockInvoke = vi.fn().mockResolvedValue(true);
      const w = window as unknown as Record<string, unknown>;
      w.__TAURI_INTERNALS__ = { invoke: mockInvoke };

      const expired = await checkCookieExpiry('some.jwt.token');

      expect(mockInvoke).toHaveBeenCalledWith('check_cookie_expiry', { token: 'some.jwt.token' });
      expect(expired).toBe(true);
    });
  });
});
