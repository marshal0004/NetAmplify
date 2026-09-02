import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AuthController } from '@netamplify/backend/api/routes/auth.controller';
import { AuthService } from '@netamplify/backend/services/auth/auth.service';
import { AuthMiddleware } from '@netamplify/backend/services/auth/auth.middleware';
import { PoliciesGuard } from '@netamplify/backend/services/auth/permissions/permissions.guard';
import { PermissionsService } from '@netamplify/backend/services/auth/permissions/permissions.service';
import { IntegrationManager } from '@netamplify/nestjs-libraries/integrations/integration.manager';
import { PublicController } from '@netamplify/backend/api/routes/public.controller';
import { RootController } from '@netamplify/backend/api/routes/root.controller';
import { UploadModule } from '@netamplify/nestjs-libraries/upload/upload.module';
import { NoAuthIntegrationsController } from '@netamplify/backend/api/routes/no.auth.integrations.controller';
import {
  OAuthController,
  OAuthAuthorizedController,
} from '@netamplify/backend/api/routes/oauth.controller';
import { AuthProviderManager } from '@netamplify/backend/services/auth/providers/providers.manager';

/**
 * NetAmplify Phase 1: stripped API module.
 *
 * Kept controllers (5): RootController, AuthController, PublicController,
 *   NoAuthIntegrationsController, OAuthController (+ OAuthAuthorizedController)
 *
 * Kept providers: AuthService, AuthMiddleware, PoliciesGuard,
 *   PermissionsService, IntegrationManager, AuthProviderManager.
 *
 * Phase 2 will add: LocalStrategy provider (email/password + JWT) per
 * NetAmplify remediation decision Q1 = (b). Phase 4 will add PostCard,
 * Publish, Connections, History controllers per 05-API-SPEC.md.
 */
const authenticatedController = [OAuthAuthorizedController];

@Module({
  imports: [UploadModule],
  controllers: process.env.MCP_ONLY
    ? [RootController, OAuthController]
    : [
        RootController,
        AuthController,
        PublicController,
        NoAuthIntegrationsController,
        OAuthController,
        ...authenticatedController,
      ],
  providers: [
    AuthService,
    AuthMiddleware,
    PoliciesGuard,
    PermissionsService,
    IntegrationManager,
    AuthProviderManager,
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
