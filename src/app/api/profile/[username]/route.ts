/**
 * GET /api/profile/[username]
 * Public profile lookup by username, plus that user's public resources.
 *
 * Returns: { ok: true, profile, resources }
 *   - profile excludes apiKey
 */
import { NextRequest, NextResponse } from 'next/server';
import { getProfileByUsername, listResourcesByOwner, type Profile } from '@/lib/resources';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    const { username } = await params;
    if (!username) {
      return NextResponse.json({ ok: false, error: 'Username is required' }, { status: 400 });
    }

    const profile = await getProfileByUsername(username);
    if (!profile) {
      return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 });
    }

    // Strip sensitive fields
    const safeProfile: Omit<Profile, 'apiKey'> & { apiKey?: never } = {
      userId: profile.userId,
      username: profile.username,
      displayName: profile.displayName,
      avatar: profile.avatar,
      bio: profile.bio,
      email: profile.email,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };

    const allResources = await listResourcesByOwner(profile.userId);
    const publicResources = allResources.filter(r => r.published);

    return NextResponse.json({
      ok: true,
      profile: safeProfile,
      resources: publicResources,
    });
  } catch (err) {
    console.error('[profile/get] error:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to load profile' },
      { status: 500 }
    );
  }
}
