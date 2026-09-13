/**
 * GET /api/img/[id]
 * Permanent on-domain image serving from the lossless KV byte store.
 *
 * Every durably-stored image is served from OUR domain as original,
 * bit-for-bit bytes (zero quality loss) with immutable edge caching —
 * so it can never "corrupt" or expire because a third-party host rotted.
 *
 * Fallback chain when bytes are unavailable: mirror URL → OnyxBase URL.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getResourceAny } from '@/lib/resources';
import { loadImageBytes } from '@/lib/image-bytes';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let resource = null;
  try {
    resource = await getResourceAny(id);
  } catch {
    resource = null;
  }
  if (!resource || resource.type !== 'image') {
    return NextResponse.json({ ok: false, error: 'Image not found' }, { status: 404 });
  }
  if (!resource.published) {
    // Drafts are not publicly servable from the stable URL.
    return NextResponse.json({ ok: false, error: 'Image not found' }, { status: 404 });
  }

  // Primary: durable original bytes.
  if (resource.bytesStored && resource.fileId) {
    const data = await loadImageBytes(resource.fileId);
    if (data) {
      // NextResponse with Buffer body — copy into a Uint8Array for safety.
      const body = new Uint8Array(data.bytes);
      return new NextResponse(body, {
        status: 200,
        headers: {
          'Content-Type': data.mimeType,
          'Content-Length': String(data.size),
          // Immutable: bytes for a resource id never change.
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Image-Source': 'kv-bytes',
        },
      });
    }
  }

  // Fallbacks: mirror → storage → legacy download URL.
  const fallback = resource.mirrorUrl || resource.storageUrl || resource.downloadUrl;
  if (fallback) {
    return NextResponse.redirect(fallback, {
      status: 302,
      headers: { 'Cache-Control': 'public, max-age=3600' },
    });
  }
  return NextResponse.json({ ok: false, error: 'Image unavailable' }, { status: 404 });
}
