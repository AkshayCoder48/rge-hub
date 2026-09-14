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
import { registerByEmailPassword, backendAcceptsWrites } from '@/lib/onyxbase';
import {
  getProfileByUsername,
  isEmailRegistered,
  getProfile,
  upsertProfile,
  type Profile,
} from '@/lib/resources';
import { createSession, isAdminUser } from '@/lib/session';
import {
  isReservedUsername,
  isReservedDisplayName,
  reservedUsernameMessage,
  reservedDisplayNameMessage,
} from '@/lib/reserved';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

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

    // Reserved identities can never be taken (anti-impersonation)
    if (isReservedUsername(normalizedUsername)) {
      return NextResponse.json({ ok: false, error: reservedUsernameMessage() }, { status: 400 });
    }
    if (isReservedDisplayName(displayName)) {
      return NextResponse.json({ ok: false, error: reservedDisplayNameMessage() }, { status: 400 });
    }

    // CHECK 1+2 (parallel): email registered? username taken? Independent
    // Circuit breaker: fail in seconds when the backend is drowning in
    // Telegram 429s — never grind minutes into a timeout.
    if (!(await backendAcceptsWrites())) {
      return NextResponse.json(
        { ok: false, error: 'Servers are busy — please retry in a minute.', retryable: true },
        { status: 503 }
      );
    }
    // backend reads — run together to halve worst-case latency under flood.
    const [emailExists, usernameExists] = await Promise.all([
      isEmailRegistered(normalizedEmail),
      getProfileByUsername(normalizedUsername),
    ]);
    if (emailExists) {
      return NextResponse.json(
        { ok: false, error: 'This email is already registered. Please log in instead.' },
        { status: 400 }
      );
    }
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
    const [emailRecheck, usernameRecheck] = await Promise.all([
      isEmailRegistered(normalizedEmail),
      getProfileByUsername(normalizedUsername),
    ]);
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

    // Best-effort: the native pin just spent the backend's global pin
    // budget, so this usually paces (lands ~40s later or at next login).
    // NEVER fail registration for it — login auto-creates the profile
    // (get-or-create) and the session below already logs the user in.
    const profileCreated = await upsertProfile(profile);
    if (!profileCreated) {
      console.warn('[register] profile pending for user (login will heal it):', regResult.userId);
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
      email: profile.email,
      avatar: profile.avatar,
      bio: profile.bio,
      apiKey: profile.apiKey,
      isAdmin,
    });

    return NextResponse.json({
      ok: true,
      profilePending: !profileCreated,
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
