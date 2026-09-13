import { Global, Module , Inject } from '@nestjs/common';
import {
  PrismaRepository,
  PrismaService,
  PrismaTransaction,
} from './prisma.service';
import { IntegrationManager } from '@netamplify/nestjs-libraries/integrations/integration.manager';
import { EmailService } from '@netamplify/nestjs-libraries/services/email.service';

/**
 * NetAmplify Phase 1 (minimal): DatabaseModule.
 *
 * Kept (3 services): PrismaService (client), PrismaRepository (base CRUD),
 *   PrismaTransaction (transaction wrapper), IntegrationManager (8-platform
 *   registry), EmailService (Resend password-reset emails).
 *
 * Removed in Phase 1: Organizations, Subscriptions, Notifications, Stripe,
 *   Payment, Agencies, TrackService, ShortLinkService, Webhooks, Signature,
 *   Autopost, Sets, ThirdParty, OAuth-as-a-service, VideoManager,
 *   RefreshIntegrationService (Temporal-dependent), OpenAI services,
 *   FalService, Announcements, Errors, AdminStats, Posts, Users, Media
 *   (these had broken imports to deleted modules).
 *
 * Phase 2 will rewrite these per the 9-model NetAmplify schema (04-DATABASE.md):
 *   User, Profile, PostCard, ProjectMedia, Connection, Post, PostTarget,
 *   QuotaUsage, AuditLog
 */
@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [
    PrismaService,
    PrismaRepository,
    PrismaTransaction,
    IntegrationManager,
    EmailService,
  ],
  get exports() {
    return this.providers;
  },
})
export class DatabaseModule {}
