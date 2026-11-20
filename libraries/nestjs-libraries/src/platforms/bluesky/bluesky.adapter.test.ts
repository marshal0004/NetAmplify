// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/bluesky/bluesky.adapter.test.ts
// Vitest unit tests for BlueskyAdapter.

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

describe('BlueskyAdapter', () => {
  let adapter: BlueskyAdapter;

  beforeEach(() => {
    adapter = new BlueskyAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('metadata', () => {
    it('has platform=BLUESKY, kind=SIMPLE', () => {
      expect(adapter.platform).toBe('BLUESKY');
      expect(adapter.kind).toBe('SIMPLE');
    });
  });

  describe('validateCredentials()', () => {
    it('returns DID + handle on valid credentials', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, {
          did: 'did:plc:abc123',
          accessJwt: 'jwt-access',
          refreshJwt: 'jwt-refresh',
          handle: 'jane.bsky.social',
        })
      ));

      const result = await adapter.validateCredentials({
        handle: 'jane.bsky.social',
        appPassword: 'abcd-efgh-ijkl-mnop',
      });

      expect(result.identity.id).toBe('did:plc:abc123');
      expect(result.identity.username).toBe('jane.bsky.social');
      expect(result.credentials.did).toBe('did:plc:abc123');
      expect(result.credentials.handle).toBe('jane.bsky.social');
      expect(result.credentials.accessJwt).toBe('jwt-access');
      expect(result.credentials.refreshJwt).toBe('jwt-refresh');
    });

    it('throws PublishError(AUTH) on 401', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, 'unauthorized')));
      await expect(
        adapter.validateCredentials({ handle: 'jane.bsky.social', appPassword: 'abcd-efgh-ijkl-mnop' })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when handle missing', async () => {
      await expect(
        adapter.validateCredentials({ appPassword: 'abcd-efgh-ijkl-mnop' })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when appPassword missing', async () => {
      await expect(
        adapter.validateCredentials({ handle: 'jane.bsky.social' })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(RATE) on 429', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(429, 'slow')));
      await expect(
        adapter.validateCredentials({ handle: 'jane.bsky.social', appPassword: 'abcd-efgh-ijkl-mnop' })
      ).rejects.toThrow(PublishError);
    });
  });

  describe('publish()', () => {
    it('posts a record on success', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse(200, {
          uri: 'at://did:plc:abc/app.bsky.feed.post/rkey123',
          cid: 'cid-abc',
        })
      );
      vi.stubGlobal('fetch', mockFetch);

      // formatted.body is the COMPLETE post text — the format-engine already
      // concatenated title + body + URL + hashtags and truncated to ≤300
      // graphemes. The adapter uses it directly (does NOT re-concatenate).
      const formattedBody = 'Test Post\n\nBody text\nhttps://example.com\n\n#ts';
      const result = await adapter.publish(
        {
          accessJwt: 'jwt-access',
          refreshJwt: 'jwt-refresh',
          did: 'did:plc:abc',
          handle: 'jane.bsky.social',
        },
        { title: 'Test Post', body: formattedBody, url: 'https://example.com', hashtags: ['ts'] }
      );

      expect(result.id).toBe('rkey123');
      expect(result.url).toBe('https://bsky.app/profile/jane.bsky.social/post/rkey123');

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('com.atproto.repo.createRecord');
      expect(init.headers.Authorization).toBe('Bearer jwt-access');
      const body = JSON.parse(init.body as string);
      expect(body.repo).toBe('did:plc:abc');
      expect(body.collection).toBe('app.bsky.feed.post');
      // The post text IS formatted.body — no duplication of title/URL/hashtags
      expect(body.record.text).toBe(formattedBody);
      expect(body.record.text).toContain('Test Post');
      expect(body.record.text).toContain('Body text');
      expect(body.record.text).toContain('https://example.com');
      // URL facet should be added (the URL is inside formatted.body)
      expect(body.record.facets.length).toBe(1);
      expect(body.record.facets[0].features[0].$type).toBe('app.bsky.richtext.facet#link');
    });

    it('does NOT duplicate title/URL/hashtags — uses formatted.body directly (regression: duplication pushed posts >300 graphemes)', async () => {
      // Regression test for the bug where the adapter re-concatenated
      // title + body + URL + hashtags on top of the already-complete
      // formatted.body, doubling the text and exceeding the 300-grapheme
      // limit. The adapter must use formatted.body as-is.
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse(200, {
          uri: 'at://did:plc:abc/app.bsky.feed.post/rkey-no-dup',
          cid: 'cid',
        })
      );
      vi.stubGlobal('fetch', mockFetch);

      // A formatted.body that's exactly 280 graphemes (under the 300 limit).
      // If the adapter duplicated the title + URL + hashtags, it would push
      // well over 300 and throw VALIDATION.
      const formattedBody = 'Title\n\nBody content here.\nhttps://example.com\n\n#tag1 #tag2';
      await adapter.publish(
        { accessJwt: 'jwt', did: 'did:plc:abc', handle: 'jane.bsky.social' },
        { title: 'Title', body: formattedBody, url: 'https://example.com', hashtags: ['tag1', 'tag2'] }
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      // text must equal formatted.body exactly — no duplication
      expect(body.record.text).toBe(formattedBody);
      // The title appears ONCE (not twice)
      expect((body.record.text.match(/Title/g) || []).length).toBe(1);
      // The URL appears ONCE (not twice)
      expect((body.record.text.match(/https:\/\/example\.com/g) || []).length).toBe(1);
      // The hashtag appears ONCE (not twice)
      expect((body.record.text.match(/#tag1/g) || []).length).toBe(1);
    });

    it('throws PublishError(VALIDATION) when post > 300 graphemes', async () => {
      const longBody = 'a'.repeat(350);
      await expect(
        adapter.publish(
          { accessJwt: 'jwt', did: 'did:plc:abc', handle: 'jane.bsky.social' },
          { title: 'T', body: longBody }
        )
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) on 401', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, 'unauthorized')));
      await expect(
        adapter.publish(
          { accessJwt: 'jwt', did: 'did:plc:abc', handle: 'jane.bsky.social' },
          { title: 'T', body: 'Body' }
        )
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(RATE) on 429', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(429, 'slow')));
      await expect(
        adapter.publish(
          { accessJwt: 'jwt', did: 'did:plc:abc', handle: 'jane.bsky.social' },
          { title: 'T', body: 'Body' }
        )
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) when credentials missing', async () => {
      await expect(
        adapter.publish({}, { title: 'T', body: 'B' })
      ).rejects.toThrow(PublishError);
    });
  });
});
