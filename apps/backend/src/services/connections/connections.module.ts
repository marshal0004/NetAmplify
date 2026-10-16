// /home/z/my-project/netamplify-app/apps/backend/src/services/connections/connections.module.ts
// NetAmplify — ConnectionsModule.

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConnectionsController } from './connections.controller';
import { OAuthController } from './oauth.controller';
import { ConnectionsService } from '@netamplify/nestjs-libraries/database/prisma/connections/connections.service';
import { ConnectionRepository } from '@netamplify/nestjs-libraries/database/prisma/connections/connections.repository';
import { AuditLogService } from '@netamplify/nestjs-libraries/database/prisma/audit/audit.service';
import { TokenVault } from '@netamplify/nestjs-libraries/services/vault/token-vault';
import { PlatformsModule } from '@netamplify/nestjs-libraries/platforms/platforms.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Module({
  imports: [
    PlatformsModule,
    // JwtModule is needed by OAuthController to verify the JWT passed
    // as ?token=xxx in the OAuth start endpoint. This allows the OAuth
    // flow to identify which user initiated the connection.
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'netamplify-dev-secret',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [ConnectionsController, OAuthController],
  providers: [
    ConnectionsService,
    ConnectionRepository,
    AuditLogService,
    TokenVault,
    JwtAuthGuard,
  ],
  exports: [ConnectionsService, TokenVault],
})
export class ConnectionsModule {}
