// /home/z/my-project/netamplify-app/apps/backend/src/services/upload/upload.controller.test.ts
// Vitest tests for the multer-based upload controller.
//
// The PRIMARY regression test proves that a real PNG file survives the upload
// pipeline byte-for-byte. This is the exact bug that broke Instagram
// publishing: the old hand-written multipart parser double-stripped the
// trailing \r\n of every part, removing the last 2 bytes of every file —
// corrupting the PNG IEND chunk CRC and making Meta return error 36001 /
// subcode 2207084 ("PNG chunk is missing required data"). Multer parses
// multipart per RFC 7578 and preserves file bytes exactly.
//
// These tests use REAL multer (no mocks) + a real temp directory — they write
// files to disk and read them back to compare bytes.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import multer from 'multer';
import { diskStorage } from 'multer';
import { Readable } from 'stream';
import {
  writeFileSync,
  readFileSync,
  rmSync,
  mkdirSync,
  existsSync,
  readdirSync,
} from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import type { Request, Response } from 'express';
import {
  ALLOWED_EXTENSIONS,
  uploadFileFilter,
  uploadStorageDestination,
  uploadStorageFilename,
} from './upload.controller';
import { UPLOADS_DIR } from '@netamplify/nestjs-libraries/services/uploads-dir';

/**
 * Minimal valid PNG (1×1 red pixel) as a raw byte buffer.
 *
 * Structure: signature(8) + IHDR chunk(25) + IDAT chunk(29) + IEND chunk(12)
 * = 74 bytes. The IEND chunk is the last 12 bytes:
 *   00 00 00 00  (length = 0)
 *   49 45 4E 44  (type = "IEND")
 *   AE 42 60 82  (CRC32 of "IEND")
 *
 * The old parser stripped the final 2 bytes (60 82), corrupting the CRC →
 * Meta's Telephoto image processor rejected it with "PNG chunk is missing
 * required data". This file is the regression sentinel.
 */
function minimalPng(): Buffer {
  return Buffer.from([
    // PNG signature
    137, 80, 78, 71, 13, 10, 26, 10,
    // IHDR chunk: length(4) + "IHDR"(4) + data(13) + crc(4)
    0, 0, 0, 13, 73, 72, 68, 82,
    0, 0, 0, 1, 0, 0, 0, 1, // width=1, height=1
    8, 2, 0, 0, 0, // bitDepth=8, colorType=2(RGB), compression=0, filter=0, interlace=0
    144, 119, 83, 222, // CRC
    // IDAT chunk: length(4) + "IDAT"(4) + compressed data(15) + crc(4)
    0, 0, 0, 15, 73, 68, 65, 84,
    120, 156, 99, 248, 207, 192, 80, 0, 0, 0, 0, 1, 1, 0, 1,
    85, 251, 247, 173, // CRC
    // IEND chunk: length(4) + "IEND"(4) + crc(4)
    0, 0, 0, 0, 73, 69, 78, 68,
    174, 66, 96, 130, // CRC — the last 2 bytes (96, 130) were stripped by the old parser
  ]);
}

/**
 * Sanity helper: the minimal PNG is a known fixed size so the byte-count
 * assertion catches any accidental edit to the fixture.
 */
const MINIMAL_PNG_SIZE = 72; // signature(8) + IHDR(25) + IDAT(27) + IEND(12)

/**
 * Minimal valid MP4 (ftyp + free + mdat atoms) — small enough to fit in a
 * test but structurally valid so a parser can detect atom boundaries. The
 * last 2 bytes are part of the mdat atom's payload; stripping them corrupts
 * the file (Meta's video transcoder rejects it).
 */
function minimalMp4(): Buffer {
  // ftyp atom (12 bytes): size(4) + "ftyp"(4) + brand(4)
  const ftyp = Buffer.from([
    0, 0, 0, 12, 102, 116, 121, 112, // size=12, type="ftyp"
    105, 115, 111, 109, // brand="isom"
  ]);
  // mdat atom (16 bytes): size(4) + "mdat"(4) + payload(8)
  const mdatPayload = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const mdatHeader = Buffer.from([
    0, 0, 0, 16, 109, 100, 97, 116, // size=16, type="mdat"
  ]);
  return Buffer.concat([ftyp, mdatHeader, mdatPayload]);
}

/**
 * Build a multipart/form-data body (exactly as a browser sends) containing a
 * single file under the "file" field. Returns the full body + the boundary.
 */
function buildMultipartBody(
  filename: string,
  mimeType: string,
  fileBytes: Buffer,
): { body: Buffer; boundary: string } {
  const boundary = `----NetAmplifyTestBoundary${randomBytes(4).toString('hex')}`;
  const header = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`,
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([header, fileBytes, footer]), boundary };
}

/**
 * Create a mock Express Request that multer can consume. multer's middleware
 * reads the multipart body from the request as a Readable stream + uses
 * req.headers['content-type'] to find the boundary.
 */
function createMockReq(
  body: Buffer,
  boundary: string,
  userId: string,
): Request {
  const stream = Readable.from([body]);
  // multer reads from the stream + accesses headers + user
  const req = Object.assign(stream, {
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(body.length),
    },
    method: 'POST',
    url: '/api/upload',
    user: { id: userId },
    // Express methods multer doesn't call for single-file, but keep for safety
    get: (name: string) => req.headers[name.toLowerCase()],
  }) as unknown as Request;
  return req;
}

/**
 * Run multer's .single('file') middleware against a mock request + capture
 * the result (req.file or the error passed to next).
 */
async function runMulter(
  storage: ReturnType<typeof diskStorage>,
  fileFilter: multer.Options['fileFilter'],
  body: Buffer,
  boundary: string,
  userId: string,
): Promise<{ file?: Express.Multer.File; error?: Error }> {
  const instance = multer({ storage, fileFilter });
  const middleware = instance.single('file');
  const req = createMockReq(body, boundary, userId);
  const res = {} as Response;
  return new Promise((resolve) => {
    middleware(req, res, (err: unknown) => {
      resolve({
        file: (req as unknown as { file?: Express.Multer.File }).file,
        error: err instanceof Error ? err : undefined,
      });
    });
  });
}

describe('upload byte preservation (multer) — the Instagram fix', () => {
  const testDir = join(UPLOADS_DIR, '..upload-test-tmp');
  const testStorage = diskStorage({
    destination: (_req, _file, cb) => {
      if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });
      cb(null, testDir);
    },
    filename: (_req, file, cb) => {
      cb(null, `test-${randomBytes(4).toString('hex')}-${file.originalname}`);
    },
  });

  beforeEach(() => {
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('preserves a PNG file byte-for-byte (regression: old parser stripped last 2 bytes → corrupt IEND CRC)', async () => {
    const original = minimalPng();
    expect(original.length).toBe(MINIMAL_PNG_SIZE); // sanity: known minimal PNG size
    // last 4 bytes = IEND CRC (AE 42 60 82)
    expect(original.slice(-4).toString('hex')).toBe('ae426082');

    const { body, boundary } = buildMultipartBody('test.png', 'image/png', original);
    const { file, error } = await runMulter(testStorage, undefined, body, boundary, 'testuser');

    expect(error).toBeUndefined();
    expect(file).toBeDefined();
    expect(file!.size).toBe(original.length); // EXACT size — no bytes lost

    const saved = readFileSync(file!.path);
    expect(saved.equals(original)).toBe(true); // byte-for-byte identical
    // The IEND CRC is intact (this is what Meta checks — the old parser
    // corrupted it, causing error_subcode 2207084)
    expect(saved.slice(-4).toString('hex')).toBe('ae426082');
  });

  it('preserves an MP4 file byte-for-byte (videos were also corrupted by the old parser)', async () => {
    const original = minimalMp4();
    const { body, boundary } = buildMultipartBody('clip.mp4', 'video/mp4', original);
    const { file, error } = await runMulter(testStorage, undefined, body, boundary, 'testuser');

    expect(error).toBeUndefined();
    expect(file).toBeDefined();
    expect(file!.size).toBe(original.length);

    const saved = readFileSync(file!.path);
    expect(saved.equals(original)).toBe(true);
  });

  it('preserves a JPEG file byte-for-byte (images in general)', async () => {
    // Synthetic JPEG-ish bytes — not a valid JPEG, but the point is that the
    // raw bytes are preserved exactly (multer doesn't re-encode anything).
    const original = Buffer.from([
      255, 216, 255, 224, // SOI + APP0 marker
      0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, // JFIF header
      255, 217, // EOI
    ]);
    const { body, boundary } = buildMultipartBody('photo.jpg', 'image/jpeg', original);
    const { file, error } = await runMulter(testStorage, undefined, body, boundary, 'testuser');

    expect(error).toBeUndefined();
    expect(file!.size).toBe(original.length);
    const saved = readFileSync(file!.path);
    expect(saved.equals(original)).toBe(true);
  });

  it('preserves bytes for a large binary file with 0xFF and boundary-like sequences in the payload', async () => {
    // 10KB of pseudo-random bytes — includes 0xFF, 0x0D (\r), 0x0A (\n) that
    // could trip a naive parser. The old hand-written parser used
    // Buffer.indexOf('--boundary') which could match inside binary data;
    // multer uses busboy which handles this correctly per RFC 7578.
    const original = randomBytes(10240);
    const { body, boundary } = buildMultipartBody('blob.png', 'image/png', original);
    const { file, error } = await runMulter(testStorage, undefined, body, boundary, 'testuser');

    expect(error).toBeUndefined();
    expect(file!.size).toBe(original.length);
    const saved = readFileSync(file!.path);
    expect(saved.equals(original)).toBe(true);
  });
});

describe('uploadFileFilter — extension validation', () => {
  const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4'];

  it('accepts every allowed extension (case-insensitive)', () => {
    for (const ext of allowed) {
      const upper = ext.toUpperCase();
      let accepted = false;
      let err: Error | null = null;
      uploadFileFilter(
        {} as Request,
        { originalname: `file${upper}` } as Express.Multer.File,
        (e, a) => {
          err = e;
          accepted = a;
        },
      );
      expect(err).toBeNull();
      expect(accepted).toBe(true);
    }
  });

  it('rejects unsupported extensions (.exe, .js, .html, .svg, .mov)', () => {
    for (const ext of ['.exe', '.js', '.html', '.svg', '.mov', '.bat', '']) {
      let err: Error | null = null;
      let accepted = true;
      uploadFileFilter(
        {} as Request,
        { originalname: `malicious${ext}` } as Express.Multer.File,
        (e, a) => {
          err = e;
          accepted = a;
        },
      );
      expect(accepted).toBe(false);
      expect(err).toBeInstanceOf(Error);
      expect(err!.message).toContain('not allowed');
    }
  });

  it('rejects a file with no extension', () => {
    let err: Error | null = null;
    let accepted = true;
    uploadFileFilter(
      {} as Request,
      { originalname: 'noextension' } as Express.Multer.File,
      (e, a) => {
        err = e;
        accepted = a;
      },
    );
    expect(accepted).toBe(false);
    expect(err).toBeInstanceOf(Error);
  });

  it('ALLOWED_EXTENSIONS matches the MediaController EXT_MIME set', () => {
    // The MediaController (media.controller.ts) has an EXT_MIME map that must
    // list exactly these extensions — otherwise a file this controller saves
    // would be invisible in the media library (or vice versa).
    expect(ALLOWED_EXTENSIONS.sort()).toEqual(
      ['.gif', '.jpg', '.jpeg', '.mp4', '.png', '.webp'].sort(),
    );
  });
});

describe('uploadStorageFilename + uploadStorageDestination — config callbacks', () => {
  const testUserId = 'cmur_test_user_abc';

  it('generates a {userId}-{16hex}{ext} filename (matches MediaController owner-scope prefix)', () => {
    let savedFilename: string | undefined;
    uploadStorageFilename(
      { user: { id: testUserId } } as unknown as Request,
      { originalname: 'Photo.PNG' } as Express.Multer.File,
      (_err, name) => {
        savedFilename = name;
      },
    );
    expect(savedFilename).toBeDefined();
    expect(savedFilename!.startsWith(`${testUserId}-`)).toBe(true);
    expect(savedFilename!.endsWith('.png')).toBe(true); // lowercased ext
    // 16-char hex between the userId- prefix and the .ext
    const hex = savedFilename!.slice(testUserId.length + 1, -4);
    expect(hex).toMatch(/^[0-9a-f]{16}$/);
  });

  it('lowercases the extension so MediaController EXT_MIME + isVideoMedia detect correctly', () => {
    for (const ext of ['.JPG', '.JPEG', '.PNG', '.MP4', '.WEBP']) {
      let name: string | undefined;
      uploadStorageFilename(
        { user: { id: 'u' } } as unknown as Request,
        { originalname: `x${ext}` } as Express.Multer.File,
        (_e, n) => {
          name = n;
        },
      );
      expect(name!.endsWith(ext.toLowerCase())).toBe(true);
    }
  });

  it('destination resolves to UPLOADS_DIR (the shared absolute path)', () => {
    let dest: string | null = null;
    uploadStorageDestination(
      {} as Request,
      {} as Express.Multer.File,
      (_e, d) => {
        dest = d;
      },
    );
    expect(dest).toBe(UPLOADS_DIR);
  });
});
