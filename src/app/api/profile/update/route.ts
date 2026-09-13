/**
 * PATCH /api/profile/update
 * Update the current user's profile (displayName, bio, avatar, username).
 *
 * CRITICAL:
 * - Only the authenticated user can update their own profile
 * - Username changes require uniqueness validation
 * - Uses PATCH semantics (only updates provided fields, preserves the rest)
 * - Updates the session after profile changes
 *
 * Body: { displayName?, bio?, avatar?, username? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getProfile, upsertProfile, getProfileByUsername } from '@/lib/resources';
import {
  isReservedUsername,
  isReservedDisplayName,
  reservedUsernameMessage,
  reservedDisplayNameMessage,
} from '@/lib/reserved';

export async function PATCH(request: NextRequest) {
  try {
    const sessionResult = await getSession();
    if (sessionResult.status !== 'ok') {
      return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
    }
    const session = sessionResult.session;

    // Fetch the current profile from OnyxBase (source of truth)
    const profile = await getProfile(session.userId);
    if (!profile) {
      return NextResponse.json({ ok: false, error: 'Profile not found' }, { status: 404 });
    }

    const body = await request.json();
    const { displayName, bio, avatar, username } = body;

    // If username is changing, validate uniqueness
    if (username && username.toLowerCase() !== profile.username.toLowerCase()) {
      const normalized = username.toLowerCase().trim();

      // Validate format
      if (!/^[a-z0-9_]{3,20}$/.test(normalized)) {
        return NextResponse.json(
          { ok: false, error: 'Username must be 3-20 characters, lowercase letters, numbers, and underscores only' },
          { status: 400 }
        );
      }

      // Reserved identities can never be taken (anti-impersonation)
      if (isReservedUsername(normalized)) {
        return NextResponse.json({ ok: false, error: reservedUsernameMessage() }, { status: 400 });
      }

      // Check uniqueness
      const existing = await getProfileByUsername(normalized);
      if (existing && existing.userId !== profile.userId) {
        return NextResponse.json(
          { ok: false, error: 'This username is already taken' },
          { status: 400 }
        );
      }

      profile.username = normalized;
    }

    // Display name changes also respect the reserved list (anti-impersonation)
    if (displayName !== undefined) {
      if (displayName.trim() && isReservedDisplayName(displayName)) {
        return NextResponse.json({ ok: false, error: reservedDisplayNameMessage() }, { status: 400 });
      }
      profile.displayName = displayName.trim();
    }
    if (bio !== undefined) profile.bio = bio;
    if (avatar !== undefined) profile.avatar = avatar;

    profile.updatedAt = new Date().toISOString();

    // Persist to OnyxBase
    const ok = await upsertProfile(profile);
    if (!ok) {
      return NextResponse.json({ ok: false, error: 'Failed to save profile' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      profile: {
        userId: profile.userId,
        username: profile.username,
        displayName: profile.displayName,
        avatar: profile.avatar,
        bio: profile.bio,
        email: profile.email,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      },
    });
  } catch (err) {
    console.error('[profile/update] error:', err);
    return NextResponse.json({ ok: false, error: 'Profile update failed' }, { status: 500 });
  }
}
