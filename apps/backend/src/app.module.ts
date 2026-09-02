import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '@netamplify/nestjs-libraries/database/prisma/database.module';
import { ApiModule } from '@netamplify/backend/api/api.module';
import { APP_GUARD } from '@nestjs/core';
import { PoliciesGuard } from '@netamplify/backend/services/auth/permissions/permissions.guard';
import { PublicApiModule } from '@netamplify/backend/public-api/public.api.module';
import { ThrottlerBehindProxyGuard } from '@netamplify/nestjs-libraries/throttler/throttler.provider';
import { ThrottlerModule } from '@nestjs/throttler';
import { AgentModule } from '@netamplify/nestjs-libraries/agent/agent.module';
import { ThirdPartyModule } from '@netamplify/nestjs-libraries/3rdparties/thirdparty.module';
import { VideoModule } from '@netamplify/nestjs-libraries/videos/video.module';
import { SentryModule } from '@sentry/nestjs/setup';
import { FILTER } from '@netamplify/nestjs-libraries/sentry/sentry.exception';
import { ChatModule } from '@netamplify/nestjs-libraries/chat/chat.module';
import { getTemporalModule } from '@netamplify/nestjs-libraries/temporal/temporal.module';
import { TemporalRegisterMissingSearchAttributesModule } from '@netamplify/nestjs-libraries/temporal/temporal.register';
import { InfiniteWorkflowRegisterModule } from '@netamplify/nestjs-libraries/temporal/infinite.workflow.register';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ioRedis } from '@netamplify/nestjs-libraries/redis/redis.service';

@Global()
@Module({
  imports: [
    SentryModule.forRoot(),
    DatabaseModule,
    ApiModule,
    PublicApiModule,
    AgentModule,
    ThirdPartyModule,
    VideoModule,
    ChatModule,
    getTemporalModule(false),
    TemporalRegisterMissingSearchAttributesModule,
    InfiniteWorkflowRegisterModule,
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 3600000,
          limit: process.env.API_LIMIT ? Number(process.env.API_LIMIT) : 90,
        },
      ],
      storage: new ThrottlerStorageRedisService(ioRedis),
    }),
  ],
  controllers: [],
  providers: [
    FILTER,
    {
      provide: APP_GUARD,
      useClass: ThrottlerBehindProxyGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PoliciesGuard,
    },
  ],
  exports: [
    DatabaseModule,
    ApiModule,
    PublicApiModule,
    AgentModule,
    ThrottlerModule,
    ChatModule,
  ],
})
export class AppModule {}
