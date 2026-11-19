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

/**
 * Build a fake Bluesky JWT with the given `aud` (PDS DID) claim in the payload.
 * The adapter decodes the payload to extract the PDS DID for getServiceAuth.
 */
function fakeJwt(aud: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    aud,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  return `${header}.${payload}.signature`;
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
    accessJwt: fakeJwt('did:web:bsky.social'),
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
    expect(uploadInit.headers.Authorization).toBe(`Bearer ${creds.accessJwt}`);
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
        // Call 1: com.atproto.server.getServiceAuth → returns service JWT
        mockResponse(200, { token: 'service-jwt-abc' }),
      )
      .mockResolvedValueOnce(
        // Call 2: app.bsky.video.uploadVideo → returns jobId (no immediate blob)
        mockResponse(200, { jobId: 'job-123' }),
      )
      .mockResolvedValueOnce(
        // Call 3: app.bsky.video.getJobStatus → completed with blob
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
        // Call 4: com.atproto.repo.createRecord
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

    // Call 1: getServiceAuth — mints the service JWT on the USER'S PDS.
    // The `aud` is the user's PDS DID (decoded from the accessJwt), NOT the
    // video service's DID. The video service uses `aud` to identify which
    // PDS minted the token. For this test, the accessJwt has aud=did:web:bsky.social.
    expect(mockFetch.mock.calls[0][0]).toContain('com.atproto.server.getServiceAuth');
    expect(mockFetch.mock.calls[0][0]).toContain('aud=did%3Aweb%3Absky.social');
    // getServiceAuth is called on the PDS URL (https://bsky.social/xrpc/...)
    expect(mockFetch.mock.calls[0][0]).toContain('bsky.social/xrpc');

    // Call 2: video upload — uses the SERVICE JWT (not the accessJwt)
    expect(mockFetch.mock.calls[1][0]).toContain('app.bsky.video.uploadVideo');
    expect(mockFetch.mock.calls[1][0]).toContain('did=did%3Aplc%3Aabc');
    expect(mockFetch.mock.calls[1][0]).toContain('name=clip.mp4');
    expect(mockFetch.mock.calls[1][1].headers.Authorization).toBe('Bearer service-jwt-abc');
    expect(mockFetch.mock.calls[1][1].headers['Content-Type']).toBe('video/mp4');

    // Call 3: job status poll
    expect(mockFetch.mock.calls[2][0]).toContain('app.bsky.video.getJobStatus');
    expect(mockFetch.mock.calls[2][0]).toContain('jobId=job-123');

    // Call 4: createRecord with video embed
    const body = JSON.parse(mockFetch.mock.calls[3][1].body as string);
    expect(body.record.embed.$type).toBe('app.bsky.embed.video');
    expect(body.record.embed.video.ref.$link).toBe('bafy-video-cid');
  });

  it('resolves the user\'s PDS from the accessJwt — calls getServiceAuth on the CORRECT PDS (not always bsky.social)', async () => {
    // Reproduces the exact bug from the user's logs: their PDS is
    // did:web:fibercap.us-west.host.bsky.network (NOT bsky.social). The
    // accessJwt's `aud` claim carries the PDS DID. getServiceJwt decodes it,
    // resolves the PDS URL, and calls getServiceAuth on the USER'S PDS.
    vi.mocked(readLocalUploadFile).mockReturnValue(FAKE_MP4);

    const fibercapCreds = {
      ...creds,
      accessJwt: fakeJwt('did:web:fibercap.us-west.host.bsky.network'),
      did: 'did:plc:user123',
    };

    const mockFetch = vi.fn()
      .mockResolvedValueOnce(
        // getServiceAuth on the user's PDS (fibercap) → returns service JWT
        mockResponse(200, { token: 'fibercap-service-jwt' }),
      )
      .mockResolvedValueOnce(
        // uploadVideo → returns jobId
        mockResponse(200, { jobId: 'job-fiber-1' }),
      )
      .mockResolvedValueOnce(
        // getJobStatus → completed
        mockResponse(200, {
          jobStatus: {
            state: 'JOB_STATE_COMPLETED',
            blob: { $type: 'blob', ref: { $link: 'bafy-fiber-video' }, mimeType: 'video/mp4', size: 200 },
          },
        }),
      )
      .mockResolvedValueOnce(
        // createRecord
        mockResponse(200, { uri: 'at://did:plc:user123/app.bsky.feed.post/fiber-rkey', cid: 'cid' }),
      );
    vi.stubGlobal('fetch', mockFetch);

    const result = await adapter.publish(fibercapCreds, {
      title: 'Video on fibercap PDS',
      body: 'B',
      options: { imageUrl: '/uploads/clip.mp4' },
    });

    expect(result.id).toBe('fiber-rkey');

    // Call 1: getServiceAuth is on the FIBERCAP PDS (not bsky.social)
    expect(mockFetch.mock.calls[0][0]).toContain('fibercap.us-west.host.bsky.network/xrpc/com.atproto.server.getServiceAuth');
    // aud = the user's PDS DID (fibercap), NOT did:web:video.bsky.app
    expect(mockFetch.mock.calls[0][0]).toContain('aud=did%3Aweb%3Afibercap.us-west.host.bsky.network');
    // The upload uses the service JWT from the fibercap PDS
    expect(mockFetch.mock.calls[1][1].headers.Authorization).toBe('Bearer fibercap-service-jwt');
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

  it('classifies video-upload 401 as NETWORK (NOT AUTH) — does NOT revoke the connection', async () => {
    // The video service may reject the service JWT transiently. The accessJwt
    // is VALID (getServiceAuth succeeded). Classifying as AUTH would mark the
    // Bluesky connection REVOKED — preventing text/image posts too. NETWORK
    // means retryable + the connection stays ACTIVE.
    vi.mocked(readLocalUploadFile).mockReturnValue(FAKE_MP4);

    const mockFetch = vi.fn()
      .mockResolvedValueOnce(
        // getServiceAuth succeeds → returns a service JWT
        mockResponse(200, { token: 'service-jwt-abc' }),
      )
      .mockResolvedValueOnce(
        // Video upload returns 401 → must be NETWORK, not AUTH
        mockResponse(401, 'Unauthorized'),
      );
    vi.stubGlobal('fetch', mockFetch);

    try {
      await adapter.publish(creds, {
        title: 'Video',
        body: 'B',
        options: { imageUrl: '/uploads/clip.mp4' },
      });
      expect.fail('publish should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(PublishError);
      expect((e as PublishError).errorClass).toBe('NETWORK');
      expect((e as Error).message).toContain('connection is NOT revoked');
    }
  });
});
