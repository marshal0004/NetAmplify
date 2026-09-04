// /home/z/my-project/netamplify-app/tests/integration/connections.integration.test.ts
// NetAmplify — Integration tests for /api/connections/* endpoints.
//
// Connections to Reddit/X/LinkedIn require OAuth (real browser redirect).
// Connections to Dev.to/Discord/Telegram/Bluesky/Hashnode accept user-pasted
// credentials + validate them via real platform API calls. Tests use
// mocked adapters to simulate platform responses.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestApp, type TestApp, type MockAdapterConfig } from '../helpers/test-app';
import { PublishError } from '../../libraries/nestjs-libraries/src/platforms/adapter.interface';

describe('Integration: Connections', () => {
  let test: TestApp;
  let token: string;

  beforeEach(async () => {
    // Use mock adapters so we don't make real HTTP calls to platforms
    test = await createTestApp({
      mockAdapters: [
        {
          platform: 'DISCORD',
          validateResult: {
            identity: { id: 'channel-123', username: '#showcase' },
            credentials: { webhookUrl: 'https://discord.com/api/webhooks/123/abc', webhookId: '123' },
          },
          publishResult: { id: 'msg-123', url: 'https://discord.com/channels/123/456' },
        },
        {
          platform: 'DEVTO',
          validateResult: {
            identity: { id: 'user-123', username: 'janedev' },
            credentials: { apiKey: 'devto-api-key-123' },
          },
        },
        {
          platform: 'TELEGRAM',
          validateResult: {
            identity: { id: 'channel-123', username: 'My Channel' },
            credentials: {
              botToken: '7812345678:AAH1234567890abcdefghijklmnopqrstuv',
              channel: '@mychannel',
              botUsername: 'testbot',
            },
          },
        },
        {
          platform: 'BLUESKY',
          validateResult: {
            identity: { id: 'did:plc:abc123', username: 'jane.bsky.social' },
            credentials: {
              accessJwt: 'jwt-access', refreshJwt: 'jwt-refresh',
              did: 'did:plc:abc123', handle: 'jane.bsky.social',
            },
          },
        },
        {
          platform: 'HASHNODE',
          validateResult: {
            identity: { id: 'user-123', username: 'janedev' },
            credentials: { pat: 'hashnode-pat-123', publicationId: 'pub-123' },
          },
        },

      ],
    });
    const auth = await test.signupAndLogin();
    token = auth.accessToken;
  });

  afterEach(async () => {
    await test.close();
  });

  describe('GET /api/connections', () => {
    it('returns 8 platforms with "not connected" status', async () => {
      const res = await test.request.get('/api/connections')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(8);
      // All 8 platforms should be present
      const platforms = res.body.map((c: { platform: string }) => c.platform);
      expect(platforms).toContain('REDDIT');
      expect(platforms).toContain('DISCORD');
      expect(platforms).toContain('DEVTO');
      expect(platforms).toContain('TELEGRAM');
      expect(platforms).toContain('BLUESKY');
      expect(platforms).toContain('HASHNODE');
      expect(platforms).toContain('TWITTER');
      expect(platforms).toContain('LINKEDIN');
    });

    it('returns 401 without JWT', async () => {
      const res = await test.request.get('/api/connections');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/connections/discord', () => {
    it('returns 201 + username on valid webhook (mock validation)', async () => {
      const res = await test.request.post('/api/connections/discord')
        .set('Authorization', `Bearer ${token}`)
        .send({ webhookUrl: 'https://discord.com/api/webhooks/123/abc' });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeTruthy();
      expect(res.body.username).toBe('#showcase');
    });

    it('returns 400 on missing webhookUrl', async () => {
      const res = await test.request.post('/api/connections/discord')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('returns 400 on non-Discord URL', async () => {
      const res = await test.request.post('/api/connections/discord')
        .set('Authorization', `Bearer ${token}`)
        .send({ webhookUrl: 'https://example.com/not-discord' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/connections/devto', () => {
    it('returns 201 + username on valid API key', async () => {
      const res = await test.request.post('/api/connections/devto')
        .set('Authorization', `Bearer ${token}`)
        .send({ apiKey: 'devto-test-key' });
      expect(res.status).toBe(201);
      expect(res.body.username).toBe('janedev');
    });

    it('returns 400 on missing apiKey', async () => {
      const res = await test.request.post('/api/connections/devto')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/connections/telegram', () => {
    it('returns 201 on valid bot token + channel', async () => {
      const res = await test.request.post('/api/connections/telegram')
        .set('Authorization', `Bearer ${token}`)
        .send({
          botToken: '7812345678:AAH1234567890abcdefghijklmnopqrstuv',
          channel: '@mychannel',
        });
      expect(res.status).toBe(201);
      expect(res.body.username).toBe('My Channel');
    });

    it('returns 400 on missing botToken', async () => {
      const res = await test.request.post('/api/connections/telegram')
        .set('Authorization', `Bearer ${token}`)
        .send({ channel: '@mychannel' });
      expect(res.status).toBe(400);
    });

    it('returns 400 on invalid bot token format', async () => {
      const res = await test.request.post('/api/connections/telegram')
        .set('Authorization', `Bearer ${token}`)
        .send({ botToken: 'invalid-token', channel: '@c' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/connections/bluesky', () => {
    it('returns 201 on valid handle + app password', async () => {
      const res = await test.request.post('/api/connections/bluesky')
        .set('Authorization', `Bearer ${token}`)
        .send({ handle: 'jane.bsky.social', appPassword: 'abcd-efgh-ijkl-mnop' });
      expect(res.status).toBe(201);
      expect(res.body.username).toBe('jane.bsky.social');
    });

    it('returns 400 on missing handle', async () => {
      const res = await test.request.post('/api/connections/bluesky')
        .set('Authorization', `Bearer ${token}`)
        .send({ appPassword: 'abcd-efgh-ijkl-mnop' });
      expect(res.status).toBe(400);
    });

    it('returns 400 on bad app password format', async () => {
      const res = await test.request.post('/api/connections/bluesky')
        .set('Authorization', `Bearer ${token}`)
        .send({ handle: 'jane.bsky.social', appPassword: 'no-dashes-here' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/connections/hashnode', () => {
    it('returns 201 on valid PAT', async () => {
      const res = await test.request.post('/api/connections/hashnode')
        .set('Authorization', `Bearer ${token}`)
        .send({ pat: 'hashnode-pat-test' });
      expect(res.status).toBe(201);
      expect(res.body.username).toBe('janedev');
    });

    it('returns 400 on missing PAT', async () => {
      const res = await test.request.post('/api/connections/hashnode')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/connections/:platform', () => {
    it('returns 204 for existing connection', async () => {
      // First connect
      await test.request.post('/api/connections/discord')
        .set('Authorization', `Bearer ${token}`)
        .send({ webhookUrl: 'https://discord.com/api/webhooks/123/abc' });
      // Then disconnect
      const res = await test.request.delete('/api/connections/discord')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(204);

      // Verify connection is gone
      const listRes = await test.request.get('/api/connections')
        .set('Authorization', `Bearer ${token}`);
      const discord = listRes.body.find((c: { platform: string }) => c.platform === 'DISCORD');
      expect(discord.platformUsername).toBeNull();
    });

    it('returns 404 for non-existent connection', async () => {
      const res = await test.request.delete('/api/connections/reddit')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('returns 400 for unknown platform', async () => {
      const res = await test.request.delete('/api/connections/instagram')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    });
  });
});
