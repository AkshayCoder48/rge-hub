/**
 * POST /api/auth/register
 * Register a new user via OnyxBase's native auth (email + password).
 * Email must be OTP-verified before calling this endpoint.
 *
 * Body: {
 *   email,          // verified email
 *   username,       // platform username
 *   displayName,    // display name
 *   password,       // password for OnyxBase account
 *   avatar?, bio?
 * }
 *
 * Flow:
 * 1. Call OnyxBase /api/auth/register with {name, email, password}
 * 2. OnyxBase returns apiKey + userId
 * 3. Create platform profile in OnyxBase KV
 * 4. Create session
 */
import { NextRequest, NextResponse } from 'next/server';
import { registerByEmailPassword } from '@/lib/onyxbase';
import { getProfileByUsername, upsertProfile, type Profile } from '@/lib/resources';
import { createSession, isAdminUser } from '@/lib/session';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, username, displayName, password, avatar, bio } = body;

    // Validate
    if (!email || !username || !displayName || !password) {
      return NextResponse.json(
        { ok: false, error: 'Email, username, display name, and password are required' },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { ok: false, error: 'Password must be at least 6 characters' },
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

    // Register with OnyxBase (creates the OnyxBase account)
    const regResult = await registerByEmailPassword(displayName, email, password);
    if (!regResult.ok || !regResult.apiKey) {
      return NextResponse.json(
        { ok: false, error: regResult.error || 'Registration failed on OnyxBase' },
        { status: 400 }
      );
    }

    // Create platform profile
    const now = new Date().toISOString();
    const profile: Profile = {
      userId: regResult.userId!,
      username: username.toLowerCase().trim(),
      displayName: displayName.trim(),
      avatar: avatar || '',
      bio: bio || '',
      email: email.toLowerCase().trim(),
      apiKey: regResult.apiKey,
      createdAt: now,
      updatedAt: now,
    };

    await upsertProfile(profile);

    // Check if this is the admin
    const isAdmin = isAdminUser({
      username: profile.username,
      displayName: profile.displayName,
      email: profile.email,
    });

    // Create session
    await createSession({
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
