// /home/z/my-project/netamplify-app/tests/integration/publish.integration.test.ts
// NetAmplify — Integration tests for /api/postcards/:id/publish + /api/posts/* endpoints.
//
// Uses mocked adapters so we don't make real platform API calls.
// Mocks: all 8 platforms return success on validateCredentials + publish.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestApp, type TestApp, type MockAdapterConfig } from '../helpers/test-app';
import { PublishError } from '../../libraries/nestjs-libraries/src/platforms/adapter.interface';

const mockAdapters: MockAdapterConfig[] = [
  { platform: 'REDDIT', validateResult: { identity: { id: 't2_abc', username: 'testuser' }, credentials: { accessToken: 'mock', refreshToken: 'mock', scopes: ['identity', 'submit'] } },
    publishResult: { id: 't3_xyz', url: 'https://reddit.com/r/test/comments/xyz/title/' } },
  { platform: 'TWITTER', validateResult: { identity: { id: '123', username: '@test' }, credentials: { accessToken: 'mock', refreshToken: 'mock', scopes: [] } },
    publishResult: { id: 'tweet-123', url: 'https://x.com/i/status/tweet-123' } },
  { platform: 'LINKEDIN', validateResult: { identity: { id: 'li-123', username: 'Test User' }, credentials: { accessToken: 'mock', memberId: 'li-123', scopes: [] } },
    publishResult: { id: 'urn:li:ugcPost:123', url: 'https://linkedin.com/feed/update/urn:li:ugcPost:123/' } },
  { platform: 'DISCORD', validateResult: { identity: { id: 'chan-123', username: '#showcase' }, credentials: { webhookUrl: 'https://discord.com/api/webhooks/123/abc' } },
    publishResult: { id: 'msg-123', url: 'https://discord.com/channels/123/msg-123' } },
  { platform: 'DEVTO', validateResult: { identity: { id: '1', username: 'janedev' }, credentials: { apiKey: 'mock' } },
    publishResult: { id: '99', url: 'https://dev.to/janedev/test-123' } },
  { platform: 'HASHNODE', validateResult: { identity: { id: 'u-1', username: 'janedev' }, credentials: { pat: 'mock', publicationId: 'pub-1' } },
    publishResult: { id: 'p-1', url: 'https://janedev.hashnode.dev/test' } },
  { platform: 'TELEGRAM', validateResult: { identity: { id: 'chan-1', username: 'My Channel' }, credentials: { botToken: '7812345678:AAH1234567890abcdefghijklmnopqrstuv', channel: '@mychannel' } },
    publishResult: { id: '42', url: 'https://t.me/mychannel/42' } },
  { platform: 'BLUESKY', validateResult: { identity: { id: 'did:plc:abc', username: 'jane.bsky.social' }, credentials: { accessJwt: 'mock', refreshJwt: 'mock', did: 'did:plc:abc', handle: 'jane.bsky.social' } },
    publishResult: { id: 'rkey-123', url: 'https://bsky.app/profile/jane.bsky.social/post/rkey-123' } },
];

async function connectAll(test: TestApp, token: string) {
  // Connect each platform with valid mock inputs
  await test.request.post('/api/connections/discord').set('Authorization', `Bearer ${token}`).send({ webhookUrl: 'https://discord.com/api/webhooks/123/abc' });
  await test.request.post('/api/connections/devto').set('Authorization', `Bearer ${token}`).send({ apiKey: 'test-key' });
  await test.request.post('/api/connections/hashnode').set('Authorization', `Bearer ${token}`).send({ pat: 'test-pat' });
  await test.request.post('/api/connections/telegram').set('Authorization', `Bearer ${token}`).send({ botToken: '7812345678:AAH1234567890abcdefghijklmnopqrstuv', channel: '@mychannel' });
  await test.request.post('/api/connections/bluesky').set('Authorization', `Bearer ${token}`).send({ handle: 'jane.bsky.social', appPassword: 'abcd-efgh-ijkl-mnop' });
  // OAuth platforms (REDDIT, TWITTER, LINKEDIN) require OAuth callback flow;
  // we'll skip them in this test since the callback requires real redirect
}

describe('Integration: Publish', () => {
  let test: TestApp;
  let token: string;
  let postCardId: string;

  beforeEach(async () => {
    test = await createTestApp({ mockAdapters });
    const auth = await test.signupAndLogin();
    token = auth.accessToken;
    const card = await test.createPostCard(token, {
      title: 'Publishable Project',
      summary: 'Test publish',
      description: 'Description body',
    });
    postCardId = card.id;
  });

  afterEach(async () => {
    await test.close();
  });

  describe('POST /api/postcards/:id/publish', () => {
    it('returns 400 when no connections exist for any requested platform', async () => {
      const res = await test.request.post(`/api/postcards/${postCardId}/publish`)
        .set('Authorization', `Bearer ${token}`)
        .send({ platforms: [{ platform: 'REDDIT' }] });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('No active connection');
    });

    it('returns 400 on empty platforms array', async () => {
      const res = await test.request.post(`/api/postcards/${postCardId}/publish`)
        .set('Authorization', `Bearer ${token}`)
        .send({ platforms: [] });
      expect(res.status).toBe(400);
    });

    it('returns 400 on unknown platform', async () => {
      const res = await test.request.post(`/api/postcards/${postCardId}/publish`)
        .set('Authorization', `Bearer ${token}`)
        .send({ platforms: [{ platform: 'INSTAGRAM' }] });
      expect(res.status).toBe(400);
    });

    it('returns 404 on non-existent PostCard', async () => {
      const res = await test.request.post('/api/postcards/nonexistent/publish')
        .set('Authorization', `Bearer ${token}`)
        .send({ platforms: [{ platform: 'REDDIT' }] });
      expect(res.status).toBe(404);
    });

    it('returns 401 without JWT', async () => {
      const res = await test.request.post(`/api/postcards/${postCardId}/publish`)
        .send({ platforms: [{ platform: 'REDDIT' }] });
      expect(res.status).toBe(401);
    });

    it('creates Post + PostTargets (QUEUED) for connected platform', async () => {
      // First connect Discord
      await test.request.post('/api/connections/discord')
        .set('Authorization', `Bearer ${token}`)
        .send({ webhookUrl: 'https://discord.com/api/webhooks/123/abc' });

      const res = await test.request.post(`/api/postcards/${postCardId}/publish`)
        .set('Authorization', `Bearer ${token}`)
        .send({ platforms: [{ platform: 'DISCORD' }], requestId: 'test-request-1' });

      expect(res.status).toBe(201);
      expect(res.body.post).toBeDefined();
      expect(res.body.post.id).toBeTruthy();
      expect(Array.isArray(res.body.post.targets)).toBe(true);
      expect(res.body.post.targets.length).toBe(1);
      expect(res.body.post.targets[0].platform).toBe('DISCORD');
      // Status is QUEUED because the worker is disabled in tests (DISABLE_WORKERS=true)
      expect(res.body.post.targets[0].status).toBe('QUEUED');

      // Verify the job was enqueued
      expect(test.queue._jobs.length).toBe(1);
      expect(test.queue._jobs[0].name).toBe('publish');
      expect(test.queue._jobs[0].data.postTargetId).toBe(res.body.post.targets[0].id);
    });

    it('idempotency: same requestId returns the same Post', async () => {
      // First connect Discord
      await test.request.post('/api/connections/discord')
        .set('Authorization', `Bearer ${token}`)
        .send({ webhookUrl: 'https://discord.com/api/webhooks/123/abc' });

      const requestId = 'idempotency-test-123';
      // First publish
      const res1 = await test.request.post(`/api/postcards/${postCardId}/publish`)
        .set('Authorization', `Bearer ${token}`)
        .send({ platforms: [{ platform: 'DISCORD' }], requestId });
      expect(res1.status).toBe(201);
      const firstPostId = res1.body.post.id;

      // Second publish with same requestId — should return same Post
      const res2 = await test.request.post(`/api/postcards/${postCardId}/publish`)
        .set('Authorization', `Bearer ${token}`)
        .send({ platforms: [{ platform: 'DISCORD' }], requestId });
      expect(res2.status).toBe(201);
      expect(res2.body.post.id).toBe(firstPostId);
      expect(res2.body.post.targets.length).toBe(1);

      // Queue should have only 1 job (idempotent — no re-publish)
      expect(test.queue._jobs.length).toBe(1);
    });
  });

  describe('GET /api/posts', () => {
    it('returns paginated list of user\'s Posts', async () => {
      // Connect + publish
      await test.request.post('/api/connections/discord')
        .set('Authorization', `Bearer ${token}`)
        .send({ webhookUrl: 'https://discord.com/api/webhooks/123/abc' });
      await test.request.post(`/api/postcards/${postCardId}/publish`)
        .set('Authorization', `Bearer ${token}`)
        .send({ platforms: [{ platform: 'DISCORD' }], requestId: 'list-test-1' });

      const res = await test.request.get('/api/posts')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBe(1);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0].post.targets.length).toBe(1);
    });

    it('returns 401 without JWT', async () => {
      const res = await test.request.get('/api/posts');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/posts/:id', () => {
    it('returns Post + targets', async () => {
      await test.request.post('/api/connections/discord')
        .set('Authorization', `Bearer ${token}`)
        .send({ webhookUrl: 'https://discord.com/api/webhooks/123/abc' });
      const publishRes = await test.request.post(`/api/postcards/${postCardId}/publish`)
        .set('Authorization', `Bearer ${token}`)
        .send({ platforms: [{ platform: 'DISCORD' }], requestId: 'get-by-id-test' });

      const res = await test.request.get(`/api/posts/${publishRes.body.post.id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.post.id).toBe(publishRes.body.post.id);
      expect(res.body.post.targets.length).toBe(1);
    });

    it('returns 404 for non-existent Post', async () => {
      const res = await test.request.get('/api/posts/nonexistent')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/posts/:id/targets/:targetId/retry', () => {
    it('returns 409 when target is not FAILED (status=QUEUED)', async () => {
      await test.request.post('/api/connections/discord')
        .set('Authorization', `Bearer ${token}`)
        .send({ webhookUrl: 'https://discord.com/api/webhooks/123/abc' });
      const publishRes = await test.request.post(`/api/postcards/${postCardId}/publish`)
        .set('Authorization', `Bearer ${token}`)
        .send({ platforms: [{ platform: 'DISCORD' }], requestId: 'retry-test' });
      const targetId = publishRes.body.post.targets[0].id;
      const postId = publishRes.body.post.id;

      // Target is QUEUED (not FAILED), so retry should return 409
      const res = await test.request.post(`/api/posts/${postId}/targets/${targetId}/retry`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(409);
    });

    it('returns 404 for non-existent Post', async () => {
      const res = await test.request.post('/api/posts/nonexistent/targets/target-1/retry')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('returns 401 without JWT', async () => {
      const res = await test.request.post('/api/posts/post-1/targets/target-1/retry');
      expect(res.status).toBe(401);
    });
  });
});
