// /home/z/my-project/netamplify-ref/apps/backend/src/services/upload/media.controller.ts
// NetAmplify — MediaController.
//
// GET    /api/media           — lists the current user's uploaded media
//                               (images + videos) from UPLOADS_DIR, newest
//                               first. Powers the PostCard composer's Media
//                               Library grid (postflare-style reusable media).
// DELETE /api/media/:filename — removes a media file (owner-scoped: the
//                               filename must start with `${userId}-`).
//
// Files are user-scoped by the `${userId}-` filename prefix set by the upload
// controller (upload.controller.ts line ~113: `${userId}-${randomHex}${ext}`).
// The MediaController filters by that prefix — a user never sees another
// user's media in their library.

import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { readdirSync, statSync, unlinkSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  UPLOADS_DIR,
  isVideoMedia,
} from '@netamplify/nestjs-libraries/services/uploads-dir';
import {
  errorMapper,
  ServiceError,
} from '@netamplify/nestjs-libraries/services/error.mapper';

export interface MediaItem {
  filename: string;
  url: string;
  mimeType: string;
  size: number;
  isVideo: boolean;
  uploadedAt: string;
}

// Allowed extensions — must match the upload controller's ALLOWED_EXTENSIONS.
const EXT_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
};

function getUserId(req: Request): string {
  const user = req.user as { id?: string } | undefined;
  if (!user?.id) {
    throw new ServiceError('UNAUTHENTICATED', 'Authentication required');
  }
  return user.id;
}

@Controller('api/media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  /**
   * GET /api/media → MediaItem[]
   *
   * Lists the current user's uploaded media (newest first). Returns [] if
   * UPLOADS_DIR doesn't exist yet (no uploads) — never throws.
   */
  @Get()
  @HttpCode(200)
  async list(@Req() req: Request): Promise<MediaItem[]> {
    const userId = getUserId(req);
    const baseUrl =
      process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`;
    try {
      const entries = readdirSync(UPLOADS_DIR);
      const items: MediaItem[] = [];
      for (const filename of entries) {
        // User-scoped: only files prefixed with this user's id.
        if (!filename.startsWith(`${userId}-`)) continue;
        const ext = extname(filename).toLowerCase();
        const mime = EXT_MIME[ext];
        if (!mime) continue; // skip non-media files (e.g., .DS_Store, temp)
        const filePath = join(UPLOADS_DIR, filename);
        const stat = statSync(filePath);
        items.push({
          filename,
          url: `${baseUrl}/uploads/${filename}`,
          mimeType: mime,
          size: stat.size,
          isVideo: isVideoMedia(filename),
          uploadedAt: stat.mtime.toISOString(),
        });
      }
      // Newest first (ISO strings sort lexically for same-format dates).
      items.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
      return items;
    } catch {
      // UPLOADS_DIR missing or unreadable → empty library (no uploads yet).
      return [];
    }
  }

  /**
   * DELETE /api/media/:filename → 204
   *
   * Removes a media file from the user's library. The filename MUST start with
   * `${userId}-` (path-traversal + cross-user guard). Returns 404 if the file
   * doesn't exist.
   */
  @Delete(':filename')
  @HttpCode(204)
  async delete(
    @Param('filename') filename: string,
    @Req() req: Request,
  ): Promise<void> {
    const userId = getUserId(req);
    try {
      // Path-traversal guard — filename must be a bare name.
      if (
        !filename ||
        filename.includes('/') ||
        filename.includes('\\') ||
        filename.includes('..')
      ) {
        throw new ServiceError('VALIDATION_ERROR', 'Invalid filename');
      }
      // Owner-scoped — the file must belong to this user.
      if (!filename.startsWith(`${userId}-`)) {
        // Don't leak whether the file exists — return NOT_FOUND either way.
        throw new ServiceError('NOT_FOUND', 'Media not found');
      }
      const filePath = join(UPLOADS_DIR, filename);
      if (!existsSync(filePath)) {
        throw new ServiceError('NOT_FOUND', 'Media not found');
      }
      unlinkSync(filePath);
    } catch (e) {
      throw errorMapper(e);
    }
  }
}
