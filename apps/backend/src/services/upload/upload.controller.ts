// /home/z/my-project/netamplify-app/apps/backend/src/services/upload/upload.controller.ts
// NetAmplify — File upload controller.
//
// POST /api/upload — accepts a single file (image or video) via multipart/form-data,
// saves it to public/uploads/, and returns the publicly accessible URL.
//
// Uses multer as Express middleware (industry standard for file uploads).
// Supported file types: jpg, jpeg, png, gif, webp, mp4
// Max file size: 50MB (configurable via MAX_UPLOAD_SIZE_MB env var)

import {
  Controller,
  Post,
  Req,
  Res,
  HttpCode,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { existsSync, mkdirSync, writeFileSync, renameSync } from 'fs';
import { join, extname } from 'path';
import { randomBytes } from 'crypto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UPLOADS_DIR } from '@netamplify/nestjs-libraries/services/uploads-dir';

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4'];
const MAX_FILE_SIZE = (parseInt(process.env.MAX_UPLOAD_SIZE_MB || '50', 10)) * 1024 * 1024;

function getUserId(req: Request): string {
  const user = req.user as { id?: string } | undefined;
  if (!user?.id) {
    throw new BadRequestException('Authentication required');
  }
  return user.id;
}

@Controller('api/upload')
@UseGuards(JwtAuthGuard)
export class UploadController {
  /**
   * POST /api/upload
   *
   * Accepts multipart/form-data with a single "file" field.
   * The file is saved to public/uploads/ and a public URL is returned.
   *
   * Response: { url, filename, size, mimeType }
   */
  @Post()
  @HttpCode(200)
  async upload(@Req() req: Request, @Res() res: Response): Promise<void> {
    // For multipart/form-data, we need to parse the body manually since
    // NestJS's body parser only handles JSON and URL-encoded.
    // We read the raw body from the request stream.
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      res.status(400).json({ error: 'Content-Type must be multipart/form-data' });
      return;
    }

    // Extract boundary
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
    if (!boundaryMatch) {
      res.status(400).json({ error: 'Missing multipart boundary' });
      return;
    }
    const boundary = boundaryMatch[1] || boundaryMatch[2];

    // Read raw body — NestJS with rawBody:true may have already consumed
    // the stream. Check for (req as any).rawBody first, then fall back
    // to reading the stream.
    let rawBody: Buffer;
    const anyReq = req as any;
    if (anyReq.rawBody && Buffer.isBuffer(anyReq.rawBody)) {
      rawBody = anyReq.rawBody;
    } else if (anyReq.body && Buffer.isBuffer(anyReq.body)) {
      rawBody = anyReq.body;
    } else {
      // Read from stream
      const chunks: Buffer[] = [];
      rawBody = await new Promise<Buffer>((resolve, reject) => {
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', (err) => reject(err));
      });
    }

    if (rawBody.length > MAX_FILE_SIZE) {
      res.status(413).json({
        error: `File too large. Max size: ${MAX_FILE_SIZE / 1024 / 1024}MB`,
      });
      return;
    }

    // Parse multipart to extract the file
    const fileData = this.parseMultipart(rawBody, boundary);
    if (!fileData) {
      res.status(400).json({ error: 'No file found in upload. Use field name "file".' });
      return;
    }

    // Validate extension
    const ext = extname(fileData.filename).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      res.status(400).json({
        error: `File type "${ext}" not allowed. Supported: ${ALLOWED_EXTENSIONS.join(', ')}`,
      });
      return;
    }

    // Generate unique filename
    const userId = getUserId(req);
    const randomHex = randomBytes(8).toString('hex');
    const filename = `${userId}-${randomHex}${ext}`;

    // Save to the shared uploads dir (UPLOADS_DIR — absolute, env-configurable
    // via UPLOAD_DIRECTORY, defaults to <cwd>/public/uploads). Using the shared
    // constant guarantees the save path matches the serve path (main.ts
    // express.static + the platform adapters' local-file reads), eliminating
    // the CWD-drift 404 that broke Instagram + X media publishing.
    const uploadsDir = UPLOADS_DIR;
    if (!existsSync(uploadsDir)) {
      mkdirSync(uploadsDir, { recursive: true });
    }
    const filePath = join(uploadsDir, filename);
    writeFileSync(filePath, fileData.data);

    // Build the public URL as a RELATIVE path ("/uploads/<filename>").
    //
    // Storing a relative URL (instead of an absolute http://localhost:3000/...
    // or PUBLIC_APP_URL/... URL) is what makes media render correctly across
    // every surface + every origin:
    //
    //   - The browser resolves "/uploads/<filename>" against the CURRENT page
    //     origin — so the same stored URL works on localhost:4200 (Vite dev,
    //     proxied to :3000 via vite.config.ts), on an ngrok tunnel, and on a
    //     production domain. An absolute URL pinned to the host that was live
    //     at upload time breaks the moment that host changes (ngrok tunnel
    //     restarted, PUBLIC_APP_URL changed, deploy moved domains) — which was
    //     the root cause of images/videos showing in the composer right after
    //     upload but going broken in the Dashboard list / PostCardView later.
    //   - The Vite dev proxy (vite.config.ts `/uploads` → :3000) + the
    //     backend's express.static on /uploads (main.ts) both serve the path
    //     directly, so no host rewriting is needed.
    //   - Platform adapters that need a publicly-fetchable ABSOLUTE url
    //     (Instagram/Threads/Facebook — Meta's servers fetch the image)
    //     rewrite the relative URL to PUBLIC_APP_URL inside the adapter via
    //     rewriteLocalhostUrlForMeta(). YouTube reads the file from local disk
    //     via resolveLocalUploadPath() (handles relative URLs) and never needs
    //     a public host.
    const fileUrl = `/uploads/${filename}`;

    res.json({
      url: fileUrl,
      filename,
      size: fileData.data.length,
      mimeType: fileData.mimeType,
    });
  }

  /**
   * Parse a multipart/form-data body to extract the first file.
   * Returns the filename, MIME type, and file data as a Buffer.
   */
  private parseMultipart(body: Buffer, boundary: string): {
    filename: string;
    mimeType: string;
    data: Buffer;
  } | null {
    const boundaryBuffer = Buffer.from(`--${boundary}`);

    const parts: Buffer[] = [];
    let start = 0;
    while (true) {
      const idx = body.indexOf(boundaryBuffer, start);
      if (idx === -1) break;
      if (start > 0) {
        parts.push(body.slice(start, idx - 2)); // -2 for \r\n before boundary
      }
      start = idx + boundaryBuffer.length + 2; // +2 for \r\n after boundary
    }

    for (const part of parts) {
      const partStr = part.toString('utf8');
      const headerEnd = partStr.indexOf('\r\n\r\n');
      if (headerEnd === -1) continue;

      const headers = partStr.substring(0, headerEnd);
      const fileData = part.slice(headerEnd + 4, part.length - 2); // -2 for trailing \r\n

      const filenameMatch = headers.match(/filename="([^"]+)"/);
      if (!filenameMatch) continue;

      const filename = filenameMatch[1];
      const mimeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
      const mimeType = mimeMatch ? mimeMatch[1].trim() : 'application/octet-stream';

      return { filename, mimeType, data: fileData };
    }

    return null;
  }
}
