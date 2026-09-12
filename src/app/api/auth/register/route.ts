/**
 * POST /api/auth/register
 * Register a new user with email, username, display name, and OnyxBase API key.
 * Email must be OTP-verified before calling this endpoint.
 *
 * Body: {
 *   email, username, displayName, apiKey, avatar?, bio?
 * }
 *
 * The user provides their own OnyxBase API key (kv_live_*).
 * We verify it via OnyxBase /api/auth/verify, then create a profile.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey, ONYXBASE_COLLECTIONS } from '@/lib/onyxbase';
import { getProfile, getProfileByUsername, upsertProfile, type Profile } from '@/lib/resources';
import { createSession, isAdminUser } from '@/lib/session';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, username, displayName, apiKey, avatar, bio } = body;

    // Validate
    if (!email || !username || !displayName || !apiKey) {
      return NextResponse.json(
        { ok: false, error: 'Email, username, display name, and API key are required' },
        { status: 400 }
      );
    }

    if (!apiKey.startsWith('kv_live_')) {
      return NextResponse.json(
        { ok: false, error: 'Invalid OnyxBase API key format. Keys start with kv_live_' },
        { status: 400 }
      );
    }

    // Verify the API key with OnyxBase
    const onyxUser = await verifyApiKey(apiKey);
    if (!onyxUser) {
      return NextResponse.json(
        { ok: false, error: 'Invalid OnyxBase API key. Please check your key from onyxbase-phi.vercel.app' },
        { status: 400 }
      );
    }

    // Check if username is taken
    const existingByUsername = await getProfileByUsername(username);
    if (existingByUsername) {
      return NextResponse.json(
        { ok: false, error: 'Username already taken' },
        { status: 400 }
      );
    }

    // Check if user already has a profile (same OnyxBase userId)
    const existingProfile = await getProfile(onyxUser.userId);
    if (existingProfile) {
      return NextResponse.json(
        { ok: false, error: 'Account already exists for this OnyxBase key. Please login instead.' },
        { status: 400 }
      );
    }

    // Create profile
    const now = new Date().toISOString();
    const profile: Profile = {
      userId: onyxUser.userId,
      username: username.toLowerCase().trim(),
      displayName: displayName.trim(),
      avatar: avatar || '',
      bio: bio || '',
      email: email.toLowerCase().trim(),
      apiKey, // store the user's own key for file operations
      createdAt: now,
      updatedAt: now,
    };

    await upsertProfile(profile);

    // Check if this is the admin
    const isAdmin = isAdminUser({ username: profile.username, displayName: profile.displayName, email: profile.email });

    // Create session
    const session = await createSession({
      userId: profile.userId,
      username: profile.username,
      displayName: profile.displayName,
      avatar: profile.avatar,
      bio: profile.bio,
      apiKey: profile.apiKey,
      isAdmin,
    });

    return NextResponse.json({
      ok: true,
      user: {
        userId: profile.userId,
        username: profile.username,
        displayName: profile.displayName,
        avatar: profile.avatar,
        bio: profile.bio,
        isAdmin,
      },
    });
  } catch (err) {
    console.error('[register] error:', err);
    return NextResponse.json({ ok: false, error: 'Registration failed' }, { status: 500 });
  }
}
