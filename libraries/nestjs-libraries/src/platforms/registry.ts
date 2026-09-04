// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/registry.ts
// NetAmplify — Adapter registry.
//
// Single source of truth for which adapters are registered + how to look
// them up. Per docs/03-ARCHITECTURE.md:
//   "All adapters register in src/lib/platforms/registry.ts:
//    { platform, kind: 'OAUTH'|'SIMPLE', scopes?, configured: () => boolean }"
//
// Phase 3 wires all 8 adapters (Reddit, X, LinkedIn, Discord, Dev.to,
// Telegram, Bluesky, Hashnode). Phase 4 will use the registry to dispatch
// publish calls + connect flows.

import { Injectable, Inject } from '@nestjs/common';
import type { PlatformAdapter } from './adapter.interface';
import { AdapterNotFoundError, PlatformNotConfiguredError } from './adapter.interface';
import type { Platform } from '@prisma/client';

import { RedditAdapter } from './reddit/reddit.adapter';
import { XAdapter } from './x/x.adapter';
import { LinkedInAdapter } from './linkedin/linkedin.adapter';
import { DiscordAdapter } from './discord/discord.adapter';
import { DevtoAdapter } from './devto/devto.adapter';
import { HashnodeAdapter } from './hashnode/hashnode.adapter';
import { TelegramAdapter } from './telegram/telegram.adapter';
import { BlueskyAdapter } from './bluesky/bluesky.adapter';

/**
 * Registry of all 8 NetAmplify platform adapters.
 *
 * The registry is a Map<Platform, PlatformAdapter>. Lookup is O(1).
 * Adapters are singletons (NestJS injectable); the registry holds one
 * instance per platform.
 */
@Injectable()
export class AdapterRegistry {
  private readonly adapters: Map<Platform, PlatformAdapter>;

  constructor(
    @Inject(RedditAdapter) private readonly _reddit: RedditAdapter,
    @Inject(XAdapter) private readonly _x: XAdapter,
    @Inject(LinkedInAdapter) private readonly _linkedin: LinkedInAdapter,
    @Inject(DiscordAdapter) private readonly _discord: DiscordAdapter,
    @Inject(DevtoAdapter) private readonly _devto: DevtoAdapter,
    @Inject(HashnodeAdapter) private readonly _hashnode: HashnodeAdapter,
    @Inject(TelegramAdapter) private readonly _telegram: TelegramAdapter,
    @Inject(BlueskyAdapter) private readonly _bluesky: BlueskyAdapter
  ) {
    this.adapters = new Map<Platform, PlatformAdapter>([
      ['REDDIT', this._reddit],
      ['TWITTER', this._x],
      ['LINKEDIN', this._linkedin],
      ['DISCORD', this._discord],
      ['DEVTO', this._devto],
      ['HASHNODE', this._hashnode],
      ['TELEGRAM', this._telegram],
      ['BLUESKY', this._bluesky],
    ]);
  }

  /**
   * Get the adapter for a platform. Throws AdapterNotFoundError if the
   * platform is not in the registry (shouldn't happen — all 8 are wired).
   */
  get(platform: Platform): PlatformAdapter {
    const adapter = this.adapters.get(platform);
    if (!adapter) {
      throw new AdapterNotFoundError(platform);
    }
    return adapter;
  }

  /**
   * Get all 8 adapters as a list (used by IntegrationManager + the
   * Connect Checklist UI).
   */
  all(): PlatformAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * Get all 8 adapters as a map (used by IntegrationManager).
   */
  map(): Map<Platform, PlatformAdapter> {
    return new Map(this.adapters);
  }

  /**
   * Returns true if the platform has required env vars set.
   * For SIMPLE adapters (Discord, Dev.to, Hashnode, Telegram, Bluesky),
   * always true (user-pasted credentials). For OAUTH adapters (Reddit, X,
   * LinkedIn), checks env vars.
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
