// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/database/prisma/quota/quota.service.ts
// NetAmplify — QuotaUsage service (X monthly post budget guard per FR-018).
//
// Per docs/02-SRS.md FR-018:
//   "Config: X_MONTHLY_POST_BUDGET (default 450, under free tier).
//    Counter per calendar month. On publish including X when budget
//    exhausted → target set to SKIPPED with message 'X quota for this
//    month is used — other platforms unaffected.'"
//
// Tests (Phase 4.7): with budget=2 test config, 3rd X post → SKIPPED.

import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { currentYearMonth, getXMonthlyPostBudget } from '@netamplify/nestjs-libraries/platforms/config';
import type { Platform } from '@prisma/client';

@Injectable()
export class QuotaService {
  constructor(@Inject(PrismaService) private readonly _prisma: PrismaService) {}

  /**
   * Returns true if publishing one more post to this platform would exceed
   * its monthly budget. For platforms without a budget (non-X), returns false.
   *
   * Per FR-018: only X has a budget in MVP.
   */
  async wouldExceedBudget(platform: Platform, now: Date = new Date()): Promise<boolean> {
    if (platform !== 'TWITTER') return false; // MVP: only X has a budget
    const budget = getXMonthlyPostBudget();
    const yearMonth = currentYearMonth(now);
    const used = await this.getUsed(platform, yearMonth);
    return used >= budget;
  }

  /**
   * Get the current month's used count for a platform.
   */
  async getUsed(platform: Platform, yearMonth: string = currentYearMonth()): Promise<number> {
    const record = await this._prisma.quotaUsage.findUnique({
      where: { platform_yearMonth: { platform, yearMonth } },
    });
    return record?.used ?? 0;
  }

  /**
   * Increment the monthly counter for a platform. Called after a successful
   * (or SKIPPED) publish. Atomic via Prisma upsert + increment.
   */
  async increment(platform: Platform, now: Date = new Date()): Promise<void> {
    const yearMonth = currentYearMonth(now);
    await this._prisma.quotaUsage.upsert({
      where: { platform_yearMonth: { platform, yearMonth } },
      create: { platform, yearMonth, used: 1 },
      update: { used: { increment: 1 } },
    });
  }

  /**
   * Get remaining budget for a platform. For non-budgeted platforms, returns Infinity.
   */
  async getRemaining(platform: Platform, now: Date = new Date()): Promise<number> {
    if (platform !== 'TWITTER') return Infinity;
    const budget = getXMonthlyPostBudget();
    const used = await this.getUsed(platform, currentYearMonth(now));
    return Math.max(0, budget - used);
  }
}
