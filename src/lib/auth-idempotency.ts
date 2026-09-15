/**
 * Auth-attempt registry: requestId → session-issuing fields.
 *
 * Register/login accept a client `requestId` (UUID, stable across the UI's
 * auto-retries; the Idempotency-Key header is an alias). Those routes can
 * outlive the client's timeout — the account commits server-side while the
 * response (and its session cookie) is lost. A retry with the SAME
 * requestId must RE-ISSUE the session, which requires the session-issuing
 * fields (including the backend apiKey — server-side only, NEVER in a
 * response body).
 *
 * WHY NOT src/lib/idempotency.ts: that lib replays the stored HTTP body
 * VERBATIM — a replayed register/login 200 would carry NO session cookie
 * (cookies are attached by createSession at response time), so a replay
 * could never actually sign the user in. This registry stores the fields
 * needed to mint a FRESH session instead. Same shape of guarantees:
 *   - completed  → recovery fields → the route re-creates the session
 *   - in_flight  → the route answers 202 {status:'processing', operationId}
 *   - failed     → entry cleared so a retry starts clean
 *   - TTL + cap  → bounded memory
 *
 * In-memory, per serverless instance (like the generic lib). V5 mode adds
 * DURABLE cross-instance recovery: kv markers (collections
 * 'rge_ops_register' / 'rge_ops_login') + V5 operations/lookup — see
 * src/lib/onyxbase.ts. The 202 processing response wraps an RGE operation
 * (src/lib/operations) so clients reconcile with the existing
 * awaitOperation() from src/lib/api-client.ts.
 */
import { NextResponse } from 'next/server';
import { createOperation, updateOperation } from './operations';
import { isAdminUser } from './session';
import {
  ONYXBASE_V5_ENABLED,
  v5GetAuthOpMarker,
  v5LookupOperation,
  type V5AuthOpKind,
  type V5AuthOpMarker,
} from './onyxbase';

export interface AuthRecoveryRecord {
  userId: string;
  username: string;
  displayName: string;
  email?: string;
  avatar?: string;
  bio?: string;
  apiKey: string;
  isAdmin: boolean;
}

interface Entry {
  state: 'in_flight' | 'completed';
  record?: AuthRecoveryRecord;
  createdAt: number;
}

const TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 500;
/** In-flight entries older than this are crash leftovers — reclaimable. */
const STALE_IN_FLIGHT_MS = 120 * 1000;

const store = new Map<string, Entry>();

function sweep() {
  if (store.size < MAX_ENTRIES) return;
  const now = Date.now();
  for (const [k, v] of store) {
    if (now - v.createdAt > TTL_MS) store.delete(k);
  }
}

/** requestId shape (same charset as the Idempotency-Key header). */
const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,128}$/;

/** Validate/normalize a client requestId (body field or header alias). */
export function normalizeRequestId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  return REQUEST_ID_RE.test(v) ? v : null;
}

/**
 * Begin an attempt. Returns the completed record when the same requestId
 * already succeeded (→ re-issue the session), or inFlight=true while it is
 * still executing (→ 202 processing). Otherwise the attempt is claimed as
 * in-flight and the caller proceeds with the fresh work.
 */
export function authAttemptBegin(key: string): { inFlight: boolean; recovery: AuthRecoveryRecord | null } {
  sweep();
  const existing = store.get(key);
  if (!existing) {
    store.set(key, { state: 'in_flight', createdAt: Date.now() });
    return { inFlight: false, recovery: null };
  }
  if (existing.state === 'in_flight') {
    if (Date.now() - existing.createdAt > STALE_IN_FLIGHT_MS) {
      // Crash leftover — reclaim the key for this attempt.
      store.set(key, { state: 'in_flight', createdAt: Date.now() });
      return { inFlight: false, recovery: null };
    }
    return { inFlight: true, recovery: null };
  }
  if (Date.now() - existing.createdAt > TTL_MS) {
    store.delete(key);
    store.set(key, { state: 'in_flight', createdAt: Date.now() });
    return { inFlight: false, recovery: null };
  }
  return { inFlight: false, recovery: existing.record ?? null };
}

/** Record a successful attempt so retries can re-issue the session. */
export function authAttemptComplete(key: string, record: AuthRecoveryRecord): void {
  store.set(key, { state: 'completed', record, createdAt: Date.now() });
  sweep();
}

/** Clear a failed attempt so the next retry starts clean. */
export function authAttemptFail(key: string): void {
  store.delete(key);
}

/** Non-claiming read (used by the 202 background resolution). */
export function authAttemptPeek(
  key: string
): { state: 'none' | 'in_flight' | 'completed'; record: AuthRecoveryRecord | null } {
  const e = store.get(key);
  if (!e) return { state: 'none', record: null };
  if (e.state === 'completed') return { state: 'completed', record: e.record ?? null };
  if (Date.now() - e.createdAt > STALE_IN_FLIGHT_MS) return { state: 'none', record: null };
  return { state: 'in_flight', record: null };
}

/** Map a durable V5 kv marker back onto session-issuing fields. */
export function authRecordFromV5Marker(m: V5AuthOpMarker): AuthRecoveryRecord {
  return {
    userId: m.userId,
    username: m.username,
    displayName: m.displayName,
    email: m.email,
    avatar: m.avatar,
    bio: m.bio,
    apiKey: m.apiKey,
    // Recomputed from verified identity only — never trust a stored flag.
    isAdmin: isAdminUser({ userId: m.userId, email: m.email, username: m.username }),
  };
}

// ---- 202 processing wrapper ----

/**
 * Answer 202 {ok:true, status:'processing', operationId} for an auth
 * attempt that is still executing (concurrent duplicate of the same
 * requestId, or a V5 op in flight). The operationId is an RGE operation
 * (src/lib/operations) the client can await with the EXISTING
 * awaitOperation(); a background watcher closes it once the attempt
 * settles (in-memory registry, V5 kv marker, or V5 op), bounded by
 * `deadlineMs`. NOTE: the session cookie itself can only be delivered by a
 * recovery re-POST (same requestId) — clients do exactly that after the
 * operation resolves.
 */
export function authProcessingResponse(
  kind: V5AuthOpKind,
  requestId: string,
  requestIdHeader: string
): NextResponse {
  const op = createOperation(`rge.auth.${kind}`, { requestId }, 'processing');
  const key = `${kind}:${requestId}`;
  const v5Type = `rge.auth.${kind}`;
  const deadline = Date.now() + (ONYXBASE_V5_ENABLED ? 20_000 : 45_000);

  const finish = (status: 'success' | 'failed', message?: string) => {
    if (status === 'success') {
      updateOperation(op.id, {
        status: 'success',
        result: { status: 'authenticated', recovered: true },
      });
    } else {
      updateOperation(op.id, {
        status: 'failed',
        error: {
          code: 'OPERATION_FAILED',
          message: message || 'The attempt did not complete — please retry.',
        },
      });
    }
  };

  const tick = async () => {
    const mem = authAttemptPeek(key);
    if (mem.state === 'completed') return finish('success');
    if (mem.state === 'none') {
      if (ONYXBASE_V5_ENABLED) {
        // Cross-instance: the durable marker may exist even when this
        // instance never saw the attempt complete.
        try {
          const marker = await v5GetAuthOpMarker(kind, requestId);
          if (marker) return finish('success');
          const v5op = await v5LookupOperation(v5Type, requestId);
          if (v5op?.status === 'completed') return finish('success');
        } catch {
          /* fall through to failed */
        }
      }
      return finish('failed');
    }
    if (Date.now() >= deadline) {
      return finish('failed', 'The attempt is still processing — please retry.');
    }
    setTimeout(() => {
      void tick();
    }, 1500);
  };

  try {
    void import('next/server').then(({ after }) => {
      if (typeof after === 'function') after(() => void tick());
      else void tick();
    });
  } catch {
    void tick();
  }

  return NextResponse.json(
    { ok: true, status: 'processing', operationId: op.id },
    { status: 202, headers: { 'x-request-id': requestIdHeader } }
  );
}
