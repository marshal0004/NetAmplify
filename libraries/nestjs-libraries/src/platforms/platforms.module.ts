// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/platforms.module.ts
// NetAmplify — PlatformsModule.
//
// Wires the AdapterRegistry + the platform adapters exposed to users as
// NestJS providers. Imported by the AuthModule + ConnectionsModule +
// PublishModule.
//
// Mastodon, WordPress, and the OAuth-based X (XAdapter) are intentionally
// NOT provided: they were removed from the product surface. X (Twitter)
// remains available via the cookie / browser-capture adapter (XCookieAdapter).

import { Module } from '@nestjs/common';
import { AdapterRegistry } from './registry';
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

@Module({
  providers: [
    AdapterRegistry,
    LinkedInAdapter,
    DiscordAdapter,
    DevtoAdapter,
    HashnodeAdapter,
    TelegramAdapter,
    BlueskyAdapter,
    XCookieAdapter,
    FacebookAdapter,
    InstagramAdapter,
    YouTubeAdapter,
    ThreadsAdapter,
  ],
  exports: [
    AdapterRegistry,
    LinkedInAdapter,
    DiscordAdapter,
    DevtoAdapter,
    HashnodeAdapter,
    TelegramAdapter,
    BlueskyAdapter,
    XCookieAdapter,
    FacebookAdapter,
    InstagramAdapter,
    YouTubeAdapter,
    ThreadsAdapter,
  ],
})
export class PlatformsModule {}
