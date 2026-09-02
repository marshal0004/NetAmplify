import { Global, Module } from '@nestjs/common';
import {
  PrismaRepository,
  PrismaService,
  PrismaTransaction,
} from './prisma.service';
import { UsersService } from '@netamplify/nestjs-libraries/database/prisma/users/users.service';
import { UsersRepository } from '@netamplify/nestjs-libraries/database/prisma/users/users.repository';
import { PostsService } from '@netamplify/nestjs-libraries/database/prisma/posts/posts.service';
import { PostsRepository } from '@netamplify/nestjs-libraries/database/prisma/posts/posts.repository';
import { IntegrationManager } from '@netamplify/nestjs-libraries/integrations/integration.manager';
import { MediaService } from '@netamplify/nestjs-libraries/database/prisma/media/media.service';
import { MediaRepository } from '@netamplify/nestjs-libraries/database/prisma/media/media.repository';
import { EmailService } from '@netamplify/nestjs-libraries/services/email.service';

/**
 * NetAmplify Phase 1: stripped DatabaseModule.
 *
 * Kept (5 services + 5 repositories + integration manager + email):
 *   - UsersService / UsersRepository   (auth + profile)
 *   - PostsService / PostsRepository    (will be repurposed as PostCard in Phase 2)
 *   - MediaService / MediaRepository    (PostCard media)
 *   - IntegrationManager                (8-platform registry)
 *   - EmailService                      (Resend password-reset emails)
 *
 * Removed: Organizations, Subscriptions, Notifications, Stripe, Payment,
 *   Agencies, TrackService, ShortLinkService, Webhooks, Signature,
 *   Autopost, Sets, ThirdParty, OAuth-as-a-service, VideoManager,
 *   RefreshIntegrationService (Temporal-dependent), OpenAI services,
 *   FalService, Announcements, Errors, AdminStats.
 *
 * Phase 2 will add: PostCardRepository, PostCardService, ConnectionRepository,
 *   ConnectionService, AuditLogRepository, AuditLogService, QuotaUsageService
 *   per the 9-model NetAmplify schema (04-DATABASE.md).
 */
@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [
    PrismaService,
    PrismaRepository,
    PrismaTransaction,
    UsersService,
    UsersRepository,
    PostsService,
    PostsRepository,
    MediaService,
    MediaRepository,
    IntegrationManager,
    EmailService,
  ],
  get exports() {
    return this.providers;
  },
})
export class DatabaseModule {}
