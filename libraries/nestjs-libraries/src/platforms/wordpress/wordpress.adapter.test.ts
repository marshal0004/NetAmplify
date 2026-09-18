// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/wordpress/wordpress.adapter.test.ts
// Vitest unit tests for WordPressAdapter.
//
// Per docs/09-TESTING-STRATEGY.md Rule #1: "Mock at the HTTP boundary only."

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WordPressAdapter, WordPressCredentials } from './wordpress.adapter';
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

const VALID_SITE = 'https://blog.example.com';
const VALID_USERNAME = 'neeraj';
const VALID_APP_PASSWORD = 'abcd wxyz 1234 5678 efgh ijkl mnop qrst uvwx yz01';
const VALID_CREDS: WordPressCredentials = {
  siteUrl: VALID_SITE,
  username: VALID_USERNAME,
  appPassword: VALID_APP_PASSWORD,
};

describe('WordPressAdapter', () => {
  let adapter: WordPressAdapter;

  beforeEach(() => {
    adapter = new WordPressAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('metadata', () => {
    it('has platform=WORDPRESS, kind=SIMPLE', () => {
      expect(adapter.platform).toBe('WORDPRESS');
      expect(adapter.kind).toBe('SIMPLE');
      expect(adapter.name).toBe('WordPress');
    });

    it('configured() returns true', () => {
      expect(adapter.configured()).toBe(true);
    });
  });

  describe('validateCredentials()', () => {
    it('returns user identity on valid app password', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, {
          id: 5,
          name: 'Neeraj',
          slug: 'neeraj',
          username: 'neeraj',
        })
      ));

      const result = await adapter.validateCredentials({
        siteUrl: VALID_SITE,
        username: VALID_USERNAME,
        appPassword: VALID_APP_PASSWORD,
      });

      expect(result.identity.id).toBe('5');
      expect(result.identity.username).toBe('neeraj');
      expect(result.credentials.siteUrl).toBe(VALID_SITE);
      expect(result.credentials.username).toBe(VALID_USERNAME);
      expect(result.credentials.appPassword).toBe(VALID_APP_PASSWORD);
    });

    it('normalizes site URL (adds https:// when missing)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, { id: 5, slug: 'test' })
      ));

      const result = await adapter.validateCredentials({
        siteUrl: 'blog.example.com',
        username: VALID_USERNAME,
        appPassword: VALID_APP_PASSWORD,
      });

      expect(result.credentials.siteUrl).toBe('https://blog.example.com');
    });

    it('strips trailing slash from site URL', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, { id: 5, slug: 'test' })
      ));

      const result = await adapter.validateCredentials({
        siteUrl: 'https://blog.example.com/',
        username: VALID_USERNAME,
        appPassword: VALID_APP_PASSWORD,
      });

      expect(result.credentials.siteUrl).toBe('https://blog.example.com');
    });

    it('throws PublishError(VALIDATION) when siteUrl missing', async () => {
      await expect(
        adapter.validateCredentials({ username: VALID_USERNAME, appPassword: VALID_APP_PASSWORD })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when username missing', async () => {
      await expect(
        adapter.validateCredentials({ siteUrl: VALID_SITE, appPassword: VALID_APP_PASSWORD })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when appPassword missing', async () => {
      await expect(
        adapter.validateCredentials({ siteUrl: VALID_SITE, username: VALID_USERNAME })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when appPassword too short', async () => {
      await expect(
        adapter.validateCredentials({
          siteUrl: VALID_SITE,
          username: VALID_USERNAME,
          appPassword: 'short',
        })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) on 401 (invalid credentials)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, 'unauthorized')));
      try {
        await adapter.validateCredentials({
          siteUrl: VALID_SITE,
          username: VALID_USERNAME,
          appPassword: VALID_APP_PASSWORD,
        });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('AUTH');
      }
    });

    it('throws PublishError(AUTH) on 403 (app passwords disabled)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(403, 'forbidden')));
      try {
        await adapter.validateCredentials({
          siteUrl: VALID_SITE,
          username: VALID_USERNAME,
          appPassword: VALID_APP_PASSWORD,
        });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('AUTH');
      }
    });

    it('throws PublishError(VALIDATION) on 404 (REST API not found)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(404, 'not found')));
      try {
        await adapter.validateCredentials({
          siteUrl: VALID_SITE,
          username: VALID_USERNAME,
          appPassword: VALID_APP_PASSWORD,
        });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('VALIDATION');
      }
    });

    it('throws PublishError(RATE) on 429', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(429, 'slow')));
      try {
        await adapter.validateCredentials({
          siteUrl: VALID_SITE,
          username: VALID_USERNAME,
          appPassword: VALID_APP_PASSWORD,
        });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('RATE');
      }
    });

    it('sends Basic Auth header with stripped-space password', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse(200, { id: 5, slug: 'test' })
      );
      vi.stubGlobal('fetch', mockFetch);

      await adapter.validateCredentials({
        siteUrl: VALID_SITE,
        username: VALID_USERNAME,
        appPassword: VALID_APP_PASSWORD,
      });

      const callArgs = mockFetch.mock.calls[0];
      const init = callArgs[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      const expectedPassword = VALID_APP_PASSWORD.replace(/\s+/g, '');
      const expectedRaw = `${VALID_USERNAME}:${expectedPassword}`;
      const expectedB64 = Buffer.from(expectedRaw, 'utf8').toString('base64');
      expect(headers.Authorization).toBe(`Basic ${expectedB64}`);
    });
  });

  describe('publish()', () => {
    it('creates a post and returns id + url on success', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse(201, {
          id: 123,
          link: 'https://blog.example.com/2026/09/17/hello-world',
          slug: 'hello-world',
        })
      );
      vi.stubGlobal('fetch', mockFetch);

      const result = await adapter.publish(
        VALID_CREDS,
        {
          title: 'Hello World',
          body: '# markdown body\n\nThis is a test post.',
          hashtags: ['netamplify'],
        }
      );

      expect(result.id).toBe('123');
      expect(result.url).toBe('https://blog.example.com/2026/09/17/hello-world');
    });

    it('throws PublishError(VALIDATION) when title missing', async () => {
      await expect(
        adapter.publish(VALID_CREDS, { title: '', body: 'body' })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when title > 200 chars', async () => {
      await expect(
        adapter.publish(VALID_CREDS, { title: 'x'.repeat(201), body: 'body' })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when body is empty', async () => {
      await expect(
        adapter.publish(VALID_CREDS, { title: 'Title', body: '' })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) on 401 (credentials invalid)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, 'unauthorized')));
      try {
        await adapter.publish(VALID_CREDS, { title: 'Title', body: 'body' });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('AUTH');
      }
    });

    it('throws PublishError(AUTH) on 403 (user lacks publish_posts capability)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(403, 'forbidden')));
      try {
        await adapter.publish(VALID_CREDS, { title: 'Title', body: 'body' });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('AUTH');
      }
    });

    it('throws PublishError(VALIDATION) on 400/422 (rejected)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(422, '{"error":"bad"}')));
      try {
        await adapter.publish(VALID_CREDS, { title: 'Title', body: 'body' });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('VALIDATION');
      }
    });

    it('throws PublishError(RATE) on 429', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(429, 'slow')));
      try {
        await adapter.publish(VALID_CREDS, { title: 'Title', body: 'body' });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('RATE');
      }
    });

    it('throws PublishError(NETWORK) when id missing from response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(201, { link: 'x' })));
      try {
        await adapter.publish(VALID_CREDS, { title: 'Title', body: 'body' });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('NETWORK');
      }
    });

    it('falls back to /?p=<id> URL when link missing', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(201, { id: 999 })
      ));
      const result = await adapter.publish(VALID_CREDS, { title: 'T', body: 'b' });
      expect(result.url).toBe('https://blog.example.com/?p=999');
    });

    it('sends JSON body with status=publish', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse(201, { id: 1, link: 'https://x.com/?p=1' })
      );
      vi.stubGlobal('fetch', mockFetch);

      await adapter.publish(VALID_CREDS, { title: 'Hello', body: 'Body text' });

      const init = mockFetch.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(init.body as string);
      expect(body.title).toBe('Hello');
      expect(body.content).toBe('Body text');
      expect(body.status).toBe('publish');
    });

    it('throws PublishError(AUTH) when credentials missing', async () => {
      await expect(
        adapter.publish({}, { title: 'Title', body: 'body' })
      ).rejects.toThrow(PublishError);
    });
  });
});
