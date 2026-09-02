// /home/z/my-project/netamplify-app/apps/backend/src/api/api.module.ts
// NetAmplify — ApiModule (Phase 4: adds PostCardsModule + PublishModule).

import { Module } from '@nestjs/common';
import { RootController } from '@netamplify/backend/api/routes/root.controller';
import { HealthController } from '@netamplify/backend/api/routes/health.controller';
import { IntegrationManager } from '@netamplify/nestjs-libraries/integrations/integration.manager';
import { AuthModule } from '@netamplify/backend/services/auth/auth.module';
import { ConnectionsModule } from '@netamplify/backend/services/connections/connections.module';
import { PostCardsModule } from '@netamplify/backend/services/postcards/postcards.module';
import { PublishModule } from '@netamplify/backend/services/publish/publish.module';
import { QueueModule } from '@netamplify/nestjs-libraries/queue/queue.module';

/**
 * Phase 4 ApiModule:
 *   - RootController: /  (basic health ping)
 *   - HealthController: /api/health (DB + Redis checks)
 *   - AuthModule: /api/auth/* + /api/account
 *   - ConnectionsModule: /api/connections/* + /api/oauth/* (Phase 3)
 *   - PostCardsModule: /api/postcards/* (Phase 4 — CRUD + preview)
 *   - PublishModule: /api/postcards/:id/publish + /api/posts/* + retry (Phase 4)
 *   - QueueModule: BullMQ publish queue + worker (Phase 4)
 */
@Module({
  imports: [
    AuthModule,
    ConnectionsModule,
    PostCardsModule,
    PublishModule,
    QueueModule,
  ],
  controllers: [RootController, HealthController],
  providers: [IntegrationManager],
  exports: [
    IntegrationManager,
    AuthModule,
    ConnectionsModule,
    PostCardsModule,
    PublishModule,
  ],
})
export class ApiModule {}
