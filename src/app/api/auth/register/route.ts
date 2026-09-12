/**
 * POST /api/auth/register
 * Register a new user via OnyxBase's native auth (email + password).
 * Email must be OTP-verified before calling this endpoint.
 *
 * CRITICAL: Performs authoritative uniqueness checks against OnyxBase:
 * 1. Check if email is already registered
 * 2. Check if username is already taken
 * 3. Re-check uniqueness right before creation (race condition protection)
 *
 * Body: {
 *   email,          // verified email
 *   username,       // platform username
 *   displayName,    // display name
 *   password,       // password for OnyxBase account
 *   avatar?, bio?
 * }
 */
import { NextRequest, NextResponse } from 'next/server';
import { registerByEmailPassword } from '@/lib/onyxbase';
import {
  getProfileByUsername,
  isEmailRegistered,
  getProfile,
  upsertProfile,
  type Profile,
} from '@/lib/resources';
import { createSession, isAdminUser } from '@/lib/session';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, username, displayName, password, avatar, bio } = body;

    // Validate inputs
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

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedUsername = username.toLowerCase().trim();

    // Validate username format
    if (!/^[a-z0-9_]{3,20}$/.test(normalizedUsername)) {
      return NextResponse.json(
        { ok: false, error: 'Username must be 3-20 characters, lowercase letters, numbers, and underscores only' },
        { status: 400 }
      );
    }

    // CHECK 1: Is email already registered in our platform profiles?
    const emailExists = await isEmailRegistered(normalizedEmail);
    if (emailExists) {
      return NextResponse.json(
        { ok: false, error: 'This email is already registered. Please log in instead.' },
        { status: 400 }
      );
    }

    // CHECK 2: Is username already taken?
    const usernameExists = await getProfileByUsername(normalizedUsername);
    if (usernameExists) {
      return NextResponse.json(
        { ok: false, error: 'This username is already taken. Please choose another.' },
        { status: 400 }
      );
    }

    // Register with OnyxBase (creates the OnyxBase account)
    const regResult = await registerByEmailPassword(displayName, normalizedEmail, password);
    if (!regResult.ok || !regResult.apiKey) {
      // OnyxBase may reject if email is already registered there
      return NextResponse.json(
        { ok: false, error: regResult.error || 'Registration failed. This email may already be registered.' },
        { status: 400 }
      );
    }

    // RACE CONDITION PROTECTION: Re-check uniqueness after OnyxBase registration
    // (another request might have created a profile with the same username/email)
    const emailRecheck = await isEmailRegistered(normalizedEmail);
    const usernameRecheck = await getProfileByUsername(normalizedUsername);
    if (emailRecheck || usernameRecheck) {
      // Another request won the race — but we already created the OnyxBase account.
      // The user can still log in, they just need to pick a different username.
      return NextResponse.json(
        { ok: false, error: 'Username or email was just taken. Please try logging in or use a different username.' },
        { status: 409 }
      );
    }

    // Create platform profile
    const now = new Date().toISOString();
    const profile: Profile = {
      userId: regResult.userId!,
      username: normalizedUsername,
      displayName: displayName.trim(),
      avatar: avatar || '',
      bio: bio || '',
      email: normalizedEmail,
      apiKey: regResult.apiKey,
      createdAt: now,
      updatedAt: now,
    };

    const profileCreated = await upsertProfile(profile);
    if (!profileCreated) {
      console.error('[register] Failed to persist profile for user:', regResult.userId);
      // The OnyxBase account was created but profile persistence failed.
      // The user can still log in (login auto-creates a profile).
      return NextResponse.json(
        { ok: false, error: 'Account created but profile setup failed. Please try logging in.' },
        { status: 500 }
      );
    }

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
