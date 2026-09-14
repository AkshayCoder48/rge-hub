'use client';

/**
 * RGE Hub frontend request manager (PRD §30–§33, OnyxBase PRD §30–§33).
 *
 * THE rule this module enforces:
 *   A timeout or lost response is NEVER proof that the operation failed.
 *
 * Every request gets:
 *   - a requestId (x-request-id) for correlation
 *   - an Idempotency-Key for mutations (server replays results)
 *   - a bounded, operation-appropriate timeout (NOT 55–65s hangs)
 *   - normalized errors { code, message, retryable }
 *
 * Mutations that return 202 { operationId } are reconciled by polling
 * /api/operations/[id] — the UI shows "Verifying…" instead of a false
 * failure while the backend finishes (PRD §36).
 */

export interface ApiError {
  code: string;
  message: string;
  retryable?: boolean;
  retryAfterSecs?: number;
  status?: number;
  requestId?: string;
}

export class ApiClientError extends Error implements ApiError {
  code: string;
  retryable?: boolean;
  retryAfterSecs?: number;
  status?: number;
  requestId?: string;
  constructor(e: ApiError) {
    super(e.message);
    this.name = 'ApiClientError';
    this.code = e.code;
    this.retryable = e.retryable;
    this.retryAfterSecs = e.retryAfterSecs;
    this.status = e.status;
    this.requestId = e.requestId;
  }
}

export interface ApiResult<T = unknown> {
  success: boolean;
  data: T | null;
  /** Present when the server accepted the work for background processing. */
  operationId?: string;
  processing: boolean;
  requestId?: string;
  durationMs?: number;
  error?: ApiError;
}

/** Differentiated timeout policy (PRD §17) — no more 2-minute hangs. */
export const TIMEOUTS = {
  normal: 15_000, // profile, follows, lists, otp
  auth: 20_000, // login/register/verify (includes one email round-trip worst case)
  otpSend: 25_000, // includes email provider acknowledgement
  uploadInit: 15_000, // upload session / create-record calls
  operationPoll: 10_000, // status polls
} as const;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
  /** Provide to reuse an idempotency key across retries of one user action. */
  idempotencyKey?: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Stable key for one user action (survives component re-renders via caller). */
export function newIdempotencyKey(): string {
  return newId().replace(/-/g, '');
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<ApiResult<T>> {
  const method = opts.method ?? 'GET';
  const isMutation = method !== 'GET';
  const requestId = newId();
  const idempotencyKey = opts.idempotencyKey ?? (isMutation ? newIdempotencyKey() : undefined);

  const headers: Record<string, string> = {
    'x-request-id': requestId,
    ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    ...(opts.headers ?? {}),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? TIMEOUTS.normal);
  if (opts.signal) {
    opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    // New contract shape
    if (json && typeof json.success === 'boolean') {
      if (json.success) {
        if (res.status === 202 || json.status === 'processing') {
          return {
            success: true,
            data: null,
            processing: true,
            operationId: json.operationId,
            requestId: json.requestId,
          };
        }
        return {
          success: true,
          data: (json.data ?? json) as T,
          processing: false,
          requestId: json.requestId,
          durationMs: json.durationMs,
        };
      }
      return {
        success: false,
        data: null,
        processing: false,
        error: {
          ...(json.error ?? {}),
          status: res.status,
          requestId: json.requestId,
        },
      };
    }

    // Legacy contract shape ({ ok: boolean, ... }) — normalize.
    if (json && typeof json.ok === 'boolean') {
      if (json.ok) {
        const { ok: _ok, ...data } = json;
        return { success: true, data: data as T, processing: false };
      }
      const retryable = json.retryable === true;
      return {
        success: false,
        data: null,
        processing: false,
        error: {
          code: retryable ? 'UPSTREAM_UNAVAILABLE' : 'REQUEST_FAILED',
          message: json.error || 'Request failed',
          retryable,
          status: res.status,
        },
      };
    }

    return {
      success: false,
      data: null,
      processing: false,
      error: {
        code: res.status >= 500 ? 'UPSTREAM_UNAVAILABLE' : 'REQUEST_FAILED',
        message: `Unexpected response (HTTP ${res.status})`,
        retryable: res.status >= 500 || res.status === 429,
        status: res.status,
      },
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      // THE critical distinction (PRD §22 / OnyxBase PRD §41):
      // a client timeout means the OUTCOME IS UNKNOWN — never "failed".
      return {
        success: false,
        data: null,
        processing: false,
        error: {
          code: 'REQUEST_TIMEOUT',
          message:
            'The request is taking longer than expected. It may still complete — check status before retrying.',
          retryable: false,
          status: 0,
        },
      };
    }
    return {
      success: false,
      data: null,
      processing: false,
      error: {
        code: 'NETWORK_ERROR',
        message: 'Network error — check your connection.',
        retryable: true,
        status: 0,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

export interface OperationState {
  operationId: string;
  status: 'queued' | 'processing' | 'success' | 'failed';
  result?: unknown;
  error?: { code: string; message: string };
}

/** Poll an operation until it reaches a terminal state (or gives up). */
export async function awaitOperation(
  operationId: string,
  opts: { maxAttempts?: number; intervalMs?: number } = {}
): Promise<OperationState | null> {
  const maxAttempts = opts.maxAttempts ?? 6;
  const intervalMs = opts.intervalMs ?? 2000;
  for (let i = 0; i < maxAttempts; i++) {
    const res = await api<any>(`/api/operations/${operationId}`, { timeoutMs: TIMEOUTS.operationPoll });
    if (res.success && res.data) {
      const st = res.data.status ?? res.data.data?.status;
      const d = res.data.data ?? res.data;
      if (st === 'success' || st === 'failed') {
        return {
          operationId,
          status: st,
          result: d.result ?? d.data?.result ?? d,
          error: d.error ?? d.data?.error,
        };
      }
      if (st === 'queued' || st === 'processing') {
        if (i < maxAttempts - 1) await new Promise((r) => setTimeout(r, intervalMs));
        continue;
      }
    }
    if (i < maxAttempts - 1) await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null; // unknown — treat as VERIFYING, never as failure
}

/**
 * High-level mutation helper: run a mutation; if it returns 202 or times
 * out with an operation id known from a prior attempt, reconcile through
 * the operations endpoint. Retries only when the server says retryable.
 */
export async function mutate<T = unknown>(
  path: string,
  body: unknown,
  opts: RequestOptions & { reconcileOperationId?: string } = {}
): Promise<ApiResult<T>> {
  const idempotencyKey = opts.idempotencyKey ?? newIdempotencyKey();
  const res = await api<T>(path, { ...opts, method: opts.method ?? 'POST', body, idempotencyKey });
  if (res.processing && res.operationId) {
    const final = await awaitOperation(res.operationId);
    if (final) {
      if (final.status === 'success') {
        return { success: true, data: (final.result as T) ?? null, processing: false };
      }
      if (final.status === 'failed') {
        return {
          success: false,
          data: null,
          processing: false,
          error: final.error ?? { code: 'OPERATION_FAILED', message: 'The operation failed.' },
        };
      }
    }
    return res; // still processing — caller shows a pending state, NOT an error
  }
  if (!res.success && res.error?.code === 'REQUEST_TIMEOUT' && opts.reconcileOperationId) {
    // Lost response after a 202 — reconcile instead of failing (PRD §22).
    const final = await awaitOperation(opts.reconcileOperationId, { maxAttempts: 4 });
    if (final?.status === 'success') {
      return { success: true, data: (final.result as T) ?? null, processing: false };
    }
  }
  return res;
}
