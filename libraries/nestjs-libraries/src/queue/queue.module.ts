// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/queue/queue.module.ts
import { DatabaseModule } from '../database/prisma/database.module';
// NetAmplify — BullMQ queue setup.
//
// Per docs/03-ARCHITECTURE.md Flow A (Amplify): "BullMQ (Redis) — Workers —
// Platform Adapters — Update PostTarget status → UI polls /api/posts/:id"
//
// BullMQ is registered as a NestJS module with the publish queue. The
// worker (queue.worker.ts) is started in the same NestJS process via
// OnModuleInit lifecycle hook.
//
// QueueModule imports the modules that provide the repositories the worker
// depends on (DatabaseModule provides PrismaService + AuditLogService,
// PlatformsModule provides AdapterRegistry, TokenVault is provided here).

import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ioRedis } from '../redis/redis.service';
import { PublishWorker } from './queue.worker';
import { PlatformsModule } from '../platforms/platforms.module';
import { TokenVault } from '../services/vault/token-vault';
import { PrismaService } from '../database/prisma/prisma.service';
import { PostTargetRepository } from '../database/prisma/posts/posts.repository';
import { PostCardRepository } from '../database/prisma/postcards/postcards.repository';
import { ConnectionRepository } from '../database/prisma/connections/connections.repository';
import { QuotaService } from '../database/prisma/quota/quota.service';
import { AuditLogService } from '../database/prisma/audit/audit.service';

@Global()
@Module({
  imports: [
    DatabaseModule,
    PlatformsModule,
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: ioRedis as never,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 10_000 },
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 5000 },
        },
      }),
    }),
    BullModule.registerQueue({ name: 'publish' }),
  ],
  providers: [
    PublishWorker,
    TokenVault,
    PostTargetRepository,
    PostCardRepository,
    ConnectionRepository,
    QuotaService,
    AuditLogService,
  ],
  exports: [BullModule, TokenVault],
})
export class QueueModule {}