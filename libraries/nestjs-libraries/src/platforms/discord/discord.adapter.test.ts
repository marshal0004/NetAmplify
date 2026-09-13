// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/discord/discord.adapter.test.ts
// Vitest unit tests for DiscordAdapter.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DiscordAdapter } from './discord.adapter';
import { PublishError } from '../adapter.interface';

function mockResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response;
}

describe('DiscordAdapter', () => {
  let adapter: DiscordAdapter;

  beforeEach(() => {
    adapter = new DiscordAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('metadata', () => {
    it('has platform=DISCORD, kind=SIMPLE', () => {
      expect(adapter.platform).toBe('DISCORD');
      expect(adapter.kind).toBe('SIMPLE');
      expect(adapter.name).toBe('Discord');
    });

    it('always configured=true (user-pasted creds)', () => {
      expect(adapter.configured()).toBe(true);
    });
  });

  describe('validateCredentials()', () => {
    it('returns channel identity on valid webhook URL', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, {
          id: 'webhook-id-123',
          name: 'showcase',
          channel_id: 'channel-123',
          guild_id: 'guild-123',
        })
      ));

      const result = await adapter.validateCredentials({
        webhookUrl: 'https://discord.com/api/webhooks/123456789/abc-def',
      });

      expect(result.identity.id).toBe('channel-123');
      expect(result.identity.username).toBe('#showcase');
      expect(result.credentials.webhookUrl).toBe('https://discord.com/api/webhooks/123456789/abc-def');
    });

    it('throws PublishError(VALIDATION) when webhookUrl missing', async () => {
      await expect(adapter.validateCredentials({})).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when URL is not https', async () => {
      await expect(
        adapter.validateCredentials({ webhookUrl: 'http://discord.com/api/webhooks/123/abc' })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) on 404 (revoked webhook)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(404, 'not found')));
      await expect(
        adapter.validateCredentials({ webhookUrl: 'https://discord.com/api/webhooks/123/abc' })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) on 401', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, 'unauthorized')));
      await expect(
        adapter.validateCredentials({ webhookUrl: 'https://discord.com/api/webhooks/123/abc' })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(RATE) on 429', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(429, 'slow')));
      await expect(
        adapter.validateCredentials({ webhookUrl: 'https://discord.com/api/webhooks/123/abc' })
      ).rejects.toThrow(PublishError);
    });
  });

  describe('publish()', () => {
    it('posts an embed message on success', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse(200, { id: 'msg-123', channel_id: 'chan-123' })
      );
      vi.stubGlobal('fetch', mockFetch);

      const result = await adapter.publish(
        { webhookUrl: 'https://discord.com/api/webhooks/123/abc' },
        { title: 'Test Post', body: 'Body text', hashtags: ['typescript', 'react'] }
      );

      expect(result.id).toBe('msg-123');
      expect(result.url).toContain('discord.com/channels/chan-123/msg-123');

      // Verify request shape
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('wait=true');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body as string);
      expect(body.embeds[0].title).toBe('Test Post');
      expect(body.embeds[0].description).toBe('Body text');
      expect(body.embeds[0].fields[0].name).toBe('Tech Stack');
    });

    it('truncates title to 256 chars (Discord embed limit)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, { id: 'msg-1', channel_id: 'chan-1' })
      ));
      const longTitle = 'x'.repeat(300);
      await adapter.publish(
        { webhookUrl: 'https://discord.com/api/webhooks/1/abc' },
        { title: longTitle, body: 'body' }
      );
      const init = (vi.mocked(fetch) as unknown as { mock: { calls: Array<unknown[]> } }).mock.calls[0][1] as RequestInit;
      const body = JSON.parse(init.body as string);
      expect(body.embeds[0].title.length).toBe(256);
    });

    it('throws PublishError(AUTH) on 401 (webhook revoked)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, 'unauthorized')));
      await expect(
        adapter.publish(
          { webhookUrl: 'https://discord.com/api/webhooks/1/abc' },
          { title: 'T', body: 'B' }
        )
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(RATE) on 429', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(429, 'slow', { 'Retry-After': '5' })
      ));
      await expect(
        adapter.publish(
          { webhookUrl: 'https://discord.com/api/webhooks/1/abc' },
          { title: 'T', body: 'B' }
        )
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) when webhookUrl missing', async () => {
      await expect(
        adapter.publish({}, { title: 'T', body: 'B' })
      ).rejects.toThrow(PublishError);
    });
  });
});
