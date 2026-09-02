// /home/z/my-project/netamplify-app/apps/backend/src/services/publish/publish.module.ts
// NetAmplify — PublishModule.

import { Module } from '@nestjs/common';
import { PublishController } from './publish.controller';
import { PublishService } from './publish.service';
import { PostRepository, PostTargetRepository } from '@netamplify/nestjs-libraries/database/prisma/posts/posts.repository';
import { PostCardRepository } from '@netamplify/nestjs-libraries/database/prisma/postcards/postcards.repository';
import { ConnectionRepository } from '@netamplify/nestjs-libraries/database/prisma/connections/connections.repository';
import { QuotaService } from '@netamplify/nestjs-libraries/database/prisma/quota/quota.service';
import { AuditLogService } from '@netamplify/nestjs-libraries/database/prisma/audit/audit.service';
import { TokenVault } from '@netamplify/nestjs-libraries/services/vault/token-vault';
import { PlatformsModule } from '@netamplify/nestjs-libraries/platforms/platforms.module';
import { QueueModule } from '@netamplify/nestjs-libraries/queue/queue.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Module({
  imports: [PlatformsModule, QueueModule],
  controllers: [PublishController],
  providers: [
    PublishService,
    PostRepository,
    PostTargetRepository,
    PostCardRepository,
    ConnectionRepository,
    QuotaService,
    AuditLogService,
    TokenVault,
    JwtAuthGuard,
  ],
  exports: [PublishService],
})
export class PublishModule {}
