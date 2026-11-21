// /home/z/my-project/netamplify-ref/apps/backend/src/services/upload/upload.module.ts
// NetAmplify — UploadModule.
//
// Wires three controllers under /api/upload, /api/platforms, /api/media:
//   - UploadController:   POST /api/upload (save a media file)
//   - PlatformsController: GET /api/platforms (per-platform config for the composer)
//   - MediaController:    GET /api/media + DELETE /api/media/:filename (media library)

import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { PlatformsController } from './platforms.controller';
import { MediaController } from './media.controller';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformsModule } from '@netamplify/nestjs-libraries/platforms/platforms.module';

@Module({
  imports: [PlatformsModule],
  controllers: [UploadController, PlatformsController, MediaController],
  providers: [JwtAuthGuard],
})
export class UploadModule {}
