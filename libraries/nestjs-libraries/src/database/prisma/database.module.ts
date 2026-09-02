import { Global, Module } from '@nestjs/common';
import { PrismaRepository, PrismaService, PrismaTransaction } from './prisma.service';
import { OrganizationRepository } from '@netamplify/nestjs-libraries/database/prisma/organizations/organization.repository';
import { OrganizationService } from '@netamplify/nestjs-libraries/database/prisma/organizations/organization.service';
import { UsersService } from '@netamplify/nestjs-libraries/database/prisma/users/users.service';
import { UsersRepository } from '@netamplify/nestjs-libraries/database/prisma/users/users.repository';
import { SubscriptionService } from '@netamplify/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { SubscriptionRepository } from '@netamplify/nestjs-libraries/database/prisma/subscriptions/subscription.repository';
import { NotificationService } from '@netamplify/nestjs-libraries/database/prisma/notifications/notification.service';
import { IntegrationService } from '@netamplify/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationRepository } from '@netamplify/nestjs-libraries/database/prisma/integrations/integration.repository';
import { PostsService } from '@netamplify/nestjs-libraries/database/prisma/posts/posts.service';
import { PostsRepository } from '@netamplify/nestjs-libraries/database/prisma/posts/posts.repository';
import { IntegrationManager } from '@netamplify/nestjs-libraries/integrations/integration.manager';
import { MediaService } from '@netamplify/nestjs-libraries/database/prisma/media/media.service';
import { MediaRepository } from '@netamplify/nestjs-libraries/database/prisma/media/media.repository';
import { NotificationsRepository } from '@netamplify/nestjs-libraries/database/prisma/notifications/notifications.repository';
import { EmailService } from '@netamplify/nestjs-libraries/services/email.service';
import { StripeService } from '@netamplify/nestjs-libraries/services/stripe.service';
import { PaymentService } from '@netamplify/nestjs-libraries/services/payment/payment.service';
import { PaymentProviderManager } from '@netamplify/nestjs-libraries/services/payment/payment.provider.manager';
import { RevenueCatProvider } from '@netamplify/nestjs-libraries/services/payment/providers/revenuecat.provider';
import { ExtractContentService } from '@netamplify/nestjs-libraries/openai/extract.content.service';
import { OpenaiService } from '@netamplify/nestjs-libraries/openai/openai.service';
import { AgenciesService } from '@netamplify/nestjs-libraries/database/prisma/agencies/agencies.service';
import { AgenciesRepository } from '@netamplify/nestjs-libraries/database/prisma/agencies/agencies.repository';
import { TrackService } from '@netamplify/nestjs-libraries/track/track.service';
import { ShortLinkService } from '@netamplify/nestjs-libraries/short-linking/short.link.service';
import { WebhooksRepository } from '@netamplify/nestjs-libraries/database/prisma/webhooks/webhooks.repository';
import { WebhooksService } from '@netamplify/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { SignatureRepository } from '@netamplify/nestjs-libraries/database/prisma/signatures/signature.repository';
import { SignatureService } from '@netamplify/nestjs-libraries/database/prisma/signatures/signature.service';
import { AutopostRepository } from '@netamplify/nestjs-libraries/database/prisma/autopost/autopost.repository';
import { AutopostService } from '@netamplify/nestjs-libraries/database/prisma/autopost/autopost.service';
import { SetsService } from '@netamplify/nestjs-libraries/database/prisma/sets/sets.service';
import { SetsRepository } from '@netamplify/nestjs-libraries/database/prisma/sets/sets.repository';
import { ThirdPartyRepository } from '@netamplify/nestjs-libraries/database/prisma/third-party/third-party.repository';
import { ThirdPartyService } from '@netamplify/nestjs-libraries/database/prisma/third-party/third-party.service';
import { VideoManager } from '@netamplify/nestjs-libraries/videos/video.manager';
import { FalService } from '@netamplify/nestjs-libraries/openai/fal.service';
import { RefreshIntegrationService } from '@netamplify/nestjs-libraries/integrations/refresh.integration.service';
import { OAuthRepository } from '@netamplify/nestjs-libraries/database/prisma/oauth/oauth.repository';
import { OAuthService } from '@netamplify/nestjs-libraries/database/prisma/oauth/oauth.service';
import { AnnouncementsRepository } from '@netamplify/nestjs-libraries/database/prisma/announcements/announcements.repository';
import { AnnouncementsService } from '@netamplify/nestjs-libraries/database/prisma/announcements/announcements.service';
import { ErrorsRepository } from '@netamplify/nestjs-libraries/database/prisma/errors/errors.repository';
import { ErrorsService } from '@netamplify/nestjs-libraries/database/prisma/errors/errors.service';
import { AdminStatsRepository } from '@netamplify/nestjs-libraries/database/prisma/admin-stats/admin-stats.repository';
import { AdminStatsService } from '@netamplify/nestjs-libraries/database/prisma/admin-stats/admin-stats.service';

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
    OrganizationService,
    OrganizationRepository,
    SubscriptionService,
    SubscriptionRepository,
    NotificationService,
    NotificationsRepository,
    WebhooksRepository,
    WebhooksService,
    IntegrationService,
    IntegrationRepository,
    PostsService,
    PostsRepository,
    StripeService,
    PaymentService,
    PaymentProviderManager,
    RevenueCatProvider,
    SignatureRepository,
    AutopostRepository,
    AutopostService,
    SignatureService,
    MediaService,
    MediaRepository,
    AgenciesService,
    AgenciesRepository,
    IntegrationManager,
    RefreshIntegrationService,
    ExtractContentService,
    OpenaiService,
    FalService,
    EmailService,
    TrackService,
    ShortLinkService,
    SetsService,
    SetsRepository,
    ThirdPartyRepository,
    ThirdPartyService,
    OAuthRepository,
    OAuthService,
    VideoManager,
    AnnouncementsRepository,
    AnnouncementsService,
    ErrorsRepository,
    ErrorsService,
    AdminStatsRepository,
    AdminStatsService,
  ],
  get exports() {
    return this.providers;
  },
})
export class DatabaseModule {}
