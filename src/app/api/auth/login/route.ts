/**
 * POST /api/auth/login
 * Login with email + password via OnyxBase's native auth.
 *
 * Body: { email, password }
 *
 * Flow:
 * 1. Call OnyxBase /api/auth/login with {email, password}
 * 2. OnyxBase returns apiKey + userId + name
 * 3. Get or create platform profile
 * 4. Create session
 */
import { NextRequest, NextResponse } from 'next/server';
import { loginByEmailPassword } from '@/lib/onyxbase';
import { getProfile, upsertProfile, type Profile } from '@/lib/resources';
import { createSession, isAdminUser } from '@/lib/session';
import { isReservedUsername } from '@/lib/reserved';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();
    if (!email || !password) {
      return NextResponse.json(
        { ok: false, error: 'Email and password are required' },
        { status: 400 }
      );
    }

    // Login via OnyxBase (verifies credentials, returns API key)
    const loginResult = await loginByEmailPassword(email, password);
    if (!loginResult.ok || !loginResult.apiKey) {
      return NextResponse.json(
        { ok: false, error: loginResult.error || 'Invalid email or password' },
        { status: 400 }
      );
    }

    // Get or create platform profile
    let profile = await getProfile(loginResult.userId!);
    if (!profile) {
      // Auto-create a minimal profile for first login
      const now = new Date().toISOString();
      let username = (loginResult.name || email.split('@')[0]).toLowerCase().replace(/[^a-z0-9_]/g, '') || `user_${loginResult.userId!.slice(-6)}`;
      // Never auto-assign a reserved (staff-lookalike) username
      if (isReservedUsername(username)) {
        username = `user_${loginResult.userId!.replace(/[^a-z0-9]/gi, '').slice(-8).toLowerCase() || 'member'}`;
      }
      profile = {
        userId: loginResult.userId!,
        username,
        displayName: loginResult.name || username,
        avatar: '',
        bio: '',
        email: loginResult.email || email.toLowerCase().trim(),
        apiKey: loginResult.apiKey,
        createdAt: now,
        updatedAt: now,
      } as Profile;

      // Retry profile creation to handle OnyxBase inconsistency.
      // (upsertProfile already paces internally via kvSetMulti — these
      // outer rounds are only a cheap safety net, not the pacing policy.)
      let profileCreated = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        profileCreated = await upsertProfile(profile);
        if (profileCreated) break;
        console.warn(`[login] upsertProfile failed (attempt ${attempt + 1})`);
        await new Promise(r => setTimeout(r, 5000));
      }
      if (!profileCreated) {
        console.error('[login] Failed to create profile after 2 attempts for user:', loginResult.userId);
      }
    } else {
      // Update API key in case it changed
      if (profile.apiKey !== loginResult.apiKey) {
        profile.apiKey = loginResult.apiKey;
        profile.updatedAt = new Date().toISOString();
        await upsertProfile(profile);
      }
    }

    const isAdmin = isAdminUser({
      username: profile.username,
      displayName: profile.displayName,
      email: profile.email,
    });

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
    console.error('[login] error:', err);
    return NextResponse.json({ ok: false, error: 'Login failed' }, { status: 500 });
  }
}
