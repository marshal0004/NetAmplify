import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AuthController } from '@netamplify/backend/api/routes/auth.controller';
import { AuthService } from '@netamplify/backend/services/auth/auth.service';
import { UsersController } from '@netamplify/backend/api/routes/users.controller';
import { AuthMiddleware } from '@netamplify/backend/services/auth/auth.middleware';
import { StripeService } from '@netamplify/nestjs-libraries/services/stripe.service';
import { PaymentController } from '@netamplify/backend/api/routes/payment.controller';
import { PaymentService } from '@netamplify/nestjs-libraries/services/payment/payment.service';
import { PaymentProviderManager } from '@netamplify/nestjs-libraries/services/payment/payment.provider.manager';
import { RevenueCatProvider } from '@netamplify/nestjs-libraries/services/payment/providers/revenuecat.provider';
import { AnalyticsController } from '@netamplify/backend/api/routes/analytics.controller';
import { PoliciesGuard } from '@netamplify/backend/services/auth/permissions/permissions.guard';
import { PermissionsService } from '@netamplify/backend/services/auth/permissions/permissions.service';
import { IntegrationsController } from '@netamplify/backend/api/routes/integrations.controller';
import { IntegrationManager } from '@netamplify/nestjs-libraries/integrations/integration.manager';
import { SettingsController } from '@netamplify/backend/api/routes/settings.controller';
import { PostsController } from '@netamplify/backend/api/routes/posts.controller';
import { MediaController } from '@netamplify/backend/api/routes/media.controller';
import { UploadModule } from '@netamplify/nestjs-libraries/upload/upload.module';
import { BillingController } from '@netamplify/backend/api/routes/billing.controller';
import { NotificationsController } from '@netamplify/backend/api/routes/notifications.controller';
import { OpenaiService } from '@netamplify/nestjs-libraries/openai/openai.service';
import { ExtractContentService } from '@netamplify/nestjs-libraries/openai/extract.content.service';
import { CodesService } from '@netamplify/nestjs-libraries/services/codes.service';
import { CopilotController } from '@netamplify/backend/api/routes/copilot.controller';
import { PublicController } from '@netamplify/backend/api/routes/public.controller';
import { RootController } from '@netamplify/backend/api/routes/root.controller';
import { TrackService } from '@netamplify/nestjs-libraries/track/track.service';
import { ShortLinkService } from '@netamplify/nestjs-libraries/short-linking/short.link.service';
import { WebhookController } from '@netamplify/backend/api/routes/webhooks.controller';
import { SignatureController } from '@netamplify/backend/api/routes/signature.controller';
import { AutopostController } from '@netamplify/backend/api/routes/autopost.controller';
import { SetsController } from '@netamplify/backend/api/routes/sets.controller';
import { ThirdPartyController } from '@netamplify/backend/api/routes/third-party.controller';
import { MonitorController } from '@netamplify/backend/api/routes/monitor.controller';
import { NoAuthIntegrationsController } from '@netamplify/backend/api/routes/no.auth.integrations.controller';
import { EnterpriseController } from '@netamplify/backend/api/routes/enterprise.controller';
import { OAuthAppController } from '@netamplify/backend/api/routes/oauth-app.controller';
import { ApprovedAppsController } from '@netamplify/backend/api/routes/approved-apps.controller';
import {
  OAuthController,
  OAuthAuthorizedController,
} from '@netamplify/backend/api/routes/oauth.controller';
import { AnnouncementsController } from '@netamplify/backend/api/routes/announcements.controller';
import { AdminController } from '@netamplify/backend/api/routes/admin.controller';
import { AuthProviderManager } from '@netamplify/backend/services/auth/providers/providers.manager';
import { GithubProvider } from '@netamplify/backend/services/auth/providers/github.provider';
import { GoogleProvider } from '@netamplify/backend/services/auth/providers/google.provider';
import { AppleProvider } from '@netamplify/backend/services/auth/providers/apple.provider';
import { FarcasterProvider } from '@netamplify/backend/services/auth/providers/farcaster.provider';
import { WalletProvider } from '@netamplify/backend/services/auth/providers/wallet.provider';
import { OauthProvider } from '@netamplify/backend/services/auth/providers/oauth.provider';
import { StripeController } from '@netamplify/backend/api/routes/stripe.controller';

const authenticatedController = [
  UsersController,
  AnalyticsController,
  IntegrationsController,
  SettingsController,
  PostsController,
  MediaController,
  BillingController,
  NotificationsController,
  CopilotController,
  WebhookController,
  SignatureController,
  AutopostController,
  SetsController,
  ThirdPartyController,
  OAuthAppController,
  ApprovedAppsController,
  OAuthAuthorizedController,
  AnnouncementsController,
  AdminController,
];
@Module({
  imports: [UploadModule],
  controllers: process.env.MCP_ONLY
    ? [RootController, OAuthController]
    : [
        RootController,
        PaymentController,
        StripeController,
        AuthController,
        PublicController,
        MonitorController,
        EnterpriseController,
        NoAuthIntegrationsController,
        OAuthController,
        ...authenticatedController,
      ],
  providers: [
    AuthService,
    StripeService,
    PaymentService,
    PaymentProviderManager,
    RevenueCatProvider,
    OpenaiService,
    ExtractContentService,
    AuthMiddleware,
    PoliciesGuard,
    PermissionsService,
    CodesService,
    IntegrationManager,
    TrackService,
    ShortLinkService,
    AuthProviderManager,
    GithubProvider,
    GoogleProvider,
    AppleProvider,
    FarcasterProvider,
    WalletProvider,
    OauthProvider,
  ],
  get exports() {
    return [...this.imports, ...this.providers];
  },
})
export class ApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).forRoutes(...authenticatedController);
  }
}
