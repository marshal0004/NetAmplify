// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/queue/queue.module.ts
// NetAmplify — BullMQ queue setup.
//
// Per docs/03-ARCHITECTURE.md Flow A (Amplify): "BullMQ (Redis) — Workers —
// Platform Adapters — Update PostTarget status → UI polls /api/posts/:id"
//
// BullMQ is registered as a NestJS module with the publish queue. The
// worker (queue.worker.ts) is started in the same NestJS process via
// OnModuleInit lifecycle hook.

import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ioRedis } from '../redis/redis.service';
import { PublishWorker } from './queue.worker';

@Global()
@Module({
  imports: [
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
  providers: [PublishWorker],
  exports: [BullModule],
})
export class QueueModule {}
