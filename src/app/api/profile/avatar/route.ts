/**
 * POST /api/profile/avatar
 * Upload an avatar image and update the user's profile.
 *
 * Primary: imghosting edge (sub-second, flood-proof) — avatars are small
 * images, never backend bytes. Fallback: backend file storage.
 * The profile row still lives in the backend (circuit-breaker gated).
 *
 * Body: FormData with "file" field (image, ≤10MB)
 * Returns: { ok, avatarUrl }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getProfile, upsertProfile } from '@/lib/resources';
import { uploadFile, getFileUrl, backendAcceptsWrites } from '@/lib/onyxbase';
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

    // Validate file size (max 10MB for avatars)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: 'Image must be under 10MB' }, { status: 400 });
    }

    // Circuit breaker: the profile row needs the backend — fail in seconds
    // when it's drowning, before spending time on the image bytes.
    if (!(await backendAcceptsWrites())) {
      return NextResponse.json(
        { ok: false, error: 'The storage service is briefly throttled — your data is safe; please retry in a moment.', retryable: true },
        { status: 503 }
      );
    }

    // Image bytes: imghosting first (fast, flood-proof), backend fallback.
    let avatarUrl: string | null = null;
    try {
      const bytes = Buffer.from(await file.arrayBuffer());
      const mirror = await mirrorAsset(bytes, file.name, file.type, 'image');
      if (mirror.ok && mirror.url) avatarUrl = mirror.url;
    } catch {}
    if (!avatarUrl) {
      const fileMeta = await uploadFile(file, file.name, file.type, `avatar_${session.userId}`);
      if (!fileMeta) {
        return NextResponse.json(
          { ok: false, error: 'Failed to upload image — please retry.', retryable: true },
          { status: 500 }
        );
      }
      avatarUrl = getFileUrl(fileMeta.fileId);
    }

    // Update profile with avatar URL
    const profile = await getProfile(session.userId);
    if (!profile) {
      return NextResponse.json({ ok: false, error: 'Profile not found' }, { status: 404 });
    }

    profile.avatar = avatarUrl;
    profile.updatedAt = new Date().toISOString();
    const saved = await upsertProfile(profile);
    if (!saved) {
      return NextResponse.json(
        { ok: false, error: 'Avatar uploaded but profile save failed — please retry.', retryable: true },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, avatarUrl });
  } catch (err) {
    console.error('[profile/avatar] error:', err);
    return NextResponse.json({ ok: false, error: 'Avatar upload failed' }, { status: 500 });
  }
}
