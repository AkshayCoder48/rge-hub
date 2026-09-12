/**
 * POST /api/profile/avatar
 * Upload an avatar image to OnyxBase file storage and update the user's profile.
 *
 * Body: FormData with "file" field (image)
 * Returns: { ok, avatarUrl }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getProfile, upsertProfile } from '@/lib/resources';
import { uploadFile, getFileUrl } from '@/lib/onyxbase';

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

    // Upload to OnyxBase
    const fileMeta = await uploadFile(file, file.name, file.type, `avatar_${session.userId}`);
    if (!fileMeta) {
      return NextResponse.json({ ok: false, error: 'Failed to upload image' }, { status: 500 });
    }

    const avatarUrl = getFileUrl(fileMeta.fileId);

    // Update profile with avatar URL
    const profile = await getProfile(session.userId);
    if (!profile) {
      return NextResponse.json({ ok: false, error: 'Profile not found' }, { status: 404 });
    }

    profile.avatar = avatarUrl;
    profile.updatedAt = new Date().toISOString();
    await upsertProfile(profile);

    return NextResponse.json({ ok: true, avatarUrl });
  } catch (err) {
    console.error('[profile/avatar] error:', err);
    return NextResponse.json({ ok: false, error: 'Avatar upload failed' }, { status: 500 });
  }
}
