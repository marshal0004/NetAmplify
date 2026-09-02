// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/telegram/telegram.adapter.test.ts
// Vitest unit tests for TelegramAdapter.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TelegramAdapter } from './telegram.adapter';
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

describe('TelegramAdapter', () => {
  let adapter: TelegramAdapter;

  beforeEach(() => {
    adapter = new TelegramAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('metadata', () => {
    it('has platform=TELEGRAM, kind=SIMPLE', () => {
      expect(adapter.platform).toBe('TELEGRAM');
      expect(adapter.kind).toBe('SIMPLE');
    });
  });

  describe('validateCredentials()', () => {
    it('returns channel identity on valid bot + channel', async () => {
      const calls = [
        // First call: getMe
        mockResponse(200, {
          ok: true,
          result: { id: 12345678, username: 'testbot', first_name: 'Test Bot' },
        }),
        // Second call: getChat
        mockResponse(200, {
          ok: true,
          result: { id: -1001234567890, type: 'channel', title: 'My Channel', username: 'mychannel' },
        }),
      ];
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(calls.shift() as Response)));

      const result = await adapter.validateCredentials({
        botToken: '7812345678:AAH1234567890abcdefghijklmnopqrstuv',
        channel: '@mychannel',
      });

      expect(result.identity.id).toBe('-1001234567890');
      expect(result.identity.username).toBe('My Channel');
      expect(result.credentials.botToken).toBe('7812345678:AAH1234567890abcdefghijklmnopqrstuv');
      expect(result.credentials.channel).toBe('@mychannel');
      expect(result.credentials.botUsername).toBe('testbot');
    });

    it('adds @ prefix if missing on channel', async () => {
      const calls = [
        mockResponse(200, { ok: true, result: { id: 1, username: 'b', first_name: 'B' } }),
        mockResponse(200, { ok: true, result: { id: -1, type: 'channel', title: 'C', username: 'chan' } }),
      ];
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(calls.shift() as Response)));

      const result = await adapter.validateCredentials({
        botToken: '7812345678:AAH1234567890abcdefghijklmnopqrstuv',
        channel: 'mychannel',
      });
      expect(result.credentials.channel).toBe('@mychannel');
    });

    it('throws PublishError(AUTH) when bot token invalid (getMe fails)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(401, { ok: false, description: 'Unauthorized' })
      ));
      await expect(
        adapter.validateCredentials({ botToken: 'bad', channel: '@c' })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) when bot is not admin of channel (getChat fails)', async () => {
      const calls = [
        mockResponse(200, { ok: true, result: { id: 1, username: 'b', first_name: 'B' } }),
        mockResponse(403, { ok: false, description: 'forbidden: bot is not a member' }),
      ];
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(calls.shift() as Response)));
      await expect(
        adapter.validateCredentials({ botToken: '7812345678:AAH1234567890abcdefghijklmnopqrstuv', channel: '@c' })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when botToken missing', async () => {
      await expect(adapter.validateCredentials({ channel: '@c' })).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when channel missing', async () => {
      await expect(
        adapter.validateCredentials({ botToken: '7812345678:AAH1234567890abcdefghijklmnopqrstuv' })
      ).rejects.toThrow(PublishError);
    });
  });

  describe('publish()', () => {
    it('posts an HTML message on success', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse(200, {
          ok: true,
          result: { message_id: 42, chat: { id: -1001234567890, username: 'mychannel' } },
        })
      );
      vi.stubGlobal('fetch', mockFetch);

      const result = await adapter.publish(
        { botToken: '7812345678:AAH1234567890abcdefghijklmnopqrstuv', channel: '@mychannel' },
        { title: 'Test Post', body: 'Body text', url: 'https://example.com', hashtags: ['typescript'] }
      );

      expect(result.id).toBe('42');
      expect(result.url).toBe('https://t.me/mychannel/42');

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('sendMessage');
      expect(init.body).toContain('chat_id=%40mychannel');
      expect(init.body).toContain('parse_mode=HTML');
      // Title is HTML-escaped + bolded
      expect(init.body).toContain('%3Cb%3E'); // <b>
      expect(init.body).toContain('Test+Post');
    });

    it('throws PublishError(VALIDATION) when message > 4096 chars', async () => {
      const longBody = 'x'.repeat(5000);
      await expect(
        adapter.publish(
          { botToken: '7812345678:AAH1234567890abcdefghijklmnopqrstuv', channel: '@c' },
          { title: 'T', body: longBody }
        )
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) on 401', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(401, { description: 'Unauthorized' })
      ));
      await expect(
        adapter.publish(
          { botToken: '7812345678:AAH1234567890abcdefghijklmnopqrstuv', channel: '@c' },
          { title: 'T', body: 'B' }
        )
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(RATE) on 429', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(429, { description: 'slow', parameters: { retry_after: 30 } })
      ));
      await expect(
        adapter.publish(
          { botToken: '7812345678:AAH1234567890abcdefghijklmnopqrstuv', channel: '@c' },
          { title: 'T', body: 'B' }
        )
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) when bot is no longer admin (chat not found)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(403, { description: 'Forbidden: bot was kicked from the channel' })
      ));
      await expect(
        adapter.publish(
          { botToken: '7812345678:AAH1234567890abcdefghijklmnopqrstuv', channel: '@c' },
          { title: 'T', body: 'B' }
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
