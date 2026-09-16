/**
 * Fast response contract for every RGE Hub API route (PRD §8, §20, §22).
 *
 * Success:
 *   { success: true, data: {...}, requestId, durationMs }
 * Accepted / background:
 *   { success: true, status: "processing", operationId, requestId }   (HTTP 202)
 * Failure:
 *   { success: false, error: { code, message }, requestId }
 *
 * Rules enforced here:
 *   - Every response carries a requestId and an `x-request-id` header.
 *   - Errors are machine-readable codes — NEVER a generic "server busy"
 *     for an operation that may have committed (PRD §22).
 *   - durationMs is measured from route start.
 *
 * OBSERVABILITY (PRD §20): responses log a single structured line with
 * requestId, route, method, status, durationMs. We never log OTPs,
 * passwords, API keys, or auth headers.
 */

import { NextResponse } from 'next/server';

export interface ApiMeta {
  requestId: string;
  durationMs: number;
}

export interface ApiErrorBody {
  success: false;
  error: { code: string; message: string; retryable?: boolean; retryAfterSecs?: number };
  requestId: string;
}

/** Stable, machine-readable error codes used across the app. */
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  OTP_STORAGE_UNAVAILABLE: 'OTP_STORAGE_UNAVAILABLE',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_INVALID: 'OTP_INVALID',
  OTP_NOT_FOUND: 'OTP_NOT_FOUND',
  OTP_ATTEMPTS_EXCEEDED: 'OTP_ATTEMPTS_EXCEEDED',
  EMAIL_SEND_FAILED: 'EMAIL_SEND_FAILED',
  EMAIL_SERVICE_TIMEOUT: 'EMAIL_SERVICE_TIMEOUT',
  RESET_TOKEN_INVALID: 'RESET_TOKEN_INVALID',
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  UPLOAD_FAILED: 'UPLOAD_FAILED',
  RESOURCE_NOT_VERIFIED: 'RESOURCE_NOT_VERIFIED',
  STORAGE_TIMEOUT: 'STORAGE_TIMEOUT',
  OPERATION_PENDING: 'OPERATION_PENDING',
  OPERATION_FAILED: 'OPERATION_FAILED',
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  UPSTREAM_UNAVAILABLE: 'UPSTREAM_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Redaction guard — scrub values that must never reach logs. */
const SECRET_KEY_RE = /(password|otp|apikey|api_key|secret|token|authorization|cookie)/i;
export function safeLogValue(key: string, value: unknown): unknown {
  if (SECRET_KEY_RE.test(key)) return '[redacted]';
  if (typeof value === 'string' && value.length > 300) return value.slice(0, 300) + '…';
  return value;
}

/** New request id (uuid v4 via crypto). */
export function newRequestId(): string {
  return crypto.randomUUID();
}

/** Build response headers common to every API response. */
function baseHeaders(requestId: string): Record<string, string> {
  return {
    'x-request-id': requestId,
    'Cache-Control': 'no-store',
  };
}

/** 200 — definitive success with the full result. */
export function ok(data: unknown, meta: ApiMeta, init: { status?: number } = {}) {
  return NextResponse.json(
    { success: true, data, requestId: meta.requestId, durationMs: meta.durationMs },
    { status: init.status ?? 200, headers: baseHeaders(meta.requestId) }
  );
}

/** 202 — accepted for background processing; client polls operationId. */
export function accepted(operationId: string, meta: ApiMeta, extra: Record<string, unknown> = {}) {
  return NextResponse.json(
    {
      success: true,
      status: 'processing' as const,
      operationId,
      requestId: meta.requestId,
      ...extra,
    },
    { status: 202, headers: baseHeaders(meta.requestId) }
  );
}

/** Failure with a machine-readable code. NEVER use "server busy" for committed work. */
export function fail(
  code: ErrorCode | string,
  message: string,
  meta: ApiMeta,
  init: { status?: number; retryable?: boolean; retryAfterSecs?: number } = {}
) {
  return NextResponse.json(
    {
      success: false,
      error: {
        code,
        message,
        ...(init.retryable !== undefined ? { retryable: init.retryable } : {}),
        ...(init.retryAfterSecs !== undefined ? { retryAfterSecs: init.retryAfterSecs } : {}),
      },
      requestId: meta.requestId,
    } satisfies ApiErrorBody,
    { status: init.status ?? 400, headers: baseHeaders(meta.requestId) }
  );
}

/**
 * Structured request log line (PRD §20). One line per request.
 * route/method/status/durationMs/requestId + optional context object
 * (values pass through safeLogValue redaction).
 */
export function logRequest(
  meta: ApiMeta,
  route: string,
  method: string,
  status: number,
  operation: string,
  context: Record<string, unknown> = {}
) {
  const safeCtx: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(context)) safeCtx[k] = safeLogValue(k, v);
  console.log(
    JSON.stringify({
      t: new Date().toISOString(),
      requestId: meta.requestId,
      route,
      method,
      status,
      durationMs: meta.durationMs,
      operation,
      ...safeCtx,
    })
  );
}

/**
 * Wrap a route handler with request-id + duration metadata.
 * Usage:
 *   export const POST = withMeta(async (req, meta) => ok({...}, meta));
 */
export function withMeta(
  handler: (req: Request, meta: ApiMeta) => Promise<NextResponse>
): (req: Request) => Promise<NextResponse> {
  return async (req: Request) => {
    const requestId = req.headers.get('x-request-id') || newRequestId();
    const t0 = Date.now();
    const meta: ApiMeta = { requestId, durationMs: 0 };
    try {
      const res = await handler(req, meta);
      meta.durationMs = Date.now() - t0;
      res.headers.set('x-request-id', requestId);
      return res;
    } catch (err) {
      meta.durationMs = Date.now() - t0;
      const msg = err instanceof Error ? err.message : String(err);
      // Stack traces can contain env-derived URLs; keep the message only.
      console.error(
        JSON.stringify({
          t: new Date().toISOString(),
          requestId,
          route: new URL(req.url).pathname,
          method: req.method,
          error: msg.slice(0, 300),
          durationMs: meta.durationMs,
        })
      );
      return fail(ERROR_CODES.INTERNAL_ERROR, 'Unexpected server error', meta, { status: 500 });
    }
  };
}
