// /home/z/my-project/netamplify-app/apps/backend/src/services/auth/auth.module.ts
// NetAmplify — AuthModule (wires AuthService + LocalStrategy + JwtStrategy).
//
// Per docs/02-SRS.md FR-001 + C5-A deviation (NestJS Passport + JWT).

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { UsersService } from '@netamplify/nestjs-libraries/database/prisma/users/users.service';
import { UserRepository } from '@netamplify/nestjs-libraries/database/prisma/users/users.repository';
import { AuditLogService } from '@netamplify/nestjs-libraries/database/prisma/audit/audit.service';
import { AuthController } from '@netamplify/backend/api/routes/auth.controller';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: {
        expiresIn: 7 * 24 * 60 * 60, // 7 days
        algorithm: 'HS256',
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    LocalStrategy,
    JwtStrategy,
    JwtAuthGuard,
    UsersService,
    UserRepository,
    AuditLogService,
  ],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
