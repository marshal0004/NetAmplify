// /home/z/my-project/netamplify-app/tests/e2e/amplify-flow.e2e.test.ts
import { PublishWorker } from '../../libraries/nestjs-libraries/src/queue/queue.worker';
import { AdapterRegistry } from '../../libraries/nestjs-libraries/src/platforms/registry';
// NetAmplify — E2E test for the full Amplify flow.
//
// Simulates the exact user journey from the demo script in docs/10-ROADMAP.md:
//   1. Signup (email, password, name)
//   2. Create a PostCard (title, summary, description, techStack)
//   3. Connect platforms (Discord + Dev.to + Reddit via mock)
//   4. Publish to N platforms (one-click Amplify)
//   5. Poll for status until terminal
//   6. Assert: all targets SUCCESS (or appropriate terminal status)
//
// The "worker" is the PublishWorker.processJob — we invoke it directly here
// (synchronously) instead of going through BullMQ. This lets us test the
// full publish pipeline in-process without Docker/Redis.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestApp, type TestApp, type MockAdapterConfig } from '../helpers/test-app';
import { PublishWorker } from '../../libraries/nestjs-libraries/src/queue/queue.worker';

const mockAdapters: MockAdapterConfig[] = [
  { platform: 'DISCORD',
    validateResult: { identity: { id: 'chan-123', username: '#showcase' }, credentials: { webhookUrl: 'https://discord.com/api/webhooks/123/abc' } },
    publishResult: { id: 'msg-123', url: 'https://discord.com/channels/123/msg-123' } },
  { platform: 'DEVTO',
    validateResult: { identity: { id: '1', username: 'janedev' }, credentials: { apiKey: 'mock' } },
    publishResult: { id: '99', url: 'https://dev.to/janedev/test-123' } },
  { platform: 'HASHNODE',
    validateResult: { identity: { id: 'u-1', username: 'janedev' }, credentials: { pat: 'mock', publicationId: 'pub-1' } },
    publishResult: { id: 'p-1', url: 'https://janedev.hashnode.dev/test' } },
  { platform: 'TELEGRAM',
    validateResult: { identity: { id: 'chan-1', username: 'My Channel' }, credentials: { botToken: '7812345678:AAH1234567890abcdefghijklmnopqrstuv', channel: '@mychannel' } },
    publishResult: { id: '42', url: 'https://t.me/mychannel/42' } },
  { platform: 'BLUESKY',
    validateResult: { identity: { id: 'did:plc:abc', username: 'jane.bsky.social' }, credentials: { accessJwt: 'mock', refreshJwt: 'mock', did: 'did:plc:abc', handle: 'jane.bsky.social' } },
    publishResult: { id: 'rkey-1', url: 'https://bsky.app/profile/jane.bsky.social/post/rkey-1' } },
  { platform: 'REDDIT',
    validateResult: { identity: { id: 't2_abc', username: 'testuser' }, credentials: { accessToken: 'mock', refreshToken: 'mock', scopes: ['identity', 'submit'] } },
    publishResult: { id: 't3_xyz', url: 'https://reddit.com/r/test/comments/xyz/title/' } },
];

describe('E2E: Amplify flow (signup → connect → publish → SUCCESS)', () => {
  let test: TestApp;
  let worker: PublishWorker;

  beforeEach(async () => {
    test = await createTestApp({ mockAdapters });
    // Get the worker instance (it's a provider in QueueModule)
    worker = test.app.get(PublishWorker);
  });

  afterEach(async () => {
    await test.close();
  });

  it('full user journey: signup → create card → connect → publish → SUCCESS', async () => {
    // === 1. SIGNUP ===
    const email = `demo_${Date.now()}@example.com`;
    const signupRes = await test.request.post('/api/auth/signup').send({
      email,
      password: 'StrongPass1',
      name: 'Demo Student',
    });
    expect(signupRes.status).toBe(201);
    const token = signupRes.body.accessToken;
    const userId = signupRes.body.user.id;
    expect(token).toBeTruthy();

    // === 2. CREATE POSTCARD ===
    const cardRes = await test.request.post('/api/postcards')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'NetAmplify Itself',
        summary: 'A demo post about NetAmplify',
        description: '## What it does\n\nNetAmplify lets students post once → everywhere.',
        techStack: ['TypeScript', 'NestJS', 'React'],
        repoUrl: 'https://github.com/marshal0004/NetAmplify',
        liveUrl: 'https://netamplify.example.com',
      });
    expect(cardRes.status).toBe(201);
    const postCardId = cardRes.body.id;

    // === 3. CONNECT PLATFORMS ===
    // Connect 5 Tier A platforms (Discord, Dev.to, Telegram, Bluesky, Hashnode)
    const discordRes = await test.request.post('/api/connections/discord')
      .set('Authorization', `Bearer ${token}`)
      .send({ webhookUrl: 'https://discord.com/api/webhooks/123/abc' });
    expect(discordRes.status).toBe(201);

    const devtoRes = await test.request.post('/api/connections/devto')
      .set('Authorization', `Bearer ${token}`)
      .send({ apiKey: 'mock-devto-key' });
    expect(devtoRes.status).toBe(201);

    const telegramRes = await test.request.post('/api/connections/telegram')
      .set('Authorization', `Bearer ${token}`)
      .send({
        botToken: '7812345678:AAH1234567890abcdefghijklmnopqrstuv',
        channel: '@mychannel',
      });
    expect(telegramRes.status).toBe(201);

    const blueskyRes = await test.request.post('/api/connections/bluesky')
      .set('Authorization', `Bearer ${token}`)
      .send({ handle: 'jane.bsky.social', appPassword: 'abcd-efgh-ijkl-mnop' });
    expect(blueskyRes.status).toBe(201);

    const hashnodeRes = await test.request.post('/api/connections/hashnode')
      .set('Authorization', `Bearer ${token}`)
      .send({ pat: 'mock-hashnode-pat' });
    expect(hashnodeRes.status).toBe(201);

    // Verify all 5 connections exist
    const listRes = await test.request.get('/api/connections')
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    const connected = listRes.body.filter((c: { platformUsername: string | null }) => c.platformUsername !== null);
    expect(connected.length).toBe(5);

    // === 4. PUBLISH (AMPLIFY) ===
    const publishRes = await test.request.post(`/api/postcards/${postCardId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        platforms: [
          { platform: 'DISCORD' },
          { platform: 'DEVTO' },
          { platform: 'TELEGRAM' },
          { platform: 'BLUESKY' },
          { platform: 'HASHNODE' },
        ],
        requestId: `e2e-${Date.now()}`,
      });
    expect(publishRes.status).toBe(201);
    expect(publishRes.body.post.id).toBeTruthy();
    const postId = publishRes.body.post.id;
    const targetIds = publishRes.body.post.targets.map((t: { id: string }) => t.id);
    expect(targetIds.length).toBe(5);

    // Verify all targets are QUEUED (worker hasn't run yet)
    expect(publishRes.body.post.targets.every((t: { status: string }) => t.status === 'QUEUED')).toBe(true);

    // Verify 5 jobs were enqueued
    expect(test.queue._jobs.length).toBe(5);

    // === 5. SIMULATE WORKER PROCESSING EACH JOB ===
    for (const job of test.queue._jobs) {
      const targetId = job.data.postTargetId as string;
      await worker.processJob({
        id: targetId,
        data: job.data as never,
        // BullMQ Job interface; mock minimal fields
      } as never);
    }

    // === 6. POLL FOR STATUS ===
    const pollRes = await test.request.get(`/api/posts/${postId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(pollRes.status).toBe(200);
    expect(pollRes.body.post.targets.length).toBe(5);

    // === 7. ASSERT ALL TARGETS REACHED SUCCESS ===
    const statuses = pollRes.body.post.targets.map((t: { status: string }) => t.status);
    for (const s of statuses) {
      expect(s).toBe('SUCCESS');
    }
    // All permalinks should be set
    for (const t of pollRes.body.post.targets) {
      expect(t.platformPostUrl ?? t.url).toBeTruthy();
    }
  });

  it('partial success: one platform fails, others succeed', async () => {
    // Override HASHNODE to throw an AUTH error
    const auth = await test.signupAndLogin();
    const token = auth.accessToken;
    const card = await test.createPostCard(token, {});

    // Connect 3 platforms
    await test.request.post('/api/connections/discord').set('Authorization', `Bearer ${token}`).send({ webhookUrl: 'https://discord.com/api/webhooks/123/abc' });
    await test.request.post('/api/connections/devto').set('Authorization', `Bearer ${token}`).send({ apiKey: 'mock' });
    await test.request.post('/api/connections/hashnode').set('Authorization', `Bearer ${token}`).send({ pat: 'mock' });

    // Override the HASHNODE mock adapter to throw AUTH error
    const registry = test.app.get(AdapterRegistry) as unknown as { adapters: Map<string, { publish: (c: unknown, f: unknown) => Promise<unknown> }> };
    const originalHashnode = registry.adapters.get('HASHNODE');
    if (originalHashnode) {
      const originalPublish = originalHashnode.publish;
      // Replace publish with a failing one
      (originalHashnode as { publish: (c: unknown, f: unknown) => Promise<unknown> }).publish = async () => {
        const { PublishError } = await import('../../libraries/nestjs-libraries/src/platforms/adapter.interface');
        throw new PublishError('AUTH', 'Hashnode token revoked');
      };
    }

    // Publish to all 3
    const publishRes = await test.request.post(`/api/postcards/${card.id}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        platforms: [
          { platform: 'DISCORD' },
          { platform: 'DEVTO' },
          { platform: 'HASHNODE' },
        ],
        requestId: `partial-${Date.now()}`,
      });
    expect(publishRes.status).toBe(201);
    const postId = publishRes.body.post.id;

    // Run worker for each target
    for (const job of test.queue._jobs) {
      const targetId = job.data.postTargetId as string;
      await worker.processJob({
        id: targetId,
        data: job.data as never,
      } as never);
    }

    // Poll status
    const pollRes = await test.request.get(`/api/posts/${postId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(pollRes.status).toBe(200);

    const statuses = pollRes.body.post.targets.map((t: { status: string }) => t.status);
    // Discord + Dev.to should be SUCCESS; Hashnode should be FAILED
    const successCount = statuses.filter((s: string) => s === 'SUCCESS').length;
    const failedCount = statuses.filter((s: string) => s === 'FAILED').length;
    expect(successCount).toBe(2);
    expect(failedCount).toBe(1);

    // The FAILED target should have an error message
    const failedTarget = pollRes.body.post.targets.find((t: { status: string }) => t.status === 'FAILED');
    expect(failedTarget).toBeDefined();
    expect(failedTarget.error).toContain('Hashnode');
  });

  it('retry a failed target after partial success', async () => {
    const auth = await test.signupAndLogin();
    const token = auth.accessToken;
    const card = await test.createPostCard(token, {});

    // Connect Discord + Hashnode
    await test.request.post('/api/connections/discord').set('Authorization', `Bearer ${token}`).send({ webhookUrl: 'https://discord.com/api/webhooks/123/abc' });
    await test.request.post('/api/connections/hashnode').set('Authorization', `Bearer ${token}`).send({ pat: 'mock' });

    // Override Hashnode to fail
    const registry = test.app.get(AdapterRegistry) as unknown as { adapters: Map<string, { publish: (c: unknown, f: unknown) => Promise<unknown> }> };
    const hashnodeAdapter = registry.adapters.get('HASHNODE');
    if (hashnodeAdapter) {
      (hashnodeAdapter as { publish: (c: unknown, f: unknown) => Promise<unknown> }).publish = async () => {
        const { PublishError } = await import('../../libraries/nestjs-libraries/src/platforms/adapter.interface');
        throw new PublishError('AUTH', 'Hashnode revoked');
      };
    }

    // Publish
    const publishRes = await test.request.post(`/api/postcards/${card.id}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        platforms: [{ platform: 'DISCORD' }, { platform: 'HASHNODE' }],
        requestId: `retry-${Date.now()}`,
      });
    expect(publishRes.status).toBe(201);
    const postId = publishRes.body.post.id;
    const hashnodeTargetId = publishRes.body.post.targets.find((t: { platform: string }) => t.platform === 'HASHNODE')?.id;

    // Run worker
    for (const job of test.queue._jobs) {
      const targetId = job.data.postTargetId as string;
      await worker.processJob({
        id: targetId,
        data: job.data as never,
      } as never);
    }

    // Verify Hashnode is FAILED
    let pollRes = await test.request.get(`/api/posts/${postId}`)
      .set('Authorization', `Bearer ${token}`);
    const hashnodeStatus = pollRes.body.post.targets.find((t: { platform: string }) => t.platform === 'HASHNODE').status;
    expect(hashnodeStatus).toBe('FAILED');

    // Now "fix" Hashnode (replace publish to succeed)
    if (hashnodeAdapter) {
      (hashnodeAdapter as { publish: (c: unknown, f: unknown) => Promise<unknown> }).publish = async () => {
        return { id: 'p-fixed', url: 'https://janedev.hashnode.dev/test' };
      };
    }

    // Also reset the Connection's status to ACTIVE (mock's markRevoked was called)
    // — manually set the connection status back to ACTIVE
    await test.prisma.connection.update({
      where: { userId_platform: { userId: auth.userId, platform: 'HASHNODE' } },
      data: { status: 'ACTIVE' },
    });

    // Retry the failed target
    const retryRes = await test.request.post(`/api/posts/${postId}/targets/${hashnodeTargetId}/retry`)
      .set('Authorization', `Bearer ${token}`);
    expect(retryRes.status).toBe(200);

    // Run worker for the retry job
    for (const job of test.queue._jobs) {
      const targetId = job.data.postTargetId as string;
      // Only retry the new jobs (skip ones already done)
      const target = await test.prisma.postTarget.findFirst({ where: { id: targetId, postId } });
      if (target && (target as { status: string }).status !== 'SUCCESS') {
        await worker.processJob({
          id: targetId,
          data: job.data as never,
        } as never);
      }
    }

    // Verify Hashnode is now SUCCESS
    pollRes = await test.request.get(`/api/posts/${postId}`)
      .set('Authorization', `Bearer ${token}`);
    const finalHashnodeStatus = pollRes.body.post.targets.find((t: { platform: string }) => t.platform === 'HASHNODE').status;
    expect(finalHashnodeStatus).toBe('SUCCESS');
  });
});
