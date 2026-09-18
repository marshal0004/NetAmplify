// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/mastodon/mastodon.adapter.test.ts
// Vitest unit tests for MastodonAdapter.
//
// Per docs/09-TESTING-STRATEGY.md Rule #1: "Mock at the HTTP boundary only."

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MastodonAdapter, MastodonCredentials } from './mastodon.adapter';
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

const VALID_INSTANCE = 'mastodon.social';
const VALID_ACCESS_TOKEN = 'abcdef0123456789_ABCDEF-test-token-1234';
const VALID_CREDS: MastodonCredentials = {
  instance: 'https://mastodon.social',
  accessToken: VALID_ACCESS_TOKEN,
};

describe('MastodonAdapter', () => {
  let adapter: MastodonAdapter;

  beforeEach(() => {
    adapter = new MastodonAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('metadata', () => {
    it('has platform=MASTODON, kind=SIMPLE', () => {
      expect(adapter.platform).toBe('MASTODON');
      expect(adapter.kind).toBe('SIMPLE');
      expect(adapter.name).toBe('Mastodon');
    });

    it('configured() returns true', () => {
      expect(adapter.configured()).toBe(true);
    });
  });

  describe('validateCredentials()', () => {
    it('returns user identity on valid token', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, {
          id: '109366491739622421',
          username: 'neeraj',
          acct: 'neeraj',
          url: 'https://mastodon.social/@neeraj',
        })
      ));

      const result = await adapter.validateCredentials({
        instance: VALID_INSTANCE,
        accessToken: VALID_ACCESS_TOKEN,
      });

      expect(result.identity.id).toBe('109366491739622421');
      expect(result.identity.username).toContain('neeraj');
      expect(result.credentials.instance).toBe('https://mastodon.social');
      expect(result.credentials.accessToken).toBe(VALID_ACCESS_TOKEN);
    });

    it('normalizes instance URL (strips trailing slash, adds https://)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, { id: '1', acct: 'test', url: 'https://x.com/@test' })
      ));

      const result = await adapter.validateCredentials({
        instance: 'mastodon.social/',
        accessToken: VALID_ACCESS_TOKEN,
      });

      expect(result.credentials.instance).toBe('https://mastodon.social');
    });

    it('normalizes instance URL (adds https:// prefix when missing)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, { id: '1', acct: 'test', url: 'https://x.com/@test' })
      ));

      const result = await adapter.validateCredentials({
        instance: 'fosstodon.org',
        accessToken: VALID_ACCESS_TOKEN,
      });

      expect(result.credentials.instance).toBe('https://fosstodon.org');
    });

    it('throws PublishError(VALIDATION) when instance missing', async () => {
      await expect(
        adapter.validateCredentials({ accessToken: VALID_ACCESS_TOKEN })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when accessToken missing', async () => {
      await expect(
        adapter.validateCredentials({ instance: VALID_INSTANCE })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when accessToken too short', async () => {
      await expect(
        adapter.validateCredentials({ instance: VALID_INSTANCE, accessToken: 'short' })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when instance URL has a path', async () => {
      await expect(
        adapter.validateCredentials({
          instance: 'https://mastodon.social/some/path',
          accessToken: VALID_ACCESS_TOKEN,
        })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) on 401 (invalid token)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, 'unauthorized')));
      try {
        await adapter.validateCredentials({ instance: VALID_INSTANCE, accessToken: VALID_ACCESS_TOKEN });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('AUTH');
      }
    });

    it('throws PublishError(AUTH) on 403 (missing scopes)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(403, 'forbidden')));
      try {
        await adapter.validateCredentials({ instance: VALID_INSTANCE, accessToken: VALID_ACCESS_TOKEN });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('AUTH');
      }
    });

    it('throws PublishError(VALIDATION) on 404 (instance not found)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(404, 'not found')));
      try {
        await adapter.validateCredentials({
          instance: 'nonexistent.example',
          accessToken: VALID_ACCESS_TOKEN,
        });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('VALIDATION');
      }
    });

    it('throws PublishError(RATE) on 429', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(429, 'slow down')));
      try {
        await adapter.validateCredentials({ instance: VALID_INSTANCE, accessToken: VALID_ACCESS_TOKEN });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('RATE');
      }
    });

    it('sends correct Authorization header', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse(200, { id: '1', acct: 'test', url: 'https://x.com/@test' })
      );
      vi.stubGlobal('fetch', mockFetch);

      await adapter.validateCredentials({
        instance: VALID_INSTANCE,
        accessToken: VALID_ACCESS_TOKEN,
      });

      const callArgs = mockFetch.mock.calls[0];
      const url = callArgs[0] as string;
      const init = callArgs[1] as RequestInit;
      const headers = init.headers as Record<string, string>;

      expect(url).toBe('https://mastodon.social/api/v1/accounts/verify_credentials');
      expect(headers.Authorization).toBe(`Bearer ${VALID_ACCESS_TOKEN}`);
    });
  });

  describe('publish()', () => {
    it('posts a status and returns id + url on success', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse(200, {
          id: '1134567890123456789',
          url: 'https://mastodon.social/@neeraj/1134567890123456789',
        })
      );
      vi.stubGlobal('fetch', mockFetch);

      const result = await adapter.publish(
        VALID_CREDS,
        {
          body: 'Hello from NetAmplify!',
          url: 'https://github.com/marshal0004/NetAmplify',
          hashtags: ['netamplify', 'typescript'],
        }
      );

      expect(result.id).toBe('1134567890123456789');
      expect(result.url).toBe('https://mastodon.social/@neeraj/1134567890123456789');
    });

    it('throws PublishError(VALIDATION) when text exceeds 500 chars', async () => {
      const longText = 'x'.repeat(501);
      await expect(
        adapter.publish(VALID_CREDS, { body: longText })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when body is empty', async () => {
      await expect(
        adapter.publish(VALID_CREDS, { body: '' })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) on 401 (token expired)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, 'unauthorized')));
      try {
        await adapter.publish(VALID_CREDS, { body: 'Hello' });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('AUTH');
      }
    });

    it('throws PublishError(AUTH) on 403 (missing write:statuses scope)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(403, 'forbidden')));
      try {
        await adapter.publish(VALID_CREDS, { body: 'Hello' });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('AUTH');
      }
    });

    it('throws PublishError(VALIDATION) on 422 (rejected)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(422, '{"error":"invalid"}')));
      try {
        await adapter.publish(VALID_CREDS, { body: 'Hello' });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('VALIDATION');
      }
    });

    it('throws PublishError(RATE) on 429', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(429, 'slow')));
      try {
        await adapter.publish(VALID_CREDS, { body: 'Hello' });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('RATE');
      }
    });

    it('throws PublishError(NETWORK) when id missing from response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, { url: 'x' })));
      try {
        await adapter.publish(VALID_CREDS, { body: 'Hello' });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('NETWORK');
      }
    });

    it('falls back to uri when url is missing', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, { id: '1', uri: 'https://mastodon.social/users/neeraj/statuses/1' })
      ));
      const result = await adapter.publish(VALID_CREDS, { body: 'Hello' });
      expect(result.url).toBe('https://mastodon.social/users/neeraj/statuses/1');
    });

    it('sends form-encoded body with status + visibility=public', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse(200, { id: '1', url: 'https://mastodon.social/@x/1' })
      );
      vi.stubGlobal('fetch', mockFetch);

      await adapter.publish(VALID_CREDS, { body: 'Hello World' });

      const init = mockFetch.mock.calls[0][1] as RequestInit;
      const params = new URLSearchParams(init.body as string);
      expect(params.get('status')).toBe('Hello World');
      expect(params.get('visibility')).toBe('public');
    });
  });
});
