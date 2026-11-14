// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/registry.membership.test.ts
// NetAmplify — AdapterRegistry membership test.
//
// Guards the product surface: after Mastodon, WordPress, and the OAuth-based X
// (TWITTER) were removed, the registry must expose exactly the 11 active
// adapters (9 originals + YouTube + Threads) and must NOT register the removed
// platforms. This prevents a regression where a removed platform silently
// re-appears in the Connect Checklist — ConnectionsService.list() iterates
// registry.all(), so anything in the registry becomes a user-visible card.

import { describe, it, expect } from 'vitest';
import type { PlatformAdapter } from './adapter.interface';
import { AdapterNotFoundError } from './adapter.interface';
import type { Platform } from '@prisma/client';
import { AdapterRegistry } from './registry';

/**
 * Minimal stub adapter. The registry only stores the reference and, for
 * configured(), calls adapter.configured() — so a stub with a configured()
 * method is sufficient to exercise membership without standing up the real
 * adapter dependencies (Playwright, platform env vars, HTTP clients, etc.).
 */
function stubAdapter(): PlatformAdapter {
  return { configured: () => true } as unknown as PlatformAdapter;
}

/**
 * Build a real AdapterRegistry with 11 stub adapters, passed in the exact
 * constructor parameter order (LinkedIn, Discord, Devto, Hashnode, Telegram,
 * Bluesky, XCookie, Facebook, Instagram, YouTube, Threads).
 */
function buildRegistry(): AdapterRegistry {
  return new AdapterRegistry(
    stubAdapter(),
    stubAdapter(),
    stubAdapter(),
    stubAdapter(),
    stubAdapter(),
    stubAdapter(),
    stubAdapter(),
    stubAdapter(),
    stubAdapter(),
    stubAdapter(),
    stubAdapter(),
  );
}

const EXPECTED_PRESENT: readonly Platform[] = [
  'LINKEDIN',
  'DISCORD',
  'DEVTO',
  'HASHNODE',
  'TELEGRAM',
  'BLUESKY',
  'TWITTER_COOKIE',
  'FACEBOOK',
  'INSTAGRAM',
  'YOUTUBE',
  'THREADS',
];

const EXPECTED_ABSENT: readonly Platform[] = ['TWITTER', 'MASTODON', 'WORDPRESS'];

describe('AdapterRegistry membership (removed platforms)', () => {
  it('registers exactly the 11 product-surface adapters', () => {
    const registry = buildRegistry();
    expect(registry.all()).toHaveLength(11);
  });

  it('get() returns an adapter for every present platform', () => {
    const registry = buildRegistry();
    for (const p of EXPECTED_PRESENT) {
      expect(() => registry.get(p)).not.toThrow();
    }
  });

  it('get() throws AdapterNotFoundError for the 3 removed platforms', () => {
    const registry = buildRegistry();
    for (const p of EXPECTED_ABSENT) {
      expect(() => registry.get(p)).toThrow(AdapterNotFoundError);
    }
  });

  it('map() contains the present platforms and omits the removed ones', () => {
    const registry = buildRegistry();
    const map = registry.map();
    for (const p of EXPECTED_PRESENT) {
      expect(map.has(p)).toBe(true);
    }
    for (const p of EXPECTED_ABSENT) {
      expect(map.has(p)).toBe(false);
    }
  });

  it('all() does not include any adapter whose platform was removed', () => {
    const registry = buildRegistry();
    const platforms = registry.all().map((a) => (a as { platform: Platform }).platform);
    for (const p of EXPECTED_ABSENT) {
      expect(platforms).not.toContain(p);
    }
  });
});
