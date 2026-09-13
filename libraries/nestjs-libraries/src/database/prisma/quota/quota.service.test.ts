// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/database/prisma/quota/quota.service.test.ts
// Vitest unit tests for QuotaService — mocked at Prisma boundary.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QuotaService } from './quota.service';
import type { PrismaService } from '../prisma.service';

const mockPrisma = () => {
  const quotaStore = new Map<string, number>();
  return {
    quotaUsage: {
      findUnique: vi.fn(async ({ where }: { where: { platform_yearMonth: { platform: string; yearMonth: string } } }) => {
        const key = `${where.platform_yearMonth.platform}_${where.platform_yearMonth.yearMonth}`;
        const used = quotaStore.get(key) ?? 0;
        return { platform: where.platform_yearMonth.platform, yearMonth: where.platform_yearMonth.yearMonth, used };
      }),
      upsert: vi.fn(async ({ where, create, update }: {
        where: { platform_yearMonth: { platform: string; yearMonth: string } };
        create: { platform: string; yearMonth: string; used: number };
        update: { used: { increment: number } };
      }) => {
        const key = `${where.platform_yearMonth.platform}_${where.platform_yearMonth.yearMonth}`;
        const current = quotaStore.get(key) ?? 0;
        // When the record exists, use the increment; otherwise use create.used
        const newUsed = quotaStore.has(key)
          ? current + (update.used as { increment: number }).increment
          : create.used;
        quotaStore.set(key, newUsed);
        return { ...create, used: newUsed };
      }),
    },
    // Test helpers
    _setUsed(platform: string, yearMonth: string, used: number) {
      quotaStore.set(`${platform}_${yearMonth}`, used);
    },
    _reset() {
      quotaStore.clear();
    },
  };
};

describe('QuotaService', () => {
  let quota: QuotaService;
  let prisma: ReturnType<typeof mockPrisma>;

  const originalBudget = process.env.X_MONTHLY_POST_BUDGET;

  beforeEach(() => {
    prisma = mockPrisma();
    quota = new QuotaService(prisma as unknown as PrismaService);
    delete process.env.X_MONTHLY_POST_BUDGET;
  });

  afterEach(() => {
    if (originalBudget === undefined) {
      delete process.env.X_MONTHLY_POST_BUDGET;
    } else {
      process.env.X_MONTHLY_POST_BUDGET = originalBudget;
    }
  });

  describe('wouldExceedBudget', () => {
    it('returns false for non-X platforms (no budget in MVP)', async () => {
      expect(await quota.wouldExceedBudget('REDDIT')).toBe(false);
      expect(await quota.wouldExceedBudget('LINKEDIN')).toBe(false);
      expect(await quota.wouldExceedBudget('DISCORD')).toBe(false);
    });

    it('returns false for X when usage < budget', async () => {
      // Default budget = 450; set used to 0
      expect(await quota.wouldExceedBudget('TWITTER')).toBe(false);
    });

    it('returns true for X when usage >= budget (450)', async () => {
      const now = new Date('2026-09-15T12:00:00Z');
      const yearMonth = '2026-09';
      prisma._setUsed('TWITTER', yearMonth, 450);
      expect(await quota.wouldExceedBudget('TWITTER', now)).toBe(true);
    });

    it('respects env-overrideable budget', async () => {
      process.env.X_MONTHLY_POST_BUDGET = '2';
      const now = new Date('2026-09-15T12:00:00Z');
      const yearMonth = '2026-09';
      // Used 0 — should NOT exceed
      expect(await quota.wouldExceedBudget('TWITTER', now)).toBe(false);
      // Used 2 — should exceed
      prisma._setUsed('TWITTER', yearMonth, 2);
      expect(await quota.wouldExceedBudget('TWITTER', now)).toBe(true);
    });
  });

  describe('getUsed + increment', () => {
    it('returns 0 for unused platforms', async () => {
      expect(await quota.getUsed('TWITTER', '2026-09')).toBe(0);
    });

    it('increments the counter', async () => {
      await quota.increment('TWITTER');
      expect(await quota.getUsed('TWITTER', '2026-09')).toBe(1);
      await quota.increment('TWITTER');
      expect(await quota.getUsed('TWITTER', '2026-09')).toBe(2);
    });

    it('tracks per-month (separate counters per YYYY-MM)', async () => {
      const sept = new Date('2026-09-15T12:00:00Z');
      const oct = new Date('2026-10-15T12:00:00Z');
      await quota.increment('TWITTER', sept);
      await quota.increment('TWITTER', oct);
      expect(await quota.getUsed('TWITTER', '2026-09')).toBe(1);
      expect(await quota.getUsed('TWITTER', '2026-10')).toBe(1);
    });
  });

  describe('getRemaining', () => {
    it('returns Infinity for non-X platforms', async () => {
      expect(await quota.getRemaining('REDDIT')).toBe(Infinity);
    });

    it('returns budget - used for X', async () => {
      prisma._setUsed('TWITTER', '2026-09', 100);
      expect(await quota.getRemaining('TWITTER', new Date('2026-09-15T12:00:00Z'))).toBe(350);
    });

    it('returns 0 when used >= budget', async () => {
      prisma._setUsed('TWITTER', '2026-09', 500);
      expect(await quota.getRemaining('TWITTER', new Date('2026-09-15T12:00:00Z'))).toBe(0);
    });
  });
});
