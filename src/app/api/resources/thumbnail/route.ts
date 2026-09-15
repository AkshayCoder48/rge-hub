/**
 * POST /api/resources/thumbnail — upload a replacement thumbnail image.
 *
 * Session-authenticated (any signed-in user; the resource PATCH that
 * consumes the returned URL enforces owner/staff rights). Mirrors the
 * avatar pipeline: imghosting edge first (sub-second, flood-proof),
 * backend file storage as fallback. Does NOT touch any resource record —
 * the caller PATCHes { thumbnailUrl } afterwards.
 *
 * Body: FormData with "file" field (image, ≤10MB)
 * Returns: { ok, thumbnailUrl }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { uploadFile, getFileUrl } from '@/lib/onyxbase';
import { mirrorAsset } from '@/lib/mirror';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const sessionResult = await getSession();
    if (sessionResult.status !== 'ok') {
      return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
    }
    const session = sessionResult.session;

    const formData = await request.formData();
    const file = formData.get('file') as File;
    if (!file) {
      return NextResponse.json({ ok: false, error: 'No file provided' }, { status: 400 });
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ ok: false, error: 'File must be an image' }, { status: 400 });
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: 'Image must be under 10MB' }, { status: 400 });
    }

    // Image bytes: imghosting first (fast, flood-proof), backend fallback.
    let thumbnailUrl: string | null = null;
    try {
      const bytes = Buffer.from(await file.arrayBuffer());
      const mirror = await mirrorAsset(bytes, file.name, file.type, 'image');
      if (mirror.ok && mirror.url) thumbnailUrl = mirror.url;
    } catch {}
    if (!thumbnailUrl) {
      const fileMeta = await uploadFile(file, file.name, file.type, `thumb_${session.userId}`);
      if (!fileMeta) {
        return NextResponse.json(
          { ok: false, error: 'Failed to upload image — please retry.', retryable: true },
          { status: 500 }
        );
      }
      thumbnailUrl = getFileUrl(fileMeta.fileId);
    }

    return NextResponse.json({ ok: true, thumbnailUrl });
  } catch (err) {
    console.error('[resources/thumbnail] error:', err);
    return NextResponse.json({ ok: false, error: 'Thumbnail upload failed' }, { status: 500 });
  }
}
