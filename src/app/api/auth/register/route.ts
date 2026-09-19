/**
 * POST /api/auth/register
 *
 * PRD V5 §7-8 — transactionally-correct, idempotent registration.
 *
 * The bug this fixes: the account committed server-side, the response (and
 * its session cookie) was lost to a timeout, the UI said "still working",
 * the user re-tapped, and the backend said "email already registered" — a
 * dead end. Now:
 *
 *   1. Every attempt carries a client requestId (UUID, stable across the
 *      UI's auto-retries). A retry with the SAME requestId RE-ISSUES the
 *      session — never a second account, never "already registered".
 *   2. Recovery is checked BEFORE any work: in-memory registry → V5 kv
 *      marker (durable, cross-instance) → V5 operation lookup.
 *   3. A credential holder ALWAYS gets a session: when the account exists
 *      and the supplied password verifies (V5 login), the user owns it —
 *      sign them in (created:false) instead of erroring.
 *   4. 409 EMAIL_ALREADY_REGISTERED (no password proof) carries
 *      hint:'sign-in' so the UI routes to login instead of dead-ending.
 *
 * Body: { email, username, displayName, password, avatar?, bio?, requestId? }
 * Success: 200 { ok, status:'authenticated', user, created, recovered? }
 * Busy twin: 202 { ok, status:'processing', operationId }
 */
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import {
  ONYXBASE_V5_ENABLED,
  v5CreateAccount,
  v5LoginAccount,
  v5GetAuthOpMarker,
  v5PutAuthOpMarker,
  registerByEmailPassword,
  loginByEmailPassword,
  backendAcceptsWrites,
} from '@/lib/onyxbase';
import {
  getProfileByUsername,
  getProfile,
  getProfileByEmail,
  upsertProfile,
  type Profile,
} from '@/lib/resources';
import { createSession, isAdminUser } from '@/lib/session';
import {
  verifyOtp,
  verifyRegistrationToken,
  consumeRegistrationTransaction,
} from '@/lib/otp';
import {
  isReservedUsername,
  isReservedDisplayName,
  reservedUsernameMessage,
  reservedDisplayNameMessage,
} from '@/lib/reserved';
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

/** Short, non-reversible email identifier for structured auth logs (PRD §15). */
function emailTag(email: string): string {
  return crypto.createHash('sha256').update(`rge-log:${email}`).digest('hex').slice(0, 12);
}

/** One structured auth-flow log line — never OTPs, passwords, or tokens. */
function authLog(
  requestId: string | null,
  operation: string,
  result: string,
  context: {
    email?: string;
    verificationTx?: string;
    errorCode?: string;
    durationMs?: number;
    created?: boolean;
  } = {}
) {
  console.log(
    JSON.stringify({
      t: new Date().toISOString(),
      requestId: requestId || '-',
      authFlow: 'registration',
      operation,
      result,
      ...(context.email ? { emailHash: emailTag(context.email) } : {}),
      ...(context.verificationTx ? { verificationTx: context.verificationTx } : {}),
      ...(context.errorCode ? { errorCode: context.errorCode } : {}),
      ...(context.created !== undefined ? { created: context.created } : {}),
      durationMs: context.durationMs ?? 0,
    })
  );
}

function userPayload(rec: AuthRecoveryRecord) {
  return {
    userId: rec.userId,
    username: rec.username,
    displayName: rec.displayName,
    avatar: rec.avatar || '',
    bio: rec.bio || '',
    isAdmin: rec.isAdmin,
  };
}

/** Re-issue the session cookie from a recovery record and answer 200. */
async function issueSessionResponse(rec: AuthRecoveryRecord, created: boolean, recovered = false) {
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
    user: userPayload(rec),
    created,
    ...(recovered ? { recovered: true } : {}),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
    }
    const { email, username, displayName, password, avatar, bio } = body;
    const requestId =
      normalizeRequestId(body.requestId) ?? normalizeRequestId(request.headers.get('idempotency-key'));

    // ─── 1. Idempotent recovery (BEFORE any work) ─────────────────────────
    if (requestId) {
      const key = `register:${requestId}`;
      const begun = authAttemptBegin(key);
      if (begun.recovery) {
        return await issueSessionResponse(begun.recovery, false, true);
      }
      if (begun.inFlight) {
        return authProcessingResponse('register', requestId, request.headers.get('x-request-id') || requestId);
      }
      // Durable cross-instance marker (V5): another instance completed it.
      if (ONYXBASE_V5_ENABLED) {
        const marker = await v5GetAuthOpMarker('register', requestId);
        if (marker) {
          const rec = authRecordFromV5Marker(marker);
          authAttemptComplete(key, rec);
          return await issueSessionResponse(rec, false, true);
        }
      }
    }

    // ─── 2. Validation ─────────────────────────────────────────────────
    if (!email || !username || !displayName || !password) {
      return NextResponse.json(
        { ok: false, code: 'VALIDATION_ERROR', error: 'Email, username, display name, and password are required' },
        { status: 400 }
      );
    }
    if (password.length < 6) {
      return NextResponse.json(
        { ok: false, code: 'VALIDATION_ERROR', error: 'Password must be at least 6 characters' },
        { status: 400 }
      );
    }
    const normalizedEmail = email.toLowerCase().trim();
    const normalizedUsername = username.toLowerCase().trim();
    if (!/^[a-z0-9_]{3,20}$/.test(normalizedUsername)) {
      return NextResponse.json(
        { ok: false, code: 'VALIDATION_ERROR', error: 'Username must be 3-20 characters, lowercase letters, numbers, and underscores only' },
        { status: 400 }
      );
    }
    if (isReservedUsername(normalizedUsername)) {
      return NextResponse.json({ ok: false, code: 'VALIDATION_ERROR', error: reservedUsernameMessage() }, { status: 400 });
    }
    if (isReservedDisplayName(displayName)) {
      return NextResponse.json({ ok: false, code: 'VALIDATION_ERROR', error: reservedDisplayNameMessage() }, { status: 400 });
    }

    // ─── 2.5 EMAIL-OWNERSHIP PROOF (server-side verification state) ─────
    // The backend is the source of truth for "this email is verified for
    // registration". Two accepted proofs, in priority order:
    //
    //   a) verificationToken — the HMAC-signed, purpose-bound transaction
    //      issued by the SUCCESSFUL OTP-verification step. This is the
    //      normal UI path: the user verifies the code ONCE, and the
    //      create-account request presents the transaction (never the same
    //      OTP twice).
    //
    //   b) LEGACY direct proof: otpRef + 6-digit code (the AI SENSE temp
    //      record). Still accepted so in-flight clients and API consumers
    //      don't break.
    //
    // Neither present → EMAIL_VERIFICATION_REQUIRED (a precise, stable
    // code — never a misleading "enter the code" error for a user who
    // already verified).
    const tVerificationStart = Date.now();
    const verificationToken =
      typeof body.verificationToken === 'string' ? body.verificationToken.trim() : '';
    const otpRef = typeof body.otpRef === 'string' ? body.otpRef.trim() : '';
    const otpCode = typeof body.code === 'string' ? body.code.trim() : '';

    let verifiedTransactionId = '';

    if (verificationToken) {
      const tx = verifyRegistrationToken(verificationToken);
      if (!tx.ok) {
        // A CONSUMED transaction means this flow ALREADY created an account
        // — the appropriate response is the existing-account one (the UI
        // routes to sign-in), never a misleading "verify again" dead end.
        if (tx.reason === 'consumed') {
          const existing = await getProfileByEmail(normalizedEmail).catch(() => null);
          if (existing) {
            authLog(request.headers.get('x-request-id'), 'verification_check', 'consumed_existing_account', {
              email: normalizedEmail,
              errorCode: 'EMAIL_ALREADY_REGISTERED',
              durationMs: Date.now() - tVerificationStart,
            });
            return NextResponse.json(
              {
                ok: false,
                code: 'EMAIL_ALREADY_REGISTERED',
                error: 'An account with this email already exists. Please sign in instead.',
                hint: 'sign-in',
              },
              { status: 409 }
            );
          }
        }
        const code =
          tx.reason === 'expired' ? 'VERIFICATION_EXPIRED' : 'VERIFICATION_INVALID';
        const message =
          tx.reason === 'expired'
            ? 'Email verification expired. Please request a new code.'
            : tx.reason === 'consumed'
              ? 'This verification was already used. Please request a new code.'
              : 'Email verification could not be validated. Please request a new code.';
        authLog(request.headers.get('x-request-id'), 'verification_check', 'rejected', {
          email: normalizedEmail,
          errorCode: code,
          durationMs: Date.now() - tVerificationStart,
        });
        return NextResponse.json(
          { ok: false, code, error: message, hint: 'reverify' },
          { status: 400 }
        );
      }
      if (tx.email !== normalizedEmail) {
        // The transaction is bound to the verified email — a token issued
        // for one address can never register another.
        authLog(request.headers.get('x-request-id'), 'verification_check', 'email_mismatch', {
          email: normalizedEmail,
          errorCode: 'VERIFICATION_INVALID',
          durationMs: Date.now() - tVerificationStart,
        });
        return NextResponse.json(
          {
            ok: false,
            code: 'VERIFICATION_INVALID',
            error: 'Email verification could not be validated for this address. Please request a new code.',
            hint: 'reverify',
          },
          { status: 400 }
        );
      }
      verifiedTransactionId = tx.transactionId ?? '';
      authLog(request.headers.get('x-request-id'), 'verification_check', 'verified', {
        email: normalizedEmail,
        verificationTx: verifiedTransactionId.slice(0, 8),
        durationMs: Date.now() - tVerificationStart,
      });
    } else if (otpRef || otpCode) {
      // LEGACY direct proof — the pre-verification-token contract. Exactly
      // one direct OTP check (same temp-KV workflow as the verify step).
      if (!otpRef || !/^\d{6}$/.test(otpCode)) {
        return NextResponse.json(
          { ok: false, code: 'OTP_REQUIRED', error: 'Enter the 6-digit code sent to your email to verify this address.' },
          { status: 400 }
        );
      }
      const otpCheck = await verifyOtp(normalizedEmail, otpCode, 'registration', otpRef);
      if (!otpCheck.ok) {
        const status = otpCheck.errorCode === 'OTP_ATTEMPTS_EXCEEDED' ? 429 : 400;
        authLog(request.headers.get('x-request-id'), 'verification_check', 'rejected', {
          email: normalizedEmail,
          errorCode: otpCheck.errorCode || 'OTP_INVALID',
          durationMs: Date.now() - tVerificationStart,
        });
        return NextResponse.json(
          {
            ok: false,
            code: otpCheck.errorCode || 'OTP_INVALID',
            error: otpCheck.error || 'Invalid verification code.',
            ...(otpCheck.otpRef ? { otpRef: otpCheck.otpRef } : {}),
          },
          { status }
        );
      }
      verifiedTransactionId = otpRef;
    } else {
      authLog(request.headers.get('x-request-id'), 'verification_check', 'missing', {
        email: normalizedEmail,
        errorCode: 'EMAIL_VERIFICATION_REQUIRED',
        durationMs: Date.now() - tVerificationStart,
      });
      return NextResponse.json(
        {
          ok: false,
          code: 'EMAIL_VERIFICATION_REQUIRED',
          error: 'Email verification is required before creating an account.',
          hint: 'verify-email',
        },
        { status: 400 }
      );
    }

    // ─── 3. Account creation (V5 fast path / V4 legacy) ───────────────────
    let accountUserId: string | undefined;
    let accountApiKey: string | undefined;
    let created = false;

    if (ONYXBASE_V5_ENABLED) {
      const reg = await v5CreateAccount(displayName.trim(), normalizedEmail, password, requestId ?? undefined);
      if (reg.ok && reg.userId && reg.apiKey) {
        accountUserId = reg.userId;
        accountApiKey = reg.apiKey;
        created = true;
      } else if (reg.code === 'EMAIL_TAKEN') {
        // The account exists. The supplied password is ownership proof —
        // verify it and sign in instead of dead-ending.
        const login = await v5LoginAccount(normalizedEmail, password);
        if (login.ok && login.userId && login.apiKey) {
          accountUserId = login.userId;
          accountApiKey = login.apiKey;
          created = false;
        } else {
          if (requestId) authAttemptFail(`register:${requestId}`);
          return NextResponse.json(
            {
              ok: false,
              code: 'EMAIL_ALREADY_REGISTERED',
              error: 'An account with this email already exists. Please sign in instead.',
              hint: 'sign-in',
            },
            { status: 409 }
          );
        }
      } else if (reg.code === 'UPSTREAM_UNAVAILABLE') {
        if (requestId) authAttemptFail(`register:${requestId}`)
        return NextResponse.json(
          { ok: false, code: 'UPSTREAM_UNAVAILABLE', error: reg.error, retryable: true },
          { status: 503 }
        );
      } else if (reg.code === 'RATE_LIMITED') {
        return NextResponse.json(
          { ok: false, code: 'RATE_LIMITED', error: reg.error || 'Too many attempts — please wait a moment.', retryable: true },
          { status: 429 }
        );
      } else {
        if (requestId) authAttemptFail(`register:${requestId}`);
        return NextResponse.json(
          { ok: false, code: 'REGISTRATION_FAILED', error: reg.error || 'Registration failed. Please try again.' },
          { status: 400 }
        );
      }
    } else {
      // V4 legacy path — bounded circuit breaker, never minutes.
      if (!(await backendAcceptsWrites())) {
        if (requestId) authAttemptFail(`register:${requestId}`)
        return NextResponse.json(
          { ok: false, code: 'UPSTREAM_UNAVAILABLE', error: 'The auth service is briefly unavailable — please retry.', retryable: true },
          { status: 503 }
        );
      }
      const regResult = await registerByEmailPassword(displayName, normalizedEmail, password);
      if (regResult.ok && regResult.apiKey && regResult.userId) {
        accountUserId = regResult.userId;
        accountApiKey = regResult.apiKey;
        created = true;
      } else {
        if (requestId) authAttemptFail(`register:${requestId}`);
        const msg = regResult.error || 'Registration failed';
        const taken = /already registered|already exists/i.test(msg);
        return NextResponse.json(
          taken
            ? { ok: false, code: 'EMAIL_ALREADY_REGISTERED', error: 'An account with this email already exists. Please sign in instead.', hint: 'sign-in' }
            : { ok: false, code: 'REGISTRATION_FAILED', error: msg },
          { status: taken ? 409 : 400 }
        );
      }
    }

    // ─── 4. Profile (get-or-create; existing account keeps its profile) ──
    let profile = await getProfile(accountUserId!);
    if (!profile) {
      // Username uniqueness only matters for a NEW profile.
      const usernameTaken = await getProfileByUsername(normalizedUsername);
      if (usernameTaken && usernameTaken.userId !== accountUserId) {
        if (requestId) authAttemptFail(`register:${requestId}`);
        return NextResponse.json(
          { ok: false, code: 'USERNAME_TAKEN', error: 'This username is already taken. Please choose another.' },
          { status: 409 }
        );
      }
      const now = new Date().toISOString();
      profile = {
        userId: accountUserId!,
        username: normalizedUsername,
        displayName: displayName.trim(),
        avatar: avatar || '',
        bio: bio || '',
        email: normalizedEmail,
        apiKey: accountApiKey!,
        createdAt: now,
        updatedAt: now,
      } as Profile;
      const profileCreated = await upsertProfile(profile);
      if (!profileCreated) {
        console.warn('[register] profile pending (login will heal it):', accountUserId);
      }
    } else if (profile.apiKey !== accountApiKey) {
      profile.apiKey = accountApiKey!;
      await upsertProfile(profile);
    }

    // ─── 5. Record completion + session ────────────────────────────────────
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
      apiKey: accountApiKey!,
      isAdmin,
    };
    if (requestId) {
      authAttemptComplete(`register:${requestId}`, record);
      if (ONYXBASE_V5_ENABLED) {
        // Durable marker so ANY instance can recover this attempt.
        void v5PutAuthOpMarker('register', requestId, { ...record });
      }
    }
    // One-time use: the verification transaction that authorized this
    // account creation is consumed (a replay can only reach the sign-in
    // path above — never a second account).
    if (verifiedTransactionId) consumeRegistrationTransaction(verifiedTransactionId);
    authLog(request.headers.get('x-request-id'), 'account_creation', created ? 'created' : 'existing_signed_in', {
      email: normalizedEmail,
      verificationTx: verifiedTransactionId.slice(0, 8),
      created,
    });
    return await issueSessionResponse(record, created);
  } catch (err) {
    console.error('[register] error:', err);
    return NextResponse.json(
      { ok: false, code: 'UNKNOWN_ERROR', error: 'Registration failed. Please try again.' },
      { status: 500 }
    );
  }
}
