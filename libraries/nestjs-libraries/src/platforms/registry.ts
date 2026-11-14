// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/registry.ts
// NetAmplify — Adapter registry.
//
// Single source of truth for which adapters are registered + how to look
// them up. Per docs/03-ARCHITECTURE.md:
//   "All adapters register in src/lib/platforms/registry.ts:
//    { platform, kind: 'OAUTH'|'SIMPLE', scopes?, configured: () => boolean }"
//
// Mastodon, WordPress, and the OAuth-based X adapter (TWITTER) were removed
// from the product surface. Their Prisma enum values are retained so any
// historical rows remain valid, but NO adapter is registered for them — so
// they never appear in the Connect Checklist (list() iterates all()) and
// cannot be connected or published to. X (Twitter) is exposed exclusively
// via the cookie / browser-capture adapter (TWITTER_COOKIE).

import { Injectable, Inject } from '@nestjs/common';
import type { PlatformAdapter } from './adapter.interface';
import { AdapterNotFoundError, PlatformNotConfiguredError } from './adapter.interface';
import type { Platform } from '@prisma/client';

import { LinkedInAdapter } from './linkedin/linkedin.adapter';
import { DiscordAdapter } from './discord/discord.adapter';
import { DevtoAdapter } from './devto/devto.adapter';
import { HashnodeAdapter } from './hashnode/hashnode.adapter';
import { TelegramAdapter } from './telegram/telegram.adapter';
import { BlueskyAdapter } from './bluesky/bluesky.adapter';
import { XCookieAdapter } from './x/x-cookie.adapter';
import { FacebookAdapter } from './facebook/facebook.adapter';
import { InstagramAdapter } from './instagram/instagram.adapter';
import { YouTubeAdapter } from './youtube/youtube.adapter';
import { ThreadsAdapter } from './threads/threads.adapter';

/**
 * Registry of the 11 NetAmplify platform adapters exposed to users.
 *
 * The registry is a Map<Platform, PlatformAdapter>. Lookup is O(1).
 * Adapters are singletons (NestJS injectable); the registry holds one
 * instance per platform.
 */
@Injectable()
export class AdapterRegistry {
  private readonly adapters: Map<Platform, PlatformAdapter>;

  constructor(
    @Inject(LinkedInAdapter) private readonly _linkedin: LinkedInAdapter,
    @Inject(DiscordAdapter) private readonly _discord: DiscordAdapter,
    @Inject(DevtoAdapter) private readonly _devto: DevtoAdapter,
    @Inject(HashnodeAdapter) private readonly _hashnode: HashnodeAdapter,
    @Inject(TelegramAdapter) private readonly _telegram: TelegramAdapter,
    @Inject(BlueskyAdapter) private readonly _bluesky: BlueskyAdapter,
    @Inject(XCookieAdapter) private readonly _xCookie: XCookieAdapter,
    @Inject(FacebookAdapter) private readonly _facebook: FacebookAdapter,
    @Inject(InstagramAdapter) private readonly _instagram: InstagramAdapter,
    @Inject(YouTubeAdapter) private readonly _youtube: YouTubeAdapter,
    @Inject(ThreadsAdapter) private readonly _threads: ThreadsAdapter,
  ) {
    this.adapters = new Map<Platform, PlatformAdapter>([
      ['LINKEDIN', this._linkedin],
      ['DISCORD', this._discord],
      ['DEVTO', this._devto],
      ['HASHNODE', this._hashnode],
      ['TELEGRAM', this._telegram],
      ['BLUESKY', this._bluesky],
      ['TWITTER_COOKIE', this._xCookie],
      ['FACEBOOK', this._facebook],
      ['INSTAGRAM', this._instagram],
      ['YOUTUBE', this._youtube],
      ['THREADS', this._threads],
    ]);
  }

  /**
   * Get the adapter for a platform. Throws AdapterNotFoundError if the
   * platform is not in the registry (e.g. a removed platform like MASTODON
   * or the OAuth TWITTER adapter).
   */
  get(platform: Platform): PlatformAdapter {
    const adapter = this.adapters.get(platform);
    if (!adapter) {
      throw new AdapterNotFoundError(platform);
    }
    return adapter;
  }

  /**
   * Get all registered adapters as a list. Drives the Connect Checklist via
   * ConnectionsService.list() (one card per registered adapter).
   */
  all(): PlatformAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * Get all registered adapters as a map (used by IntegrationManager).
   */
  map(): Map<Platform, PlatformAdapter> {
    return new Map(this.adapters);
  }

  /**
   * Returns true if the platform has required env vars set.
   * For SIMPLE adapters (Discord, Dev.to, Hashnode, Telegram, Bluesky),
   * always true (user-pasted credentials). For OAUTH adapters (LinkedIn,
   * Facebook, Instagram) and the cookie X adapter, checks env / state.
   *
   * Used by Connect Checklist UI to render "Setup pending" cards without
   * erroring per docs/01-PRD.md §4.
   */
  configured(platform: Platform): boolean {
    return this.get(platform).configured();
  }

  /**
   * Convenience: get the adapter OR throw PlatformNotConfiguredError if
   * the platform's env vars are missing (for OAuth). Used by the
   * ConnectionsController before invoking getAuthUrl().
   */
  requireConfigured(platform: Platform): PlatformAdapter {
    const adapter = this.get(platform);
    if (!adapter.configured()) {
      throw new PlatformNotConfiguredError(platform);
    }
    return adapter;
  }
}
