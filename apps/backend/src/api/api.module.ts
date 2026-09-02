import { Module } from '@nestjs/common';
import { RootController } from '@netamplify/backend/api/routes/root.controller';
import { IntegrationManager } from '@netamplify/nestjs-libraries/integrations/integration.manager';

/**
 * NetAmplify Phase 1 (minimal): stripped API module.
 *
 * Kept (1 controller): RootController (basic /api/health route)
 *
 * Kept providers: IntegrationManager (8-platform registry).
 *
 * Phase 2 will add: AuthService, LocalStrategy, JwtStrategy, AuthMiddleware,
 *   AuthController (signup/login/logout/reset endpoints)
 * Phase 4 will add: PostCardController, ConnectionsController,
 *   PublishController, HistoryController per 05-API-SPEC.md
 */
@Module({
  imports: [],
  controllers: [RootController],
  providers: [
    IntegrationManager,
  ],
  exports: [IntegrationManager],
})
export class ApiModule {}
