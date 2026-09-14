/**
 * Idempotency-Key support for mutations (PRD §7).
 *
 * Every mutation endpoint accepts an `Idempotency-Key` header
 * (client-generated UUID). If the same key arrives again:
 *   - completed  → the stored result is replayed (no duplicate execution)
 *   - in-flight  → HTTP 409 { status: "processing" } so the client waits
 *                  or polls the operation endpoint
 *
 * Layered defense:
 *   1. This in-memory replay store (per serverless instance, 24h TTL).
 *   2. Deterministic identifiers where the backend allows it — resource
 *      ids derive from the uploader's clientId (resources.ts), follow
 *      edges are one-record-per-relationship (rel:{a}:{b}) — so a retry
 *      against a DIFFERENT instance still converges to one record.
 *
 * Nothing sensitive is stored: results only, keyed by the client's UUID.
 */

import { NextResponse } from 'next/server';

const TTL_MS = 24 * 60 * 60 * 1000;

interface Entry {
  state: 'in_flight' | 'completed' | 'failed';
  status?: number;
  body?: unknown;
  createdAt: number;
}

const store = new Map<string, Entry>();

function sweep() {
  if (store.size < 512) return;
  const now = Date.now();
  for (const [k, v] of store) if (now - v.createdAt > TTL_MS) store.delete(k);
}

const KEY_RE = /^[A-Za-z0-9._-]{8,128}$/;

export function readIdempotencyKey(req: Request): string | null {
  const raw = req.headers.get('idempotency-key') || req.headers.get('x-idempotency-key');
  if (!raw || !KEY_RE.test(raw)) return null;
  return raw;
}

export interface IdempotentOutcome {
  /** A replay/409 response to return immediately, or null to execute. */
  preflightResponse: NextResponse | null;
  /** Call exactly once with the final response to cache it for replays. */
  complete: (status: number, body: unknown) => NextResponse;
  key: string;
}

/**
 * Begin an idempotent mutation. Returns a preflight response when the key
 * was already seen (replay or in-flight), plus a `complete()` that records
 * the outcome for future replays.
 *
 * Usage:
 *   const io = beginIdempotent(req, requestId);
 *   if (io.preflightResponse) return io.preflightResponse;
 *   ... do the work ...
 *   return io.complete(200, body);
 */
export function beginIdempotent(req: Request, requestId: string): IdempotentOutcome {
  const key = readIdempotencyKey(req);
  if (!key) {
    return {
      preflightResponse: null,
      complete: (status, body) => NextResponse.json(body, { status, headers: { 'x-request-id': requestId } }),
      key: '',
    };
  }
  sweep();
  const existing = store.get(key);
  if (existing) {
    if (existing.state === 'in_flight') {
      return {
        preflightResponse: NextResponse.json(
          {
            success: true,
            status: 'processing',
            message: 'The same request is already being processed.',
            requestId,
          },
          { status: 409, headers: { 'x-request-id': requestId, 'Idempotent-Replayed': 'true' } }
        ),
        complete: () => {
          throw new Error('complete() called on an in-flight replay');
        },
        key,
      };
    }
    // Completed (or failed) — replay the stored outcome verbatim.
    return {
      preflightResponse: NextResponse.json(existing.body, {
        status: existing.status,
        headers: {
          'x-request-id': requestId,
          'Idempotent-Replayed': 'true',
          'Idempotent-State': existing.state,
        },
      }),
      complete: () => {
        throw new Error('complete() called on a replay');
      },
      key,
    };
  }
  store.set(key, { state: 'in_flight', createdAt: Date.now() });
  let settled = false;
  return {
    preflightResponse: null,
    key,
    complete: (status, body) => {
      if (!settled) {
        settled = true;
        store.set(key, {
          state: status < 400 ? 'completed' : 'failed',
          status,
          body,
          createdAt: Date.now(),
        });
      }
      return NextResponse.json(body, { status, headers: { 'x-request-id': requestId } });
    },
  };
}
