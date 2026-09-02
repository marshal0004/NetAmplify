import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AuthService } from '@netamplify/backend/services/auth/auth.service';
import { StripeService } from '@netamplify/nestjs-libraries/services/stripe.service';
import { PoliciesGuard } from '@netamplify/backend/services/auth/permissions/permissions.guard';
import { PermissionsService } from '@netamplify/backend/services/auth/permissions/permissions.service';
import { IntegrationManager } from '@netamplify/nestjs-libraries/integrations/integration.manager';
import { UploadModule } from '@netamplify/nestjs-libraries/upload/upload.module';
import { OpenaiService } from '@netamplify/nestjs-libraries/openai/openai.service';
import { ExtractContentService } from '@netamplify/nestjs-libraries/openai/extract.content.service';
import { CodesService } from '@netamplify/nestjs-libraries/services/codes.service';
import { PublicIntegrationsController } from '@netamplify/backend/public-api/routes/v1/public.integrations.controller';
import { PublicAuthMiddleware } from '@netamplify/backend/services/auth/public.auth.middleware';
import { SuperAdminGuard } from '@netamplify/backend/services/auth/super.admin.guard';

const authenticatedController = [PublicIntegrationsController];
@Module({
  imports: [UploadModule],
  controllers: process.env.MCP_ONLY ? [] : [...authenticatedController],
  providers: [
    AuthService,
    StripeService,
    OpenaiService,
    ExtractContentService,
    PoliciesGuard,
    PermissionsService,
    CodesService,
    IntegrationManager,
    SuperAdminGuard,
  ],
  get exports() {
    return [...this.imports, ...this.providers];
  },
})
export class PublicApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(PublicAuthMiddleware).forRoutes(...authenticatedController);
  }
}

