import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '@netamplify/nestjs-libraries/database/prisma/database.module';
import { ApiModule } from '@netamplify/backend/api/api.module';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerBehindProxyGuard } from '@netamplify/nestjs-libraries/throttler/throttler.provider';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ioRedis } from '@netamplify/nestjs-libraries/redis/redis.service';

/**
 * NetAmplify Phase 1 (minimal): AppModule.
 *
 * Imports: DatabaseModule (Prisma), ApiModule (RootController only),
 *   ThrottlerModule (rate limiting).
 *
 * Removed in Phase 1: SentryModule, AgentModule, ThirdPartyModule,
 *   VideoModule, ChatModule, getTemporalModule, InfiniteWorkflowRegisterModule,
 *   PublicApiModule, PoliciesGuard (uses deleted PermissionsService — Phase 4
 *   will add a NetAmplify-specific ownership guard per 07-SECURITY-ACCESS.md).
 *
 * Phase 2 will add: AuthService, Passport LocalStrategy + JwtStrategy module.
 * Phase 4 will add: PostCard, Connections, Publish, History controllers + guards.
 */
@Global()
@Module({
  imports: [
    DatabaseModule,
    ApiModule,
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
    {
      provide: APP_GUARD,
      useClass: ThrottlerBehindProxyGuard,
    },
  ],
  exports: [
    DatabaseModule,
    ApiModule,
    ThrottlerModule,
  ],
})
export class AppModule {}
