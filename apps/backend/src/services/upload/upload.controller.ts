// /home/z/my-project/netamplify-app/apps/backend/src/services/upload/upload.controller.ts
// NetAmplify — File upload controller.
//
// POST /api/upload — accepts a single file (image or video) via multipart/form-data,
// saves it to UPLOADS_DIR, and returns a relative URL ("/uploads/<filename>").
//
// Uses multer (the industry-standard multipart parser) via NestJS's
// FileInterceptor. This replaced a hand-written multipart parser that
// double-stripped the trailing \r\n of every part, corrupting the last 2
// bytes of every uploaded file — which broke Instagram publishing with
// Meta error 36001 / subcode 2207084 ("PNG chunk is missing required data")
// because the PNG IEND chunk CRC was truncated. Multer parses multipart
// per RFC 7578 and preserves file bytes exactly.
//
// Supported file types: jpg, jpeg, png, gif, webp, mp4
// Max file size: 50MB (configurable via MAX_UPLOAD_SIZE_MB env var)

import {
  Controller,
  Post,
  HttpCode,
  BadRequestException,
  PayloadTooLargeException,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import type { Request } from 'express';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { extname } from 'path';
import { randomBytes } from 'crypto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UPLOADS_DIR } from '@netamplify/nestjs-libraries/services/uploads-dir';

/**
 * File extensions the upload endpoint accepts. Kept in sync with the
 * MediaController's EXT_MIME map (media.controller.ts) so the media library
 * can list every file this controller saves.
 */
export const ALLOWED_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.mp4',
];

/**
 * Maximum upload size in bytes. Defaults to 50MB; override with the
 * MAX_UPLOAD_SIZE_MB env var. Enforced BOTH by multer's `limits.fileSize`
 * (aborts the upload mid-stream so a huge file can't fill the disk) AND by
 * a post-upload safety-net check in the handler.
 */
export const MAX_FILE_SIZE =
  parseInt(process.env.MAX_UPLOAD_SIZE_MB || '50', 10) * 1024 * 1024;

/**
 * Extract the authenticated user's id from the request. The JwtAuthGuard
 * (class-level) populates req.user before the route handler — and before
 * multer's `filename` callback — runs.
 *
 * Throws a NestJS BadRequestException (→ 400) so the errorMapper surfaces a
 * clear message instead of a 500. (The guard should have already rejected
 * unauthenticated requests, so reaching this without a user id is a race
 * or a misconfigured guard.)
 */
function getUserId(req: Request): string {
  const user = req.user as { id?: string } | undefined;
  if (!user?.id) {
    throw new BadRequestException('Authentication required');
  }
  return user.id;
}

/**
 * Multer destination callback — saves to UPLOADS_DIR (the shared absolute
 * path from uploads-dir.ts), creating it if missing. Using the shared
 * constant guarantees the save path matches the serve path (main.ts
 * express.static on /uploads) + the adapter local-read path
 * (resolveLocalUploadPath), eliminating the CWD-drift 404 that previously
 * broke Instagram + X media publishing.
 *
 * Exported as a named function (not an inline arrow) so the unit test can
 * call it directly — multer's diskStorage() does not expose the callbacks
 * as public properties on the returned engine.
 */
export function uploadStorageDestination(
  _req: Request,
  _file: Express.Multer.File,
  cb: (error: Error | null, destination: string) => void,
): void {
  if (!existsSync(UPLOADS_DIR)) {
    mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  cb(null, UPLOADS_DIR);
}

/**
 * Multer filename callback — generates `{userId}-{randomHex}{ext}`.
 *
 *  - The userId prefix scopes files to their owner (MediaController
 *    lists/deletes by that prefix — a user never sees another user's media).
 *  - The 16-char random hex prevents filename collisions + enumeration.
 *  - The extension is lowercased from the original filename so the
 *    MediaController EXT_MIME lookup + the isVideoMedia() check work
 *    correctly (both match on lowercase extensions).
 *
 * Exported as a named function so the unit test can assert the pattern
 * without spinning up a full multer pipeline.
 */
export function uploadStorageFilename(
  req: Request,
  file: Express.Multer.File,
  cb: (error: Error | null, filename: string) => void,
): void {
  const userId = getUserId(req);
  const ext = extname(file.originalname).toLowerCase();
  const randomHex = randomBytes(8).toString('hex');
  cb(null, `${userId}-${randomHex}${ext}`);
}

/**
 * Multer disk-storage engine — composes the destination + filename
 * callbacks above. Used by FileInterceptor in the upload route handler.
 */
export const uploadStorage = diskStorage({
  destination: uploadStorageDestination,
  filename: uploadStorageFilename,
});

/**
 * Multer file filter — validates the extension BEFORE the file is written to
 * disk (so a .exe upload never touches UPLOADS_DIR). Throws a NestJS
 * BadRequestException (→ 400 via errorMapper) for unsupported types.
 *
 * Exported so the unit test can assert accept/reject behavior directly.
 */
export function uploadFileFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile: boolean) => void,
): void {
  const ext = extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(
      new BadRequestException(
        `File type "${ext}" not allowed. Supported: ${ALLOWED_EXTENSIONS.join(', ')}`,
      ),
      false,
    );
  }
  cb(null, true);
}

/**
 * Multer limits. `fileSize` is the hard cap — multer aborts the upload the
 * moment the stream exceeds it, throwing a MulterError(LIMIT_FILE_SIZE) that
 * the errorMapper maps to HTTP 413 (Payload Too Large).
 */
export const uploadLimits = {
  fileSize: MAX_FILE_SIZE,
};

export interface UploadResponse {
  url: string;
  filename: string;
  size: number;
  mimeType: string;
}

@Controller('api/upload')
@UseGuards(JwtAuthGuard)
export class UploadController {
  /**
   * POST /api/upload
   *
   * Accepts multipart/form-data with a single "file" field. The file is saved
   * to UPLOADS_DIR via multer disk storage (bytes preserved exactly — no
   * hand-parsed multipart), and a RELATIVE URL is returned so media renders
   * on any origin (localhost / ngrok / prod domain).
   *
   * Response: { url, filename, size, mimeType }
   */
  @Post()
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadStorage,
      fileFilter: uploadFileFilter,
      limits: uploadLimits,
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<UploadResponse> {
    // No file in the request (wrong field name, or an empty body).
    if (!file) {
      throw new BadRequestException(
        'No file found in upload. Use field name "file".',
      );
    }

    // Safety net: multer's limits.fileSize should have aborted a too-large
    // upload BEFORE this handler runs (throwing LIMIT_FILE_SIZE → 413 via
    // errorMapper). But if a race or a config change lets one through,
    // delete the saved file + throw 413 so the disk never holds an oversized
    // file and the client gets a clear error.
    if (file.size > MAX_FILE_SIZE) {
      try {
        unlinkSync(file.path);
      } catch {
        // best-effort cleanup — the validation error is the real signal
      }
      throw new PayloadTooLargeException(
        `File too large. Max size: ${MAX_FILE_SIZE / 1024 / 1024}MB`,
      );
    }

    // Relative URL — the browser resolves it against the current page origin
    // (works on localhost:4200, an ngrok tunnel, and a prod domain). Platform
    // adapters that need a publicly-fetchable absolute URL (Instagram /
    // Threads / Facebook — Meta's servers fetch the media) rewrite it to
    // PUBLIC_APP_URL inside the adapter via rewriteLocalhostUrlForMeta().
    // YouTube / X read the local file via resolveLocalUploadPath() and never
    // need a public host.
    return {
      url: `/uploads/${file.filename}`,
      filename: file.filename,
      size: file.size,
      mimeType: file.mimetype,
    };
  }
}
