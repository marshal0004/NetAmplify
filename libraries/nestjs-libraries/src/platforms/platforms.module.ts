// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/platforms.module.ts
// NetAmplify — PlatformsModule.
//
// Wires the AdapterRegistry + all 8 platform adapters as NestJS providers.
// Imported by the AuthModule + (future) ConnectionsModule + PublishModule.

import { Module } from '@nestjs/common';
import { AdapterRegistry } from './registry';
import { RedditAdapter } from './reddit/reddit.adapter';
import { XAdapter } from './x/x.adapter';
import { LinkedInAdapter } from './linkedin/linkedin.adapter';
import { DiscordAdapter } from './discord/discord.adapter';
import { DevtoAdapter } from './devto/devto.adapter';
import { HashnodeAdapter } from './hashnode/hashnode.adapter';
import { TelegramAdapter } from './telegram/telegram.adapter';
import { BlueskyAdapter } from './bluesky/bluesky.adapter';

@Module({
  providers: [
    AdapterRegistry,
    RedditAdapter,
    XAdapter,
    LinkedInAdapter,
    DiscordAdapter,
    DevtoAdapter,
    HashnodeAdapter,
    TelegramAdapter,
    BlueskyAdapter,
  ],
  exports: [
    AdapterRegistry,
    RedditAdapter,
    XAdapter,
    LinkedInAdapter,
    DiscordAdapter,
    DevtoAdapter,
    HashnodeAdapter,
    TelegramAdapter,
    BlueskyAdapter,
  ],
})
export class PlatformsModule {}
