// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/config.test.ts
// Vitest unit tests for platform config — pure functions, no mocks.

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
  PLATFORM_CONFIG,
  RETRY_BACKOFF_MS,
  MAX_RETRY_ATTEMPTS,
  X_MONTHLY_POST_BUDGET_DEFAULT,
  getXMonthlyPostBudget,
  currentYearMonth,
} from './config';

describe('PLATFORM_CONFIG', () => {
  it('has every Prisma Platform enum value configured (exhaustive Record)', () => {
    // PLATFORM_CONFIG is Record<Platform, PlatformConfig>, so it MUST carry an
    // entry for every enum value — including removed-from-product platforms
    // (TWITTER/MASTODON/WORDPRESS), whose entries remain as a type-required
    // data contract even though no adapter is registered for them.
    const platforms = Object.keys(PLATFORM_CONFIG);
    expect(platforms).toContain('DISCORD');
    expect(platforms).toContain('DEVTO');
    expect(platforms).toContain('TELEGRAM');
    expect(platforms).toContain('BLUESKY');
        expect(platforms).toContain('TWITTER');
    expect(platforms).toContain('LINKEDIN');
    expect(platforms).toContain('MASTODON');
    expect(platforms).toContain('WORDPRESS');
    expect(platforms).toContain('TWITTER_COOKIE');
    expect(platforms).toContain('FACEBOOK');
    expect(platforms).toContain('INSTAGRAM');
    expect(platforms).toContain('YOUTUBE');
    expect(platforms).toContain('THREADS');
    expect(platforms.length).toBe(14);
  });

  it('X (Twitter) has 280-char limit', () => {
    expect(PLATFORM_CONFIG.TWITTER.charLimit).toBe(280);
  });

  it('LinkedIn has 3000-char limit (plain text)', () => {
    expect(PLATFORM_CONFIG.LINKEDIN.charLimit).toBe(3000);
  });

  it('Bluesky has 300-char limit (grapheme)', () => {
    expect(PLATFORM_CONFIG.BLUESKY.charLimit).toBe(300);
  });

  it('Discord supports markdown + 1 image', () => {
    expect(PLATFORM_CONFIG.DISCORD.markdownSupported).toBe(true);
    expect(PLATFORM_CONFIG.DISCORD.imageSupported).toBe(true);
    expect(PLATFORM_CONFIG.DISCORD.maxImages).toBe(1);
  });

  it('each platform has a non-null name + charLimit', () => {
    for (const cfg of Object.values(PLATFORM_CONFIG)) {
      expect(cfg.name).toBeTruthy();
      expect(cfg.charLimit).toBeGreaterThan(0);
    }
  });
});

describe('retry policy', () => {
  it('has 3 backoff intervals', () => {
    expect(RETRY_BACKOFF_MS.length).toBe(3);
  });

  it('backoff is exponentially increasing', () => {
    expect(RETRY_BACKOFF_MS[0]).toBeLessThan(RETRY_BACKOFF_MS[1]);
    expect(RETRY_BACKOFF_MS[1]).toBeLessThan(RETRY_BACKOFF_MS[2]);
  });

  it('MAX_RETRY_ATTEMPTS is 3 per docs/02-SRS.md NFR-003', () => {
    expect(MAX_RETRY_ATTEMPTS).toBe(3);
  });
});

describe('X monthly post budget', () => {
  const originalEnv = process.env.X_MONTHLY_POST_BUDGET;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.X_MONTHLY_POST_BUDGET;
    } else {
      process.env.X_MONTHLY_POST_BUDGET = originalEnv;
    }
  });

  it('defaults to 450 under X free tier cap', () => {
    delete process.env.X_MONTHLY_POST_BUDGET;
    expect(getXMonthlyPostBudget()).toBe(X_MONTHLY_POST_BUDGET_DEFAULT);
    expect(X_MONTHLY_POST_BUDGET_DEFAULT).toBeLessThan(1500);
  });

  it('respects env override', () => {
    process.env.X_MONTHLY_POST_BUDGET = '100';
    expect(getXMonthlyPostBudget()).toBe(100);
  });

  it('falls back to default on invalid env value', () => {
    process.env.X_MONTHLY_POST_BUDGET = 'not-a-number';
    expect(getXMonthlyPostBudget()).toBe(X_MONTHLY_POST_BUDGET_DEFAULT);
  });

  it('falls back to default on negative env value', () => {
    process.env.X_MONTHLY_POST_BUDGET = '-5';
    expect(getXMonthlyPostBudget()).toBe(X_MONTHLY_POST_BUDGET_DEFAULT);
  });
});

describe('currentYearMonth', () => {
  it('returns YYYY-MM format', () => {
    expect(currentYearMonth(new Date('2026-09-15T12:00:00Z'))).toBe('2026-09');
  });

  it('zero-pads single-digit months', () => {
    expect(currentYearMonth(new Date('2026-01-15T12:00:00Z'))).toBe('2026-01');
  });

  it('uses UTC', () => {
    expect(currentYearMonth(new Date('2026-12-31T23:59:00Z'))).toBe('2026-12');
  });
});
