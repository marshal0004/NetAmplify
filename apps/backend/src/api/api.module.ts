// /home/z/my-project/netamplify-app/apps/backend/src/api/api.module.ts
// NetAmplify — ApiModule (Phase 2: adds AuthModule + HealthController).

import { Module } from '@nestjs/common';
import { RootController } from '@netamplify/backend/api/routes/root.controller';
import { HealthController } from '@netamplify/backend/api/routes/health.controller';
import { IntegrationManager } from '@netamplify/nestjs-libraries/integrations/integration.manager';
import { AuthModule } from '@netamplify/backend/services/auth/auth.module';

/**
 * Phase 2 ApiModule:
 *   - RootController: /  (basic health ping)
 *   - HealthController: /api/health (DB + Redis checks)
 *   - AuthModule: /api/auth/* + /api/account (signup, login, logout, me,
 *       reset-request, reset-confirm, delete-account)
 *   - IntegrationManager: 8-platform registry (used by future Phase 4
 *       ConnectionsController)
 *
 * Phase 4 will add: PostCardController, ConnectionsController,
 *   PublishController, HistoryController per docs/05-API-SPEC.md.
 */
@Module({
  imports: [AuthModule],
  controllers: [RootController, HealthController],
  providers: [IntegrationManager],
  exports: [IntegrationManager, AuthModule],
})
export class ApiModule {}
