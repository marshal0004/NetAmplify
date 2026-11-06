// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/hashnode/hashnode.adapter.test.ts
// Vitest unit tests for HashnodeAdapter.
//
// Covers the fixes for:
//   - Endpoint change: gql.hashnode.com → gql-beta.hashnode.com
//   - GraphQL schema change: nodes → edges { node { ... } }
//   - HTML response handling (defensive against CDN redirects / endpoint changes)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HashnodeAdapter } from './hashnode.adapter';
import { PublishError } from '../adapter.interface';

/** Build a mock fetch Response with proper Content-Type header. */
function mockResponse(
  status: number,
  body: unknown,
  contentType = 'application/json',
): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': contentType }),
    json: async () =>
      typeof body === 'string' ? JSON.parse(body) : body,
    text: async () => text,
  } as Response;
}

describe('HashnodeAdapter', () => {
  let adapter: HashnodeAdapter;

  beforeEach(() => {
    adapter = new HashnodeAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('metadata', () => {
    it('has platform=HASHNODE, kind=SIMPLE', () => {
      expect(adapter.platform).toBe('HASHNODE');
      expect(adapter.kind).toBe('SIMPLE');
    });
  });

  describe('validateCredentials()', () => {
    it('returns user identity + publicationId on valid PAT (edges schema)', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockResponse(200, {
          data: {
            me: {
              id: 'user-123',
              username: 'janedev',
              publications: {
                edges: [
                  { node: { id: 'pub-abc', title: 'Jane Dev Blog' } },
                ],
              },
            },
          },
        }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const result = await adapter.validateCredentials({ pat: 'hashnode-pat-123' });

      expect(result.identity.id).toBe('user-123');
      expect(result.identity.username).toBe('janedev');
      expect(result.credentials.pat).toBe('hashnode-pat-123');
      expect(result.credentials.publicationId).toBe('pub-abc');

      // Verify the adapter hits the NEW endpoint (gql-beta, not gql)
      const fetchUrl = fetchMock.mock.calls[0][0] as string;
      expect(fetchUrl).toBe('https://gql-beta.hashnode.com');
      expect(fetchUrl).not.toContain('gql.hashnode.com');
    });

    it('saves connection even when user has no publications', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, {
          data: {
            me: {
              id: 'user-456',
              username: 'newuser',
              publications: {
                edges: [], // empty — no publications yet
              },
            },
          },
        }),
      ));

      const result = await adapter.validateCredentials({ pat: 'valid-pat' });

      expect(result.identity.id).toBe('user-456');
      expect(result.identity.username).toBe('newuser');
      expect(result.credentials.pat).toBe('valid-pat');
      expect(result.credentials.publicationId).toBeUndefined();
    });

    it('throws PublishError(AUTH) on 401', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(401, 'unauthorized', 'text/plain'),
      ));
      await expect(
        adapter.validateCredentials({ pat: 'bad' }),
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when GraphQL returns errors', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, { errors: [{ message: 'Invalid token' }] }),
      ));
      await expect(
        adapter.validateCredentials({ pat: 'bad' }),
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when pat missing', async () => {
      await expect(adapter.validateCredentials({})).rejects.toThrow(PublishError);
    });

    it('throws PublishError(RATE) on 429', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(429, 'slow', 'text/plain'),
      ));
      await expect(
        adapter.validateCredentials({ pat: 'x' }),
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(NETWORK) when API returns HTML (endpoint changed/redirect)', async () => {
      // Simulates the old gql.hashnode.com 301 redirect to an HTML changelog page
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(
          200,
          '<!DOCTYPE html><html><head><title>301 Moved Permanently</title></head></html>',
          'text/html',
        ),
      ));

      await expect(
        adapter.validateCredentials({ pat: 'valid-pat' }),
      ).rejects.toThrow(/non-JSON response/);
    });

    it('throws PublishError(NETWORK) when JSON parse fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, '{invalid json', 'application/json'),
      ));

      await expect(
        adapter.validateCredentials({ pat: 'valid-pat' }),
      ).rejects.toThrow(/invalid JSON/);
    });
  });

  describe('publish()', () => {
    it('publishes a post on success', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, {
          data: {
            publishPost: {
              post: {
                id: 'post-abc',
                slug: 'test-post',
                url: 'https://janedev.hashnode.dev/test-post',
              },
            },
          },
        }),
      ));

      const result = await adapter.publish(
        { pat: 'pat-123', publicationId: 'pub-abc' },
        { title: 'Test Post', body: '# markdown', hashtags: ['typescript'] },
      );

      expect(result.id).toBe('post-abc');
      expect(result.url).toBe('https://janedev.hashnode.dev/test-post');
    });

    it('throws PublishError(VALIDATION) with clear message when publicationId missing', async () => {
      await expect(
        adapter.publish(
          { pat: 'pat' },
          { title: 'T', body: 'B' },
        ),
      ).rejects.toThrow(/Create a blog on hashnode\.com/);
    });

    it('throws PublishError(AUTH) when pat missing', async () => {
      await expect(
        adapter.publish(
          { publicationId: 'pub' },
          { title: 'T', body: 'B' },
        ),
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when GraphQL returns errors', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, { errors: [{ message: 'Tag not allowed' }] }),
      ));
      await expect(
        adapter.publish(
          { pat: 'pat', publicationId: 'pub' },
          { title: 'T', body: 'B', hashtags: ['bad-tag'] },
        ),
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) on 401', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(401, 'unauthorized', 'text/plain'),
      ));
      await expect(
        adapter.publish(
          { pat: 'pat', publicationId: 'pub' },
          { title: 'T', body: 'B' },
        ),
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(RATE) on 429', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(429, 'slow', 'text/plain'),
      ));
      await expect(
        adapter.publish(
          { pat: 'pat', publicationId: 'pub' },
          { title: 'T', body: 'B' },
        ),
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(NETWORK) when API returns HTML during publish', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(
          200,
          '<!DOCTYPE html><html><body>Cloudflare challenge</body></html>',
          'text/html',
        ),
      ));

      await expect(
        adapter.publish(
          { pat: 'pat', publicationId: 'pub' },
          { title: 'T', body: 'B' },
        ),
      ).rejects.toThrow(/non-JSON response/);
    });
  });
});
