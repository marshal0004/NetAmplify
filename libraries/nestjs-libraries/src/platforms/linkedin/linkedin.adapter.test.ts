// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/linkedin/linkedin.adapter.test.ts
// Vitest unit tests for LinkedInAdapter.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LinkedInAdapter } from './linkedin.adapter';
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

describe('LinkedInAdapter', () => {
  let adapter: LinkedInAdapter;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    adapter = new LinkedInAdapter();
    process.env.LINKEDIN_CLIENT_ID = 'test-li-client-id';
    process.env.LINKEDIN_CLIENT_SECRET = 'test-li-client-secret';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('configured()', () => {
    it('returns true when env vars set', () => {
      expect(adapter.configured()).toBe(true);
    });

    it('returns false when env vars missing', () => {
      delete process.env.LINKEDIN_CLIENT_ID;
      expect(adapter.configured()).toBe(false);
    });
  });

  describe('getAuthUrl()', () => {
    it('builds LinkedIn authorize URL', () => {
      const url = adapter.getAuthUrl(
        { code_verifier: 'v', code_challenge: 'c', code_challenge_method: 'S256' },
        'state-123',
        'http://localhost:3000/api/oauth/linkedin/callback'
      );
      expect(url).toContain('https://www.linkedin.com/oauth/v2/authorization');
      expect(url).toContain('client_id=test-li-client-id');
      expect(url).toContain('response_type=code');
      expect(url).toContain('state=state-123');
      expect(url).toContain('scope=openid');
      expect(url).toContain('w_member_social');
      expect(url).toContain('code_challenge=c');
    });

    it('throws when not configured', () => {
      delete process.env.LINKEDIN_CLIENT_ID;
      expect(() =>
        adapter.getAuthUrl(
          { code_verifier: 'v', code_challenge: 'c', code_challenge_method: 'S256' },
          's', 'r'
        )
      ).toThrow();
    });
  });

  describe('exchangeCode()', () => {
    it('returns OAuthTokens on success + decodes memberId from id_token', async () => {
      // Build a fake id_token: header.payload.signature
      const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ sub: 'li-member-123' })).toString('base64url');
      const signature = 'fake-signature';
      const idToken = `${header}.${payload}.${signature}`;

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, {
          access_token: 'li-access-token',
          expires_in: 5184000, // 60 days
          scope: 'openid profile w_member_social',
          id_token: idToken,
        })
      ));

      const tokens = await adapter.exchangeCode('code', {
        code_verifier: 'v',
        code_challenge: 'c',
        code_challenge_method: 'S256',
      }, 'http://localhost:3000/cb');

      expect(tokens.accessToken).toBe('li-access-token');
      expect(tokens.scopes).toContain('w_member_social');
      // memberId is a custom field stored in the encrypted blob
      expect((tokens as Record<string, unknown>).memberId).toBe('li-member-123');
    });

    it('throws PublishError(AUTH) on 401', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, 'unauthorized')));
      await expect(
        adapter.exchangeCode('code', {
          code_verifier: 'v', code_challenge: 'c', code_challenge_method: 'S256',
        }, 'http://localhost:3000/cb')
      ).rejects.toThrow(PublishError);
    });
  });

  describe('getIdentity()', () => {
    it('returns user identity via /userinfo', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, { sub: 'li-123', name: 'Jane Doe' })
      ));
      const identity = await adapter.getIdentity({ accessToken: 'tok', scopes: [] });
      expect(identity.id).toBe('li-123');
      expect(identity.username).toBe('Jane Doe');
    });

    it('throws PublishError(AUTH) on 401', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, 'unauthorized')));
      await expect(
        adapter.getIdentity({ accessToken: 'bad', scopes: [] })
      ).rejects.toThrow(PublishError);
    });
  });

  describe('publish()', () => {
    it('posts a ugcPost on success', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse(201, { id: 'urn:li:ugcPost:12345', activity: 'urn:li:activity:12345' })
      );
      vi.stubGlobal('fetch', mockFetch);

      const result = await adapter.publish(
        { accessToken: 'tok', memberId: 'li-123', scopes: [] },
        { title: 'Test Post', body: 'Body text', url: 'https://example.com' }
      );

      expect(result.id).toBe('urn:li:ugcPost:12345');
      expect(result.url).toContain('linkedin.com/feed/update/urn:li:ugcPost:12345');

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/ugcPosts');
      expect(init.headers.Authorization).toBe('Bearer tok');
      const body = JSON.parse(init.body as string);
      expect(body.author).toBe('urn:li:person:li-123');
      expect(body.specificContent['com.linkedin.ugc.ShareContent'].shareCommentary.text)
        .toContain('Test Post');
      expect(body.visibility['com.linkedin.ugc.MemberNetworkVisibility']).toBe('PUBLIC');
    });

    it('throws PublishError(VALIDATION) when post > 3000 chars', async () => {
      const longBody = 'x'.repeat(3500);
      await expect(
        adapter.publish(
          { accessToken: 'tok', memberId: 'li-123', scopes: [] },
          { title: 'T', body: longBody }
        )
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) when memberId missing', async () => {
      await expect(
        adapter.publish(
          { accessToken: 'tok', scopes: [] },
          { title: 'T', body: 'B' }
        )
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) when accessToken missing', async () => {
      await expect(
        adapter.publish({ memberId: 'li-1' }, { title: 'T', body: 'B' })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) on 401', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, 'unauthorized')));
      await expect(
        adapter.publish(
          { accessToken: 'tok', memberId: 'li-123', scopes: [] },
          { title: 'T', body: 'B' }
        )
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(RATE) on 429', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(429, 'slow')));
      await expect(
        adapter.publish(
          { accessToken: 'tok', memberId: 'li-123', scopes: [] },
          { title: 'T', body: 'B' }
        )
      ).rejects.toThrow(PublishError);
    });
  });
});
