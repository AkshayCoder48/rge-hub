/**
 * POST /api/auth/login
 * Login with OnyxBase API key.
 * Verifies the key and creates a session.
 *
 * Body: { apiKey }
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey } from '@/lib/onyxbase';
import { getProfile, upsertProfile, type Profile } from '@/lib/resources';
import { createSession, isAdminUser } from '@/lib/session';

export async function POST(request: NextRequest) {
  try {
    const { apiKey } = await request.json();
    if (!apiKey || !apiKey.startsWith('kv_live_')) {
      return NextResponse.json(
        { ok: false, error: 'Valid OnyxBase API key required' },
        { status: 400 }
      );
    }

    // Verify the key
    const onyxUser = await verifyApiKey(apiKey);
    if (!onyxUser) {
      return NextResponse.json(
        { ok: false, error: 'Invalid API key' },
        { status: 400 }
      );
    }

    // Get or create profile
    let profile = await getProfile(onyxUser.userId);
    if (!profile) {
      // Auto-create a minimal profile for first login
      const now = new Date().toISOString();
      const username = onyxUser.name?.toLowerCase().replace(/\s+/g, '') || `user_${onyxUser.userId.slice(-6)}`;
      profile = {
        userId: onyxUser.userId,
        username,
        displayName: onyxUser.name || username,
        avatar: '',
        bio: '',
        email: onyxUser.email || '',
        apiKey,
        createdAt: now,
        updatedAt: now,
      } as Profile;
      const profileCreated = await upsertProfile(profile);
      if (!profileCreated) {
        console.error('[login] Failed to create profile for user:', onyxUser.userId);
      } else {
        console.log('[login] Profile created for:', onyxUser.userId, 'username:', username);
      }
    }

    // Update API key in case it changed
    if (profile.apiKey !== apiKey) {
      profile.apiKey = apiKey;
      profile.updatedAt = new Date().toISOString();
      await upsertProfile(profile);
    }

    const isAdmin = isAdminUser({
      username: profile.username,
      displayName: profile.displayName,
      email: profile.email,
    });

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
    console.error('[login] error:', err);
    return NextResponse.json({ ok: false, error: 'Login failed' }, { status: 500 });
  }
}
