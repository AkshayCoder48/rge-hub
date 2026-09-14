/**
 * GET /api/profile/[username]
 * Public profile lookup by username, plus that user's public resources.
 *
 * Includes retry logic for OnyxBase eventual consistency.
 * Only returns "User not found" after definitively confirming the profile doesn't exist.
 *
 * Returns: { ok: true, profile, resources }
 *   - profile excludes apiKey
 */
import { NextRequest, NextResponse } from 'next/server';
import { getProfileByUsername, listResourcesByOwner, type Profile } from '@/lib/resources';
import { loadStaffRoleMap, publicRoleFor } from '@/lib/admin';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    const { username } = await params;
    if (!username) {
      return NextResponse.json({ ok: false, error: 'Username is required' }, { status: 400 });
    }

    // Retry profile lookup (OnyxBase eventual consistency)
    let profile: Profile | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      profile = await getProfileByUsername(username);
      if (profile) break;
      if (attempt < 2) await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
    }

    if (!profile) {
      return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 });
    }

    // Strip sensitive fields
    const staffMap = await loadStaffRoleMap().catch(() => new Map<string, 'admin' | 'moderator'>());
    const safeProfile: Omit<Profile, 'apiKey'> & { apiKey?: never; role?: string } = {
      userId: profile.userId,
      username: profile.username,
      displayName: profile.displayName,
      avatar: profile.avatar,
      bio: profile.bio,
      email: profile.email,
      role: publicRoleFor(profile, staffMap),
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
