// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/bluesky/bluesky.adapter.media.test.ts
// Vitest tests for Bluesky media embeds (image + video).
//
// These cover the fix for "Bluesky posts go out text-only even when the
// PostCard has an image/video attached" — the adapter now reads
// formatted.options.imageUrl, uploads the bytes as a blob, and embeds it.
//
// The uploads-dir module is mocked so readLocalUploadFile returns a synthetic
// image/video buffer (no real disk file needed). fetch is mocked per-test to
// return the uploadBlob / createRecord / video-service responses.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the uploads-dir helpers BEFORE importing the adapter so the adapter's
// import of { isVideoMedia, readLocalUploadFile } resolves to the mocks.
// isVideoMedia is a pure extension check — keep the real implementation.
vi.mock('../../services/uploads-dir', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/uploads-dir')>();
  return {
    ...actual,
    // Return a synthetic buffer for any URL — the tests that don't set
    // imageUrl never call this, and the tests that do get controlled bytes.
    readLocalUploadFile: vi.fn(() => null),
  };
});

import { BlueskyAdapter } from './bluesky.adapter';
import { PublishError } from '../adapter.interface';
import { readLocalUploadFile } from '../../services/uploads-dir';

/** A 70-byte synthetic PNG (enough to be a realistic image buffer). */
const FAKE_PNG = Buffer.alloc(70, 0x89);
FAKE_PNG[0] = 0x89; FAKE_PNG[1] = 0x50; FAKE_PNG[2] = 0x4e; FAKE_PNG[3] = 0x47; // PNG signature

/** A synthetic MP4 buffer. */
const FAKE_MP4 = Buffer.alloc(200, 0x00);
FAKE_MP4[4] = 0x66; FAKE_MP4[5] = 0x74; FAKE_MP4[6] = 0x79; FAKE_MP4[7] = 0x70; // "ftyp"

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    arrayBuffer: async () => new ArrayBuffer(0),
  } as Response;
}

describe('BlueskyAdapter — media embeds', () => {
  let adapter: BlueskyAdapter;

  beforeEach(() => {
    adapter = new BlueskyAdapter();
    vi.mocked(readLocalUploadFile).mockReturnValue(null); // default: no local file
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const creds = {
    accessJwt: 'jwt-access',
    refreshJwt: 'jwt-refresh',
    did: 'did:plc:abc',
    handle: 'jane.bsky.social',
  };

  it('uploads an image blob + adds app.bsky.embed.images to the post record', async () => {
    // readLocalUploadFile returns a PNG buffer for /uploads/test.png
    vi.mocked(readLocalUploadFile).mockReturnValue(FAKE_PNG);

    const mockFetch = vi.fn()
      .mockResolvedValueOnce(
        // First call: com.atproto.repo.uploadBlob → returns blob ref
        mockResponse(200, {
          blob: {
            $type: 'blob',
            ref: { $link: 'bafy-fake-cid' },
            mimeType: 'image/png',
            size: FAKE_PNG.length,
          },
        }),
      )
      .mockResolvedValueOnce(
        // Second call: com.atproto.repo.createRecord → returns post uri
        mockResponse(200, {
          uri: 'at://did:plc:abc/app.bsky.feed.post/rkey-with-image',
          cid: 'cid-abc',
        }),
      );
    vi.stubGlobal('fetch', mockFetch);

    const result = await adapter.publish(creds, {
      title: 'Image post',
      body: 'With a photo',
      options: { imageUrl: '/uploads/test.png', altText: 'A test photo' },
    });

    expect(result.id).toBe('rkey-with-image');

    // Verify the uploadBlob call
    const [uploadUrl, uploadInit] = mockFetch.mock.calls[0];
    expect(uploadUrl).toContain('com.atproto.repo.uploadBlob');
    expect(uploadInit.headers.Authorization).toBe('Bearer jwt-access');
    expect(uploadInit.headers['Content-Type']).toBe('image/png');

    // Verify the createRecord body has an embed
    const [, createInit] = mockFetch.mock.calls[1];
    const body = JSON.parse(createInit.body as string);
    expect(body.record.embed).toBeDefined();
    expect(body.record.embed.$type).toBe('app.bsky.embed.images');
    expect(body.record.embed.images).toHaveLength(1);
    expect(body.record.embed.images[0].alt).toBe('A test photo');
    expect(body.record.embed.images[0].image.ref.$link).toBe('bafy-fake-cid');
  });

  it('does NOT add an embed when no imageUrl is set (backward compat — text-only posts)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      mockResponse(200, {
        uri: 'at://did:plc:abc/app.bsky.feed.post/text-only',
        cid: 'cid',
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    await adapter.publish(creds, { title: 'Text only', body: 'No media' });

    // Only one fetch call (createRecord), no uploadBlob
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain('com.atproto.repo.createRecord');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.record.embed).toBeUndefined();
  });

  it('uploads a video to the video service + adds app.bsky.embed.video', async () => {
    vi.mocked(readLocalUploadFile).mockReturnValue(FAKE_MP4);

    const mockFetch = vi.fn()
      .mockResolvedValueOnce(
        // app.bsky.video.uploadVideo → returns jobId (no immediate blob)
        mockResponse(200, { jobId: 'job-123' }),
      )
      .mockResolvedValueOnce(
        // app.bsky.video.getJobStatus → completed with blob
        mockResponse(200, {
          jobStatus: {
            state: 'JOB_STATE_COMPLETED',
            blob: {
              $type: 'blob',
              ref: { $link: 'bafy-video-cid' },
              mimeType: 'video/mp4',
              size: FAKE_MP4.length,
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        // com.atproto.repo.createRecord
        mockResponse(200, {
          uri: 'at://did:plc:abc/app.bsky.feed.post/video-rkey',
          cid: 'cid',
        }),
      );
    vi.stubGlobal('fetch', mockFetch);

    const result = await adapter.publish(creds, {
      title: 'Video post',
      body: 'With a clip',
      options: { imageUrl: '/uploads/clip.mp4' },
    });

    expect(result.id).toBe('video-rkey');

    // First call: video upload service
    expect(mockFetch.mock.calls[0][0]).toContain('app.bsky.video.uploadVideo');
    expect(mockFetch.mock.calls[0][1].headers['Content-Type']).toBe('video/mp4');

    // Second call: job status poll
    expect(mockFetch.mock.calls[1][0]).toContain('app.bsky.video.getJobStatus');
    expect(mockFetch.mock.calls[1][0]).toContain('jobId=job-123');

    // Third call: createRecord with video embed
    const body = JSON.parse(mockFetch.mock.calls[2][1].body as string);
    expect(body.record.embed.$type).toBe('app.bsky.embed.video');
    expect(body.record.embed.video.ref.$link).toBe('bafy-video-cid');
  });

  it('throws VALIDATION when the media has an unsupported extension (.bmp)', async () => {
    // .bmp is not in EXT_TO_MIME → readMediaBytes throws "unsupported extension"
    // before any upload happens. Guards against non-image/non-video files
    // reaching the Bluesky blob endpoints.
    vi.mocked(readLocalUploadFile).mockReturnValue(Buffer.from('not-an-image'));

    vi.stubGlobal('fetch', vi.fn());

    await expect(
      adapter.publish(creds, {
        title: 'Bad',
        body: 'B',
        options: { imageUrl: '/uploads/photo.bmp' },
      }),
    ).rejects.toThrow(/unsupported extension/);
  });

  it('throws NETWORK when uploadBlob fails', async () => {
    vi.mocked(readLocalUploadFile).mockReturnValue(FAKE_PNG);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockResponse(500, 'internal error'),
    ));

    await expect(
      adapter.publish(creds, {
        title: 'Image',
        body: 'B',
        options: { imageUrl: '/uploads/test.png' },
      }),
    ).rejects.toThrow(/Bluesky image upload failed/);
  });
});
