// /home/z/my-project/netamplify-app/tests/e2e/amplify-flow.e2e.test.ts
import { PublishWorker } from '../../libraries/nestjs-libraries/src/queue/queue.worker';
import { AdapterRegistry } from '../../libraries/nestjs-libraries/src/platforms/registry';
// NetAmplify — E2E test for the full Amplify flow.
//
// Simulates the exact user journey from the demo script in docs/10-ROADMAP.md:
//   1. Signup (email, password, name)
//   2. Create a PostCard (title, summary, description, techStack)
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

const TELEGRAM_BOT_TOKEN = '7812345678:AAH1234567890abcdefghijklmnopqrstuv';
const TELEGRAM_CHANNEL = '@mychannel';

const mockAdapters: MockAdapterConfig[] = [
  { platform: 'DISCORD',
    validateResult: { identity: { id: 'chan-123', username: '#showcase' }, credentials: { webhookUrl: 'https://discord.com/api/webhooks/123/abc' } },
    publishResult: { id: 'msg-123', url: 'https://discord.com/channels/123/msg-123' } },
  { platform: 'DEVTO',
    validateResult: { identity: { id: '1', username: 'janedev' }, credentials: { apiKey: 'mock' } },
    publishResult: { id: '99', url: 'https://dev.to/janedev/test-123' } },
  { platform: 'TELEGRAM',
    validateResult: { identity: { id: 'chan-1', username: 'My Channel' }, credentials: { botToken: TELEGRAM_BOT_TOKEN, channel: TELEGRAM_CHANNEL, botUsername: 'testbot' } },
    publishResult: { id: '42', url: 'https://t.me/mychannel/42' } },
  { platform: 'BLUESKY',
    validateResult: { identity: { id: 'did:plc:abc', username: 'jane.bsky.social' }, credentials: { accessJwt: 'mock', refreshJwt: 'mock', did: 'did:plc:abc', handle: 'jane.bsky.social' } },
    publishResult: { id: 'rkey-1', url: 'https://bsky.app/profile/jane.bsky.social/post/rkey-1' } },
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
    // Connect 4 Tier A platforms (Discord, Dev.to, Telegram, Bluesky)
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
        botToken: TELEGRAM_BOT_TOKEN,
        channel: TELEGRAM_CHANNEL,
      });
    expect(telegramRes.status).toBe(201);

    const blueskyRes = await test.request.post('/api/connections/bluesky')
      .set('Authorization', `Bearer ${token}`)
      .send({ handle: 'jane.bsky.social', appPassword: 'abcd-efgh-ijkl-mnop' });
    expect(blueskyRes.status).toBe(201);

    // Verify all 4 connections exist
    const listRes = await test.request.get('/api/connections')
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    const connected = listRes.body.filter((c: { platformUsername: string | null }) => c.platformUsername !== null);
    expect(connected.length).toBe(4);

    // === 4. PUBLISH (AMPLIFY) ===
    const publishRes = await test.request.post(`/api/postcards/${postCardId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        platforms: [
          { platform: 'DISCORD' },
          { platform: 'DEVTO' },
          { platform: 'TELEGRAM' },
          { platform: 'BLUESKY' },
        ],
        requestId: `e2e-${Date.now()}`,
      });
    expect(publishRes.status).toBe(201);
    expect(publishRes.body.post.id).toBeTruthy();
    const postId = publishRes.body.post.id;
    const targetIds = publishRes.body.post.targets.map((t: { id: string }) => t.id);
    expect(targetIds.length).toBe(4);

    // Verify all targets are QUEUED (worker hasn't run yet)
    expect(publishRes.body.post.targets.every((t: { status: string }) => t.status === 'QUEUED')).toBe(true);

    // Verify 4 jobs were enqueued
    expect(test.queue._jobs.length).toBe(4);

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
    expect(pollRes.body.post.targets.length).toBe(4);

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
    // Override TELEGRAM to throw an AUTH error
    const auth = await test.signupAndLogin();
    const token = auth.accessToken;
    const card = await test.createPostCard(token, {});

    // Connect 3 platforms
    await test.request.post('/api/connections/discord').set('Authorization', `Bearer ${token}`).send({ webhookUrl: 'https://discord.com/api/webhooks/123/abc' });
    await test.request.post('/api/connections/devto').set('Authorization', `Bearer ${token}`).send({ apiKey: 'mock' });
    await test.request.post('/api/connections/telegram').set('Authorization', `Bearer ${token}`).send({ botToken: TELEGRAM_BOT_TOKEN, channel: TELEGRAM_CHANNEL });

    // Override the TELEGRAM mock adapter to throw AUTH error
    const registry = test.app.get(AdapterRegistry) as unknown as { adapters: Map<string, { publish: (c: unknown, f: unknown) => Promise<unknown> }> };
    const originalTelegram = registry.adapters.get('TELEGRAM');
    if (originalTelegram) {
      const originalPublish = originalTelegram.publish;
      // Replace publish with a failing one
      (originalTelegram as { publish: (c: unknown, f: unknown) => Promise<unknown> }).publish = async () => {
        const { PublishError } = await import('../../libraries/nestjs-libraries/src/platforms/adapter.interface');
        throw new PublishError('AUTH', 'Telegram bot token revoked');
      };
    }

    // Publish to all 3
    const publishRes = await test.request.post(`/api/postcards/${card.id}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        platforms: [
          { platform: 'DISCORD' },
          { platform: 'DEVTO' },
          { platform: 'TELEGRAM' },
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
    // Discord + Dev.to should be SUCCESS; Telegram should be FAILED
    const successCount = statuses.filter((s: string) => s === 'SUCCESS').length;
    const failedCount = statuses.filter((s: string) => s === 'FAILED').length;
    expect(successCount).toBe(2);
    expect(failedCount).toBe(1);

    // The FAILED target should have an error message
    const failedTarget = pollRes.body.post.targets.find((t: { status: string }) => t.status === 'FAILED');
    expect(failedTarget).toBeDefined();
    expect(failedTarget.error).toContain('Telegram');
  });

  it('retry a failed target after partial success', async () => {
    const auth = await test.signupAndLogin();
    const token = auth.accessToken;
    const card = await test.createPostCard(token, {});

    // Connect Discord + Telegram
    await test.request.post('/api/connections/discord').set('Authorization', `Bearer ${token}`).send({ webhookUrl: 'https://discord.com/api/webhooks/123/abc' });
    await test.request.post('/api/connections/telegram').set('Authorization', `Bearer ${token}`).send({ botToken: TELEGRAM_BOT_TOKEN, channel: TELEGRAM_CHANNEL });

    // Override Telegram to fail
    const registry = test.app.get(AdapterRegistry) as unknown as { adapters: Map<string, { publish: (c: unknown, f: unknown) => Promise<unknown> }> };
    const telegramAdapter = registry.adapters.get('TELEGRAM');
    if (telegramAdapter) {
      (telegramAdapter as { publish: (c: unknown, f: unknown) => Promise<unknown> }).publish = async () => {
        const { PublishError } = await import('../../libraries/nestjs-libraries/src/platforms/adapter.interface');
        throw new PublishError('AUTH', 'Telegram revoked');
      };
    }

    // Publish
    const publishRes = await test.request.post(`/api/postcards/${card.id}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        platforms: [{ platform: 'DISCORD' }, { platform: 'TELEGRAM' }],
        requestId: `retry-${Date.now()}`,
      });
    expect(publishRes.status).toBe(201);
    const postId = publishRes.body.post.id;
    const telegramTargetId = publishRes.body.post.targets.find((t: { platform: string }) => t.platform === 'TELEGRAM')?.id;

    // Run worker
    for (const job of test.queue._jobs) {
      const targetId = job.data.postTargetId as string;
      await worker.processJob({
        id: targetId,
        data: job.data as never,
      } as never);
    }

    // Verify Telegram is FAILED
    let pollRes = await test.request.get(`/api/posts/${postId}`)
      .set('Authorization', `Bearer ${token}`);
    const telegramStatus = pollRes.body.post.targets.find((t: { platform: string }) => t.platform === 'TELEGRAM').status;
    expect(telegramStatus).toBe('FAILED');

    // Now "fix" Telegram (replace publish to succeed)
    if (telegramAdapter) {
      (telegramAdapter as { publish: (c: unknown, f: unknown) => Promise<unknown> }).publish = async () => {
        return { id: 't-fixed', url: 'https://t.me/mychannel/42' };
      };
    }

    // Also reset the Connection's status to ACTIVE (mock's markRevoked was called)
    // — manually set the connection status back to ACTIVE
    await test.prisma.connection.update({
      where: { userId_platform: { userId: auth.userId, platform: 'TELEGRAM' } },
      data: { status: 'ACTIVE' },
    });

    // Retry the failed target
    const retryRes = await test.request.post(`/api/posts/${postId}/targets/${telegramTargetId}/retry`)
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

    // Verify Telegram is now SUCCESS
    pollRes = await test.request.get(`/api/posts/${postId}`)
      .set('Authorization', `Bearer ${token}`);
    const finalTelegramStatus = pollRes.body.post.targets.find((t: { platform: string }) => t.platform === 'TELEGRAM').status;
    expect(finalTelegramStatus).toBe('SUCCESS');
  });
});
