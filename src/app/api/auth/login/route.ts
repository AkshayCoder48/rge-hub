/**
 * POST /api/auth/login
 *
 * PRD V5 §19 — login follows the same operation model as registration:
 * requestId idempotency, recovery after a lost response, honest errors.
 *
 * Body: { email, password, requestId? }
 * Success: 200 { ok, status:'authenticated', user, recovered? }
 * Busy twin: 202 { ok, status:'processing', operationId }
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  ONYXBASE_V5_ENABLED,
  v5LoginAccount,
  v5GetAuthOpMarker,
  v5PutAuthOpMarker,
  loginByEmailPassword,
  backendAcceptsWrites,
} from '@/lib/onyxbase';
import { getProfile, upsertProfile, type Profile } from '@/lib/resources';
import { createSession, isAdminUser } from '@/lib/session';
import { isReservedUsername } from '@/lib/reserved';
import {
  normalizeRequestId,
  authAttemptBegin,
  authAttemptComplete,
  authAttemptFail,
  authRecordFromV5Marker,
  authProcessingResponse,
  type AuthRecoveryRecord,
} from '@/lib/auth-idempotency';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

async function issueSessionResponse(rec: AuthRecoveryRecord, recovered = false) {
  await createSession({
    userId: rec.userId,
    username: rec.username,
    displayName: rec.displayName,
    email: rec.email,
    avatar: rec.avatar,
    bio: rec.bio,
    apiKey: rec.apiKey,
    isAdmin: rec.isAdmin,
  });
  return NextResponse.json({
    ok: true,
    status: 'authenticated',
    user: {
      userId: rec.userId,
      username: rec.username,
      displayName: rec.displayName,
      avatar: rec.avatar || '',
      bio: rec.bio || '',
      isAdmin: rec.isAdmin,
    },
    ...(recovered ? { recovered: true } : {}),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
    }
    const { email, password } = body;
    const requestId =
      normalizeRequestId(body.requestId) ?? normalizeRequestId(request.headers.get('idempotency-key'));

    // ─── 1. Idempotent recovery (BEFORE any work) ─────────────────────────
    if (requestId) {
      const key = `login:${requestId}`;
      const begun = authAttemptBegin(key);
      if (begun.recovery) {
        return await issueSessionResponse(begun.recovery, true);
      }
      if (begun.inFlight) {
        return authProcessingResponse('login', requestId, request.headers.get('x-request-id') || requestId);
      }
      if (ONYXBASE_V5_ENABLED) {
        const marker = await v5GetAuthOpMarker('login', requestId);
        if (marker) {
          const rec = authRecordFromV5Marker(marker);
          authAttemptComplete(key, rec);
          return await issueSessionResponse(rec, true);
        }
      }
    }

    if (!email || !password) {
      return NextResponse.json(
        { ok: false, code: 'VALIDATION_ERROR', error: 'Email and password are required' },
        { status: 400 }
      );
    }
    const normalizedEmail = email.toLowerCase().trim();

    // ─── 2. Authenticate (V5 fast path / V4 legacy) ────────────────────────
    let loginUserId: string | undefined;
    let loginApiKey: string | undefined;
    let loginName: string | undefined;

    if (ONYXBASE_V5_ENABLED) {
      const login = await v5LoginAccount(normalizedEmail, password);
      if (login.ok && login.userId && login.apiKey) {
        loginUserId = login.userId;
        loginApiKey = login.apiKey;
        loginName = login.name;
      } else if (login.code === 'UPSTREAM_UNAVAILABLE') {
        if (requestId) authAttemptFail(`login:${requestId}`)
        return NextResponse.json(
          { ok: false, code: 'UPSTREAM_UNAVAILABLE', error: login.error, retryable: true },
          { status: 503 }
        );
      } else if (login.code === 'RATE_LIMITED') {
        return NextResponse.json(
          { ok: false, code: 'RATE_LIMITED', error: login.error || 'Too many attempts — please wait a moment.', retryable: true },
          { status: 429 }
        );
      } else {
        // V5 has no such account (or bad password) — fall through to V4 for
        // legacy accounts that predate the migration, keeping one honest
        // error when both paths fail.
        if (await backendAcceptsWrites()) {
          const legacy = await loginByEmailPassword(normalizedEmail, password);
          if (legacy.ok && legacy.apiKey && legacy.userId) {
            loginUserId = legacy.userId;
            loginApiKey = legacy.apiKey;
            loginName = legacy.name;
          }
        }
        if (!loginUserId) {
          if (requestId) authAttemptFail(`login:${requestId}`);
          return NextResponse.json(
            { ok: false, code: 'AUTH_INVALID_CREDENTIALS', error: 'Invalid email or password' },
            { status: 401 }
          );
        }
      }
    } else {
      if (!(await backendAcceptsWrites())) {
        if (requestId) authAttemptFail(`login:${requestId}`)
        return NextResponse.json(
          { ok: false, code: 'UPSTREAM_UNAVAILABLE', error: 'The auth service is briefly unavailable — please retry.', retryable: true },
          { status: 503 }
        );
      }
      const loginResult = await loginByEmailPassword(normalizedEmail, password);
      if (!loginResult.ok || !loginResult.apiKey || !loginResult.userId) {
        if (requestId) authAttemptFail(`login:${requestId}`);
        return NextResponse.json(
          { ok: false, code: 'AUTH_INVALID_CREDENTIALS', error: loginResult.error || 'Invalid email or password' },
          { status: 401 }
        );
      }
      loginUserId = loginResult.userId;
      loginApiKey = loginResult.apiKey;
      loginName = loginResult.name;
    }

    // ─── 3. Get-or-create platform profile ─────────────────────────────────
    let profile = await getProfile(loginUserId!);
    if (!profile) {
      const now = new Date().toISOString();
      let username = (loginName || normalizedEmail.split('@')[0]).toLowerCase().replace(/[^a-z0-9_]/g, '') || `user_${loginUserId!.slice(-6)}`;
      if (isReservedUsername(username)) {
        username = `user_${loginUserId!.replace(/[^a-z0-9]/gi, '').slice(-8).toLowerCase() || 'member'}`;
      }
      profile = {
        userId: loginUserId!,
        username,
        displayName: loginName || username,
        avatar: '',
        bio: '',
        email: normalizedEmail,
        apiKey: loginApiKey!,
        createdAt: now,
        updatedAt: now,
      } as Profile;
      const profileCreated = await upsertProfile(profile);
      if (!profileCreated) {
        console.error('[login] Failed to create profile for user:', loginUserId);
      }
    } else if (profile.apiKey !== loginApiKey) {
      profile.apiKey = loginApiKey!;
      await upsertProfile(profile);
    }

    // ─── 4. Record completion + session ────────────────────────────────────
    const isAdmin = isAdminUser({
      userId: profile.userId,
      username: profile.username,
      displayName: profile.displayName,
      email: profile.email,
    });
    const record: AuthRecoveryRecord = {
      userId: profile.userId,
      username: profile.username,
      displayName: profile.displayName,
      email: profile.email,
      avatar: profile.avatar,
      bio: profile.bio,
      apiKey: loginApiKey!,
      isAdmin,
    };
    if (requestId) {
      authAttemptComplete(`login:${requestId}`, record);
      if (ONYXBASE_V5_ENABLED) {
        void v5PutAuthOpMarker('login', requestId, { ...record });
      }
    }
    return await issueSessionResponse(record);
  } catch (err) {
    console.error('[login] error:', err);
    return NextResponse.json(
      { ok: false, code: 'UNKNOWN_ERROR', error: 'Sign-in failed. Please try again.' },
      { status: 500 }
    );
  }
}
