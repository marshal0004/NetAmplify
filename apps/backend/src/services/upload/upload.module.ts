// /home/z/my-project/netamplify-app/apps/backend/src/services/upload/upload.module.ts
// NetAmplify — UploadModule.

import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Module({
  controllers: [UploadController],
  providers: [JwtAuthGuard],
})
export class UploadModule {}
