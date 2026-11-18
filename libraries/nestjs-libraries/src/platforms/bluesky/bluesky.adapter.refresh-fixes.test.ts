// /home/z/my-project/na-work/libraries/nestjs-libraries/src/platforms/bluesky/bluesky.adapter.refresh-fixes.test.ts
// Vitest unit tests for the Bluesky publish fixes:
//   - refreshCredentials: decodes accessJwt exp, refreshes via refreshSession,
//     rotates refreshJwt, preserves did/handle, returns same ref when valid
//   - publish() classifies ExpiredToken 400 as AUTH (not NETWORK/retryable)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BlueskyAdapter } from './bluesky.adapter';
import { PublishError } from '../adapter.interface';

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response;
}

/** Build a minimal JWT with the given `exp` (epoch seconds). */
function makeJwt(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  return `${header}.${payload}.sig`;
}

describe('BlueskyAdapter refresh + ExpiredToken fixes', () => {
  let adapter: BlueskyAdapter;

  beforeEach(() => {
    adapter = new BlueskyAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('refreshCredentials()', () => {
    const baseCreds = {
      accessJwt: 'old-access',
      refreshJwt: 'old-refresh',
      did: 'did:plc:abc123',
      handle: 'jane.bsky.social',
    };

    it('returns the SAME blob reference when the accessJwt is still valid (>5min)', async () => {
      const validCreds = {
        ...baseCreds,
        accessJwt: makeJwt(Math.floor(Date.now() / 1000) + 3600), // 1h left
      };
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const result = await adapter.refreshCredentials(validCreds);
      expect(result).toBe(validCreds); // same ref → worker skips re-encrypt + persist
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refreshes an expired accessJwt + rotates the refreshJwt + preserves did/handle', async () => {
      const expiredCreds = {
        ...baseCreds,
        accessJwt: makeJwt(Math.floor(Date.now() / 1000) - 100), // expired 100s ago
      };
      const fetchMock = vi.fn().mockResolvedValue(
        mockResponse(200, {
          did: 'did:plc:abc123',
          accessJwt: 'new-access',
          refreshJwt: 'new-refresh',
          handle: 'jane.bsky.social',
        }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const result = (await adapter.refreshCredentials(expiredCreds)) as Record<string, unknown>;
      expect(result.accessJwt).toBe('new-access');
      // refreshJwt ROTATED — the new one MUST be persisted or the next refresh
      // reuses the now-invalidated old refreshJwt + fails.
      expect(result.refreshJwt).toBe('new-refresh');
      // Non-token fields preserved.
      expect(result.did).toBe('did:plc:abc123');
      expect(result.handle).toBe('jane.bsky.social');

      // refreshSession is called with the refreshJwt as the bearer.
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toContain('com.atproto.server.refreshSession');
      expect((init as RequestInit).headers).toMatchObject({
        Authorization: 'Bearer old-refresh',
      });
    });

    it('throws AUTH when the refreshJwt is invalid/revoked (401)', async () => {
      const expiredCreds = {
        ...baseCreds,
        accessJwt: makeJwt(Math.floor(Date.now() / 1000) - 100),
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, 'revoked')));

      await expect(adapter.refreshCredentials(expiredCreds)).rejects.toMatchObject({
        name: 'PublishError',
        errorClass: 'AUTH',
      });
    });

    it('refreshes proactively when the JWT exp cannot be decoded (malformed)', async () => {
      const malformedCreds = { ...baseCreds, accessJwt: 'not-a-jwt' };
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockResponse(200, {
            did: 'did:plc:abc123',
            accessJwt: 'new-access',
            refreshJwt: 'new-refresh',
            handle: 'jane.bsky.social',
          }),
        ),
      );

      const result = (await adapter.refreshCredentials(malformedCreds)) as Record<string, unknown>;
      expect(result.accessJwt).toBe('new-access');
    });

    it('throws AUTH when accessJwt or refreshJwt is missing', async () => {
      await expect(
        adapter.refreshCredentials({ did: 'did:plc:abc', handle: 'h' } as never),
      ).rejects.toMatchObject({ name: 'PublishError', errorClass: 'AUTH' });
    });
  });

  describe('publish() ExpiredToken classification', () => {
    const creds = {
      accessJwt: makeJwt(Math.floor(Date.now() / 1000) + 3600), // valid (so publish proceeds)
      refreshJwt: 'refresh',
      did: 'did:plc:abc123',
      handle: 'jane.bsky.social',
    };

    it('classifies a 400 ExpiredToken as AUTH (not retryable NETWORK)', async () => {
      // Bluesky returns ExpiredToken as HTTP 400 (NOT 401). With proactive
      // refreshCredentials this race should be rare, but when it happens it
      // must be AUTH (→ REVOKED + reconnect) not NETWORK (→ retry loop →
      // "stuck publishing").
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockResponse(400, JSON.stringify({ error: 'ExpiredToken', message: 'Token has expired' })),
        ),
      );

      await expect(
        adapter.publish(creds, { title: 't', body: 'b' }),
      ).rejects.toMatchObject({
        name: 'PublishError',
        errorClass: 'AUTH',
      });
    });

    it('classifies a non-ExpiredToken 400 as NETWORK (retryable)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockResponse(400, JSON.stringify({ error: 'InvalidRequest', message: 'bad record' })),
        ),
      );

      await expect(
        adapter.publish(creds, { title: 't', body: 'b' }),
      ).rejects.toMatchObject({
        name: 'PublishError',
        errorClass: 'NETWORK',
      });
    });
  });
});
