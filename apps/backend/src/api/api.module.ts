// /home/z/my-project/netamplify-app/apps/backend/src/api/api.module.ts
// NetAmplify — ApiModule (Phase 3: adds ConnectionsModule + OAuth controller).

import { Module } from '@nestjs/common';
import { RootController } from '@netamplify/backend/api/routes/root.controller';
import { HealthController } from '@netamplify/backend/api/routes/health.controller';
import { IntegrationManager } from '@netamplify/nestjs-libraries/integrations/integration.manager';
import { AuthModule } from '@netamplify/backend/services/auth/auth.module';
import { ConnectionsModule } from '@netamplify/backend/services/connections/connections.module';

/**
 * Phase 3 ApiModule:
 *   - RootController: /  (basic health ping)
 *   - HealthController: /api/health (DB + Redis checks)
 *   - AuthModule: /api/auth/* + /api/account
 *   - ConnectionsModule: /api/connections/* + /api/oauth/* (Phase 3)
 *   - IntegrationManager: 8-platform registry
 */
@Module({
  imports: [AuthModule, ConnectionsModule],
  controllers: [RootController, HealthController],
  providers: [IntegrationManager],
  exports: [IntegrationManager, AuthModule, ConnectionsModule],
})
export class ApiModule {}
