import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '@netamplify/nestjs-libraries/database/prisma/database.module';
import { ApiModule } from '@netamplify/backend/api/api.module';
import { APP_GUARD } from '@nestjs/core';
import { PoliciesGuard } from '@netamplify/backend/services/auth/permissions/permissions.guard';
import { PublicApiModule } from '@netamplify/backend/public-api/public.api.module';
import { ThrottlerBehindProxyGuard } from '@netamplify/nestjs-libraries/throttler/throttler.provider';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ioRedis } from '@netamplify/nestjs-libraries/redis/redis.service';

@Global()
@Module({
  imports: [
    DatabaseModule,
    ApiModule,
    PublicApiModule,
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
    {
      provide: APP_GUARD,
      useClass: PoliciesGuard,
    },
  ],
  exports: [
    DatabaseModule,
    ApiModule,
    PublicApiModule,
    ThrottlerModule,
  ],
})
export class AppModule {}
