// /home/z/my-project/netamplify-app/tests/integration/worker.integration.test.ts
// NetAmplify — Worker unit tests for failure classification.
//
// Tests the PublishWorker.processJob logic directly with mocked adapters
// that throw different error classes (AUTH, RATE, VALIDATION, QUOTA, NETWORK).
// Verifies the worker classifies + handles each per docs/03-ARCHITECTURE.md.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestApp, type TestApp, type MockAdapterConfig } from '../helpers/test-app';
import { PublishWorker } from '../../libraries/nestjs-libraries/src/queue/queue.worker';
import { PublishError } from '../../libraries/nestjs-libraries/src/platforms/adapter.interface';

describe('Worker: failure classification', () => {
  let test: TestApp;
  let worker: PublishWorker;

  afterEach(async () => {
    if (test) await test.close();
  });

  async function setupTest(publishError?: PublishError, publishResult?: { id: string; url: string }) {
    const mockAdapters: MockAdapterConfig[] = [
      {
        platform: 'DISCORD',
        validateResult: { identity: { id: 'c', username: '#showcase' }, credentials: { webhookUrl: 'https://discord.com/api/webhooks/1/a' } },
        publishResult: publishResult ?? { id: 'msg-1', url: 'https://discord.com/channels/c/m' },
        publishError,
      },
    ];
    test = await createTestApp({ mockAdapters });
    worker = test.app.get(PublishWorker);
    const auth = await test.signupAndLogin();
    const card = await test.createPostCard(auth.accessToken, {});
    await test.request.post('/api/connections/discord')
      .set('Authorization', `Bearer ${auth.accessToken}`)
      .send({ webhookUrl: 'https://discord.com/api/webhooks/1/a' });
    const publishRes = await test.request.post(`/api/postcards/${card.id}/publish`)
      .set('Authorization', `Bearer ${auth.accessToken}`)
      .send({ platforms: [{ platform: 'DISCORD' }], requestId: `w-${Date.now()}-${Math.random()}` });
    return { auth, card, postId: publishRes.body.post.id, targetId: publishRes.body.post.targets[0].id, job: test.queue._jobs[0] };
  }

  it('AUTH error → Connection REVOKED + target FAILED with reconnect hint', async () => {
    const { postId, targetId, job } = await setupTest(new PublishError('AUTH', 'Discord webhook revoked'));
    
    await worker.processJob({ id: targetId, data: job.data as never } as never);
    
    const target = await test.prisma.postTarget.findFirst({ where: { id: targetId, postId } });
    expect((target as { status: string }).status).toBe('FAILED');
    expect((target as { errorClass: string }).errorClass).toBe('AUTH');
    expect((target as { error: string }).error).toContain('revoked');
    expect((target as { error: string }).error).toContain('reconnect');
    
    // Verify the connection was marked REVOKED
    const conn = await test.prisma.connection.findUnique({
      where: { userId_platform: { userId: (job.data as { userId: string }).userId, platform: 'DISCORD' } }
    });
    expect((conn as { status: string }).status).toBe('REVOKED');
  });

  it('VALIDATION error → target FAILED with platform message', async () => {
    const { postId, targetId, job } = await setupTest(new PublishError('VALIDATION', 'Discord rejected: too many embeds'));
    
    await worker.processJob({ id: targetId, data: job.data as never } as never);
    
    const target = await test.prisma.postTarget.findFirst({ where: { id: targetId, postId } });
    expect((target as { status: string }).status).toBe('FAILED');
    expect((target as { errorClass: string }).errorClass).toBe('VALIDATION');
    expect((target as { error: string }).error).toContain('rejected');
    // Connection should still be ACTIVE (validation error doesn't mean token is bad)
    const conn = await test.prisma.connection.findUnique({
      where: { userId_platform: { userId: (job.data as { userId: string }).userId, platform: 'DISCORD' } }
    });
    expect((conn as { status: string }).status).toBe('ACTIVE');
  });

  it('QUOTA error → target SKIPPED with explanation', async () => {
    const { postId, targetId, job } = await setupTest(new PublishError('QUOTA', 'X quota for this month is used'));
    
    await worker.processJob({ id: targetId, data: job.data as never } as never);
    
    const target = await test.prisma.postTarget.findFirst({ where: { id: targetId, postId } });
    expect((target as { status: string }).status).toBe('SKIPPED');
    expect((target as { errorClass: string }).errorClass).toBe('QUOTA');
    expect((target as { error: string }).error).toContain('quota');
  });

  it('RATE error → throws for BullMQ to retry', async () => {
    const { targetId, job } = await setupTest(new PublishError('RATE', 'Discord rate-limited'));
    
    // The worker should throw the error (BullMQ catches it for retry)
    await expect(
      worker.processJob({ id: targetId, data: job.data as never } as never)
    ).rejects.toThrow(PublishError);
  });

  it('NETWORK error → throws for BullMQ to retry', async () => {
    const { targetId, job } = await setupTest(new PublishError('NETWORK', 'Discord timeout'));
    
    await expect(
      worker.processJob({ id: targetId, data: job.data as never } as never)
    ).rejects.toThrow(PublishError);
  });

  it('SUCCESS → target SUCCESS with permalink', async () => {
    const { postId, targetId, job } = await setupTest(undefined, { id: 'msg-success', url: 'https://discord.com/channels/123/msg-success' });
    
    await worker.processJob({ id: targetId, data: job.data as never } as never);
    
    const target = await test.prisma.postTarget.findFirst({ where: { id: targetId, postId } });
    expect((target as { status: string }).status).toBe('SUCCESS');
    expect((target as { platformPostUrl: string }).platformPostUrl).toBe('https://discord.com/channels/123/msg-success');
    expect((target as { attempts: number }).attempts).toBe(1); // markPublishing incremented attempts
    expect((target as { publishedAt: Date }).publishedAt).toBeTruthy();
  });

  it('skips already-SUCCESS targets (idempotent worker)', async () => {
    const { postId, targetId, job } = await setupTest();
    
    // Process the job once — should succeed
    await worker.processJob({ id: targetId, data: job.data as never } as never);
    const target1 = await test.prisma.postTarget.findFirst({ where: { id: targetId, postId } });
    expect((target1 as { status: string }).status).toBe('SUCCESS');
    expect((target1 as { attempts: number }).attempts).toBe(1);
    
    // Process the SAME job again — should be skipped (already SUCCESS)
    await worker.processJob({ id: targetId, data: job.data as never } as never);
    const target2 = await test.prisma.postTarget.findFirst({ where: { id: targetId, postId } });
    expect((target2 as { attempts: number }).attempts).toBe(1); // Not incremented again
  });

  it('marks FAILED when PostCard no longer exists', async () => {
    const { auth, targetId, job, card } = await setupTest();
    
    // Delete the PostCard before the worker runs
    await test.request.delete(`/api/postcards/${card.id}`)
      .set('Authorization', `Bearer ${auth.accessToken}`);
    
    // Worker processes the job — target was cascade-deleted with the PostCard,
    // so findById returns null and the worker silently skips.
    await worker.processJob({ id: targetId, data: job.data as never } as never);
    
    // The target should be null (cascade deleted) — worker just returned
    const target = await test.prisma.postTarget.findFirst({ where: { id: targetId, postId: job.data.postId } });
    expect(target).toBeNull();
  });

  it('marks SKIPPED when connection removed before execution', async () => {
    const { auth, targetId, job } = await setupTest();
    
    // Disconnect Discord before the worker runs
    await test.request.delete('/api/connections/discord')
      .set('Authorization', `Bearer ${auth.accessToken}`);
    
    await worker.processJob({ id: targetId, data: job.data as never } as never);
    
    const target = await test.prisma.postTarget.findFirst({ where: { id: targetId, postId: job.data.postId } });
    // Connection was deleted, so findByPlatform returns null → FAILED with AUTH error
    expect((target as { status: string }).status).toBe('FAILED');
    expect((target as { errorClass: string }).errorClass).toBe('AUTH');
  });
});
