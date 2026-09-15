/**
 * OnyxBase server-side client.
 *
 * SECURITY: This module MUST only be imported from server-side code
 * (API routes, server components, server actions). It never exposes
 * the master API key to the browser.
 *
 * OnyxBase is a Telegram-backed KV + file storage platform.
 * - KV: POST /v1/set, GET /v1/get/{key}, DELETE /v1/delete/{key}, GET /v1/list
 * - Collections namespace keys
 * - Files: POST /v1/files (multipart, ≤50MB), chunked upload for larger
 * - Email: POST /api/email/send via connected MCPEmail credential
 *
 * V5 MODE (env ONYXBASE_V5_URL, see docs/v5-contract.md in onyx-base):
 * when set, the hot data primitives route to the V5 REST surface —
 * authoritative SQLite commits (sub-10ms), Telegram as an ASYNC durability
 * mirror never in the request path. When unset, V4 behavior is
 * byte-identical (rollback safety).
 */

import crypto from 'crypto';

const ONYXBASE_BASE_URL = process.env.ONYXBASE_BASE_URL || 'https://onyxbase-phi.vercel.app';
const ONYXBASE_API_KEY = process.env.ONYXBASE_API_KEY || '';
const EMAIL_CREDENTIAL = process.env.ONYXBASE_EMAIL_CREDENTIAL || 'Email_Verification';

const ONYXBASE_V5_URL = (process.env.ONYXBASE_V5_URL || '').trim().replace(/\/+$/, '');
const V5_ENABLED = ONYXBASE_V5_URL !== '';

if (!ONYXBASE_API_KEY) {
  console.warn('[OnyxBase] ONYXBASE_API_KEY is not set. Server-side operations will fail.');
}

export const ONYXBASE_FILE_BASE = ONYXBASE_BASE_URL; // public file download at /f/{fileId}

// ============ Types ============

export interface OnyxRecord {
  key: string;
  value: any;
  type?: string;
  collection?: string;
  updatedAt?: string;
  createdAt?: string;
}

export interface OnyxFileMeta {
  fileId: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  label?: string;
  isPublic?: boolean;
  url?: string;
  createdAt?: string;
}

export interface OnyxUser {
  userId: string;
  name: string;
  email?: string;
  plan?: string;
}

// ============ OnyxBase V5 (instant architecture, docs/v5-contract.md) ============
//
// V5 client rules (client side of the frozen contract):
//   - Data endpoints authenticate with the SAME bearer key as V4
//     (ONYXBASE_API_KEY — seeded as the V5 'master' service account on
//     first boot).
//   - 10s timeout per call (V5 is fast; 10s is generous). Blob data PUTs
//     get 45s — they carry the actual bytes.
//   - ONE retry on transport errors, and only for idempotent operations
//     (kv upserts/deletes/reads, blob chunk re-PUT, re-finalize). Account
//     creation retries only when an Idempotency-Key is supplied (V5
//     replays the SAME account). Login and blob-create are never blindly
//     retried.
//   - Error bodies carry machine-readable codes — never a generic
//     "server busy".

const V5_TIMEOUT_MS = 10_000;
const V5_BLOB_DATA_TIMEOUT_MS = 45_000;

/** True when the fast V5 data path is active (env ONYXBASE_V5_URL). */
export const ONYXBASE_V5_ENABLED = V5_ENABLED;

/** Idempotency-Key charset (shared by the V4 lib and the V5 contract). */
const IDEM_KEY_RE = /^[A-Za-z0-9._-]{8,128}$/;

interface V5RequestInit {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: BodyInit;
}

interface V5Response {
  status: number;
  body: any;
  netError: string | null;
}

/**
 * Core V5 fetch: bearer auth, hard timeout, at most ONE transport retry
 * (idempotent calls only — opts.retries). HTTP statuses are returned
 * verbatim and never retried here, so callers can map codes precisely.
 * Never throws.
 */
async function v5Request(
  path: string,
  init: V5RequestInit = {},
  opts: { timeoutMs?: number; retries?: number } = {}
): Promise<V5Response> {
  const timeoutMs = opts.timeoutMs ?? V5_TIMEOUT_MS;
  const attempts = 1 + (opts.retries ?? 0);
  let lastErr = '';
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${ONYXBASE_V5_URL}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${ONYXBASE_API_KEY}`,
          ...(init.headers || {}),
        },
        body: init.body,
        signal: controller.signal,
      });
      const body = await res.json().catch(() => null);
      return { status: res.status, body, netError: null };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
    }
  }
  return { status: 0, body: null, netError: lastErr || 'network error' };
}

/**
 * Unwrap a V5 response body. The contract envelope is
 * {ok:true,data} | {ok:false,error,code,…} but endpoints also answer with
 * the raw payload shapes printed in the contract — accept both (the
 * `data` field wins when present).
 */
function v5Payload(body: any): any | null {
  if (!body || typeof body !== 'object' || body.ok === false) return null;
  if (body.data && typeof body.data === 'object' && !('ok' in body.data)) return body.data;
  return body;
}

/** Deterministic Idempotency-Key for kv writes (content hash, not a secret). */
function v5IdemKey(parts: string[]): string {
  return 'rge-' + crypto.createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32);
}

async function v5KvSet(
  key: string,
  value: any,
  collection: string,
  idemKey?: string
): Promise<boolean> {
  const idem = idemKey && IDEM_KEY_RE.test(idemKey) ? idemKey : v5IdemKey([collection, key, JSON.stringify(value ?? null)]);
  const r = await v5Request(
    `/api/v5/kv/${encodeURIComponent(key)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idem },
      body: JSON.stringify({ value: value ?? null, collection }),
    },
    { retries: 1 } // kv upserts are idempotent — one transport retry is safe
  );
  if (r.status !== 200) {
    console.warn(`[OnyxBaseV5] kvSet HTTP ${r.status} for key:`, key.slice(0, 80), r.netError || '');
    recordWrite(false);
    return false;
  }
  recordWrite(true);
  return r.body?.ok !== false; // 200 = committed (envelope or raw shape)
}

async function v5KvBatch(
  collection: string,
  items: Array<{ key: string; value: any }>
): Promise<boolean> {
  const r = await v5Request(
    '/api/v5/kv/batch',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collection, items }),
    },
    { retries: 1 } // single-tx upserts — safe to retry on transport errors
  );
  if (r.status !== 200) {
    console.warn(`[OnyxBaseV5] kvBatch HTTP ${r.status} for collection:`, collection, r.netError || '');
    return false;
  }
  return r.body?.ok !== false;
}

async function v5KvListPage(
  collection: string,
  limit: number,
  offset: number
): Promise<{ items: Array<{ key: string; value: any }>; hasMore: boolean } | null> {
  const r = await v5Request(
    `/api/v5/kv?collection=${encodeURIComponent(collection)}&limit=${limit}&offset=${offset}`,
    { method: 'GET' },
    { retries: 1 }
  );
  if (r.status !== 200) return null;
  const p = v5Payload(r.body);
  if (!p || !Array.isArray(p.items)) return null;
  return { items: p.items, hasMore: p.hasMore === true };
}

// ---- V5 accounts ----

export interface V5AccountResult {
  ok: boolean;
  userId?: string;
  apiKey?: string;
  name?: string;
  email?: string;
  /** 'EMAIL_TAKEN' | 'AUTH_INVALID_CREDENTIALS' | 'IDEMPOTENCY_IN_FLIGHT' | 'UPSTREAM_UNAVAILABLE' | 'VALIDATION_ERROR' | 'RATE_LIMITED' | 'UNKNOWN' */
  code?: string;
  error?: string;
}

/**
 * Create a V5 account. With an Idempotency-Key, a transport retry replays
 * the SAME account (fresh key) — without one, creation is never retried.
 */
export async function v5CreateAccount(
  name: string,
  email: string,
  password: string,
  idemKey?: string
): Promise<V5AccountResult> {
  if (!V5_ENABLED) return { ok: false, code: 'UNKNOWN', error: 'ONYXBASE_V5_URL is not set' };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const idem = idemKey && IDEM_KEY_RE.test(idemKey) ? idemKey : null;
  if (idem) headers['Idempotency-Key'] = idem;
  const r = await v5Request(
    '/api/v5/accounts',
    { method: 'POST', headers, body: JSON.stringify({ name, email, password }) },
    { retries: idem ? 1 : 0 }
  );
  if (r.status === 0 || r.status >= 500) {
    recordWrite(false);
    return { ok: false, code: 'UPSTREAM_UNAVAILABLE', error: 'Auth service is unreachable — please retry.' };
  }
  if (r.status === 200 || r.status === 201) {
    const p = v5Payload(r.body);
    if (p?.userId) {
      recordWrite(true);
      return { ok: true, userId: p.userId, apiKey: p.apiKey, name: p.name, email: p.email };
    }
    return { ok: false, code: 'UNKNOWN', error: r.body?.error || 'Account creation returned no user.' };
  }
  // Crisp 4xx proves the service is alive (mirrors backendAliveAfter).
  recordWrite(r.status !== 429);
  const code =
    typeof r.body?.code === 'string' && r.body.code
      ? r.body.code
      : r.status === 409
        ? 'EMAIL_TAKEN'
        : r.status === 429
          ? 'RATE_LIMITED'
          : 'UNKNOWN';
  return { ok: false, code, error: r.body?.error || `Account creation failed (HTTP ${r.status})` };
}

/** Login against V5. Mints a fresh key per call — never retried on transport errors. */
export async function v5LoginAccount(email: string, password: string): Promise<V5AccountResult> {
  if (!V5_ENABLED) return { ok: false, code: 'UNKNOWN', error: 'ONYXBASE_V5_URL is not set' };
  const r = await v5Request(
    '/api/v5/accounts/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    },
    { retries: 0 }
  );
  if (r.status === 0 || r.status >= 500) {
    recordWrite(false);
    return { ok: false, code: 'UPSTREAM_UNAVAILABLE', error: 'Auth service is unreachable — please retry.' };
  }
  if (r.status === 200) {
    const p = v5Payload(r.body);
    if (p?.userId) {
      recordWrite(true);
      return { ok: true, userId: p.userId, apiKey: p.apiKey, name: p.name, email: p.email };
    }
    return { ok: false, code: 'UNKNOWN', error: r.body?.error || 'Login returned no user.' };
  }
  recordWrite(r.status !== 429);
  const code =
    typeof r.body?.code === 'string' && r.body.code
      ? r.body.code
      : r.status === 401
        ? 'AUTH_INVALID_CREDENTIALS'
        : r.status === 429
          ? 'RATE_LIMITED'
          : 'UNKNOWN';
  return {
    ok: false,
    code,
    error: r.body?.error || (r.status === 401 ? 'Invalid email or password' : `Login failed (HTTP ${r.status})`),
  };
}

// ---- V5 operations + RGE auth-op recovery markers ----

export interface V5OperationRecord {
  id: string;
  status: 'processing' | 'completed' | 'failed';
  type: string;
  result?: any;
  error?: { code?: string; message?: string } | null;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Look up a V5 op by (type, idemKey) — authenticated with the master
 * bearer. 404 / transport errors → null (caller proceeds fresh).
 */
export async function v5LookupOperation(type: string, idemKey: string): Promise<V5OperationRecord | null> {
  if (!V5_ENABLED) return null;
  const r = await v5Request(
    '/api/v5/operations/lookup',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, idemKey }),
    },
    { retries: 1 } // pure read
  );
  if (r.status !== 200) return null;
  const p = v5Payload(r.body);
  if (!p || !p.id || !p.status) return null;
  return {
    id: p.id,
    status: p.status,
    type: p.type ?? type,
    result: p.result ?? null,
    error: p.error ?? null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/**
 * RGE auth-op recovery markers.
 *
 * The V5 contract only exposes operations LOOKUP publicly (the v5_ops
 * table is written by V5-internal flows — RGE Hub may NOT assume a
 * create-op endpoint). Register/login therefore record completion
 * markers in V5 KV (guaranteed available): collection
 * 'rge_ops_register' / 'rge_ops_login', key = requestId. Recovery checks
 * BOTH the kv marker (primary — always works) and operations/lookup
 * (secondary — hits when a V5-side op exists for the idem key).
 *
 * The marker holds the session-issuing fields (same trust model as the
 * profile records, which already store the user's apiKey in the same
 * master-key-scoped store). requestIds are unguessable client UUIDs.
 */
export type V5AuthOpKind = 'register' | 'login';

const V5_AUTH_OP_COLLECTIONS: Record<V5AuthOpKind, string> = {
  register: 'rge_ops_register',
  login: 'rge_ops_login',
};

export interface V5AuthOpMarker {
  userId: string;
  username: string;
  displayName: string;
  email?: string;
  avatar?: string;
  bio?: string;
  apiKey: string;
  isAdmin?: boolean;
  createdAt?: string;
}

export async function v5GetAuthOpMarker(kind: V5AuthOpKind, requestId: string): Promise<V5AuthOpMarker | null> {
  if (!V5_ENABLED) return null;
  const r = await v5Request(
    `/api/v5/kv/${encodeURIComponent(requestId)}?collection=${V5_AUTH_OP_COLLECTIONS[kind]}`,
    { method: 'GET' },
    { retries: 1 }
  );
  if (r.status !== 200) return null;
  const p = v5Payload(r.body);
  const v = p?.value;
  return v && typeof v === 'object' && typeof v.userId === 'string' ? (v as V5AuthOpMarker) : null;
}

export async function v5PutAuthOpMarker(
  kind: V5AuthOpKind,
  requestId: string,
  marker: V5AuthOpMarker
): Promise<boolean> {
  if (!V5_ENABLED) return false;
  return v5KvSet(requestId, marker, V5_AUTH_OP_COLLECTIONS[kind], `rgeop-${kind}-${requestId}`.slice(0, 128));
}

// ---- V5 blobs (file storage) ----

/**
 * Upload bytes through the V5 blob pipeline:
 *   POST /api/v5/blobs                      → {blobId, chunkSize, …}
 *   PUT  /api/v5/blobs/:id/data?chunk=0&total=1  (raw bytes, Content-Type)
 *   POST /api/v5/blobs/:id/finalize         → {status:'ready'|'finalizing'}
 *
 * fileId = blobId; the public URL is ${ONYXBASE_V5_URL}/f/{blobId}
 * (V4-compatible route shape). When finalize answers 'finalizing' the
 * blob IS committed (SQLite is authoritative) and only the async
 * Telegram mirror is pending: bounded status poll, then proceed — a
 * pending mirror is logged, never a false failure (the downstream
 * resource create + its 202/operationId reconciliation cover the rest).
 */
async function v5UploadBlob(
  file: File | Blob,
  fileName: string,
  mimeType: string
): Promise<UploadFileResult> {
  const timings = emptyTimings();
  const t0 = Date.now();
  const size = typeof file.size === 'number' ? file.size : 0;

  // --- init: reserve the blob (never retried — mints a new id) ---
  const tInit = Date.now();
  const init = await v5Request(
    '/api/v5/blobs',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: fileName, mimeType, size }),
    },
    { retries: 0 }
  );
  timings.upload_init_ms = Date.now() - tInit;
  const initP = init.status === 200 ? v5Payload(init.body) : null;
  const blobId = initP?.blobId;
  if (!blobId) {
    recordWrite(false);
    const throttled = init.status === 429 || init.body?.code === 'RATE_LIMITED';
    return {
      ok: false,
      code: throttled ? 'UPLOAD_THROTTLED' : 'UPLOAD_STORAGE_ERROR',
      throttled,
      error: init.body?.error || init.netError || `Blob init failed (HTTP ${init.status})`,
      timings,
    };
  }

  // --- transfer: raw bytes, single PUT (chunk 0 of 1) ---
  const tTransfer = Date.now();
  const bytes = Buffer.from(await file.arrayBuffer());
  const put = await v5Request(
    `/api/v5/blobs/${encodeURIComponent(blobId)}/data?chunk=0&total=1`,
    {
      method: 'PUT',
      headers: { 'Content-Type': mimeType || 'application/octet-stream' },
      body: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    },
    { timeoutMs: V5_BLOB_DATA_TIMEOUT_MS, retries: 1 } // re-PUT of the same chunk is safe
  );
  timings.transfer_ms += Date.now() - tTransfer;
  if (put.status !== 200) {
    recordWrite(false);
    const throttled = put.status === 429 || put.body?.code === 'RATE_LIMITED';
    return {
      ok: false,
      code: throttled ? 'UPLOAD_THROTTLED' : 'UPLOAD_STORAGE_ERROR',
      throttled,
      error: put.body?.error || put.netError || `Blob upload failed (HTTP ${put.status})`,
      timings,
    };
  }

  // --- finalize: local commit + async durability mirror ---
  const tFinal = Date.now();
  const fin = await v5Request(
    `/api/v5/blobs/${encodeURIComponent(blobId)}/finalize`,
    { method: 'POST' },
    { retries: 1 } // re-finalize of a ready blob answers ready again
  );
  const finP = fin.status === 200 ? v5Payload(fin.body) : null;
  let status = finP?.status;
  if (fin.status !== 200 || (status !== 'ready' && status !== 'finalizing')) {
    recordWrite(false);
    return {
      ok: false,
      code: 'UPLOAD_STORAGE_ERROR',
      throttled: false,
      error: fin.body?.error || fin.netError || `Blob finalize failed (HTTP ${fin.status})`,
      timings,
    };
  }
  if (status === 'finalizing') {
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const meta = await v5Request(
        `/api/v5/blobs/${encodeURIComponent(blobId)}`,
        { method: 'GET' },
        { retries: 1 }
      );
      status = meta.status === 200 ? v5Payload(meta.body)?.status : status;
      if (status === 'ready') break;
    }
    if (status !== 'ready') {
      console.warn('[OnyxBaseV5] blob committed, durability mirror still pending:', blobId);
    }
  }
  timings.storage_finalize_ms = Date.now() - tFinal;
  timings.total_upload_ms = Date.now() - t0;
  recordWrite(true);
  return {
    ok: true,
    file: {
      fileId: blobId,
      fileName,
      mimeType,
      size,
      isPublic: true,
      url: `${ONYXBASE_V5_URL}/f/${blobId}`,
    },
    timings,
  };
}

// ============ Core KV (hardened) ============

/**
 * fetch with a hard timeout. OnyxBase latency is erratic (0.4s–8s+ per
 * call, worse on cold shards), so one hung call must never stall a whole
 * request for 15s+. All KV primitives fail FAST (false/null/[]) and let
 * callers decide: retry (writes) or degrade (reads).
 */
async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs = 10000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Set a key-value pair — DURABLE write with retries. Returns true ONLY when
 * the backend confirms `durable: true` (verified Telegram pin).
 *
 * Flood discipline (learned the hard way): hammering through a throttle
 * ESCALATES it into a long ban. So: max 2 attempts, and when the backend
 * reports its own throttle (`throttle.retryAfterSecs`) we honor it
 * (capped at 12s per wait so a request never exceeds serverless limits).
 * Retries are idempotent (same key+value), so a landed-but-unconfirmed
 * write is harmless.
 */
export async function kvSet(key: string, value: any, collection: string = 'default'): Promise<boolean> {
  if (V5_ENABLED) return v5KvSet(key, value, collection);
  // SINGLE attempt: the backend answers <=21s (20s sync deadline +
  // overhead) or not at all — a second 22s attempt + nap stacked past the
  // 60s route budget into FUNCTION_INVOCATION_TIMEOUTs (proven live).
  // The user/app retry (fresh 60s budget) owns the retry now.
  let waitMs = 4000;
  for (let attempt = 0; attempt < 1; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, waitMs));
    try {
      const res = await fetchWithTimeout(
        `${ONYXBASE_BASE_URL}/v1/set`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${ONYXBASE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ key, value, collection }),
        },
        // BOUNDED: backend /v1/set normally answers in 3-12s. 22s × 2 attempts
        // + 12s honor-cap worst ≈ 56s — fails fast with a retryable error
        // instead of hanging the function into a 504 ("stuck at saving").
        22000
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.warn(`[OnyxBase] kvSet attempt ${attempt + 1} failed:`, res.status, text.slice(0, 120));
        continue;
      }
      const data = await res.json().catch(() => null);
      if (data?.ok === true && data?.durable === true) {
        recordWrite(true);
        return true;
      }
      const retryAfterSecs = Number(data?.throttle?.retryAfterSecs);
      waitMs = Number.isFinite(retryAfterSecs) && retryAfterSecs > 0 ? Math.min(retryAfterSecs, 12) * 1000 : 4000;
      console.warn(`[OnyxBase] kvSet attempt ${attempt + 1} not durable, retrying in ${waitMs}ms`);
    } catch (err) {
      console.warn(`[OnyxBase] kvSet attempt ${attempt + 1} error/timeout:`, err instanceof Error ? err.message : err);
    }
  }
  console.error('[OnyxBase] kvSet exhausted retries for key:', key.slice(0, 80));
  recordWrite(false);
  return false;
}
/**
 * Set multiple keys with a SINGLE backend manifest sync (one Telegram pin
 * for the whole batch) via the bulk-import endpoint. Multi-key writes that
 * go through kvSet one-by-one serialize on the backend's ~35s global pin
 * pacing (2 keys = 2 pins = 40s+ and a self-flood of full-manifest
 * uploads); this lands them together in ~6-12s.
 *
 * Retries: 2 attempts with a 40s wait (covers one pacing window). Same
 * account/collections as kvSet (master key) — keys are identical.
 */
export async function kvSetMulti(
  entries: Array<{ key: string; value: any; collection?: string }>
): Promise<boolean> {
  if (V5_ENABLED) {
    // One batch per collection (the endpoint is per-collection), chunked to
    // the 500-item contract limit — all batches commit or the call fails.
    const groups = new Map<string, Array<{ key: string; value: any }>>();
    for (const e of entries) {
      const c = e.collection || 'default';
      const g = groups.get(c) || [];
      g.push({ key: e.key, value: e.value });
      groups.set(c, g);
    }
    let allOk = true;
    for (const [c, items] of groups) {
      for (let i = 0; i < items.length && allOk; i += 500) {
        allOk = await v5KvBatch(c, items.slice(i, i + 500));
      }
    }
    if (!allOk) {
      console.error('[OnyxBaseV5] kvSetMulti failed for keys:', entries.map((e) => e.key.slice(0, 40)).join(','));
    }
    recordWrite(allOk);
    return allOk;
  }
  // SINGLE attempt (was 2x22s+8s=52s): must fit the 60s route budget
  // alongside reads+gates — the user/app retry owns the retry.
  for (let attempt = 0; attempt < 1; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 8000));
    try {
      const res = await fetchWithTimeout(
        `${ONYXBASE_BASE_URL}/api/dashboard/records/import`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${ONYXBASE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            records: entries.map((e) => ({
              key: e.key,
              value: e.value,
              collection: e.collection || 'default',
            })),
          }),
        },
        22000
      );
      if (!res.ok) {
        console.warn(`[OnyxBase] kvSetMulti attempt ${attempt + 1} failed:`, res.status);
        continue;
      }
      const data = await res.json().catch(() => null);
      if (data?.ok === true && data?.durable === true) {
        recordWrite(true);
        return true;
      }
      console.warn(`[OnyxBase] kvSetMulti attempt ${attempt + 1} not durable, retrying shortly`);
    } catch (err) {
      console.warn(`[OnyxBase] kvSetMulti attempt ${attempt + 1} error/timeout:`, err instanceof Error ? err.message : err);
    }
  }
  console.error('[OnyxBase] kvSetMulti exhausted retries for keys:', entries.map((e) => e.key.slice(0, 40)).join(','));
  recordWrite(false);
  return false;
}


export type KVReadStatus = 'found' | 'missing' | 'error';

export interface KVRead<T> {
  status: KVReadStatus;
  value: T | null;
}

/**
 * Get a value by key, distinguishing NOT-FOUND (404) from ERRORS
 * (timeout/network/500). Listings use this to tell rotted ghost keys
 * (safe to prune from our index) from transient failures (keep, retry later).
 */
export async function kvGetStatus<T = any>(
  key: string,
  collection: string = 'default'
): Promise<KVRead<T>> {
  if (V5_ENABLED) {
    const r = await v5Request(
      `/api/v5/kv/${encodeURIComponent(key)}?collection=${encodeURIComponent(collection)}`,
      { method: 'GET' },
      { retries: 1 }
    );
    if (r.status === 404) return { status: 'missing', value: null };
    if (r.status !== 200) return { status: 'error', value: null };
    const p = v5Payload(r.body);
    if (!p || p.value === undefined || p.value === null) {
      return { status: 'missing', value: null };
    }
    return { status: 'found', value: p.value as T };
  }
  try {
    const res = await fetchWithTimeout(
      `${ONYXBASE_BASE_URL}/v1/get/${encodeURIComponent(key)}?collection=${encodeURIComponent(collection)}`,
      {
        headers: { 'Authorization': `Bearer ${ONYXBASE_API_KEY}` },
      },
      10000
    );
    if (res.status === 404) return { status: 'missing', value: null };
    if (!res.ok) return { status: 'error', value: null };
    const data = await res.json().catch(() => null);
    if (!data || data.ok === false || data.value === undefined || data.value === null) {
      return { status: 'missing', value: null };
    }
    return { status: 'found', value: data.value as T };
  } catch {
    return { status: 'error', value: null };
  }
}

/**
 * Get a value by key from a collection. Never throws — null on missing/error.
 */
export async function kvGet<T = any>(key: string, collection: string = 'default'): Promise<T | null> {
  const r = await kvGetStatus<T>(key, collection);
  return r.status === 'found' ? r.value : null;
}

/**
 * Delete a key from a collection.
 */
export async function kvDelete(key: string, collection: string = 'default'): Promise<boolean> {
  if (V5_ENABLED) {
    const r = await v5Request(
      `/api/v5/kv/${encodeURIComponent(key)}?collection=${encodeURIComponent(collection)}`,
      { method: 'DELETE' },
      { retries: 1 } // idempotent tombstone delete
    );
    const p = r.status === 200 ? v5Payload(r.body) : null;
    const ok = !!p && (p.deleted === true || r.body?.ok === true);
    recordWrite(ok);
    return ok;
  }
  try {
    const res = await fetchWithTimeout(
      `${ONYXBASE_BASE_URL}/v1/delete/${encodeURIComponent(key)}?collection=${encodeURIComponent(collection)}`,
      {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${ONYXBASE_API_KEY}` },
      },
      22000
    );
    if (!res.ok) { recordWrite(res.status < 500 && res.status !== 429); return false; }
    const data = await res.json().catch(() => null);
    const _delOk = data?.ok === true;
    recordWrite(_delOk);
    return _delOk;
  } catch {
    recordWrite(false);
    return false;
  }
}

/**
 * Idempotent delete: 404 (already gone / rotted) counts as success.
 * Deleting a ghost must never surface an error to the user.
 */
export async function kvDeleteIdempotent(key: string, collection: string = 'default'): Promise<boolean> {
  if (V5_ENABLED) {
    // V5 deletes are idempotent tombstones; 404 (already gone) is success.
    const r = await v5Request(
      `/api/v5/kv/${encodeURIComponent(key)}?collection=${encodeURIComponent(collection)}`,
      { method: 'DELETE' },
      { retries: 1 }
    );
    if (r.status === 404) {
      recordWrite(true);
      return true;
    }
    const ok = r.status === 200 && r.body?.ok !== false;
    recordWrite(ok);
    return ok;
  }
  try {
    const res = await fetchWithTimeout(
      `${ONYXBASE_BASE_URL}/v1/delete/${encodeURIComponent(key)}?collection=${encodeURIComponent(collection)}`,
      {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${ONYXBASE_API_KEY}` },
      },
      22000
    );
    if (res.status === 404) { recordWrite(true); return true; }
    if (!res.ok) { recordWrite(res.status < 500 && res.status !== 429); return false; }
    const data = await res.json().catch(() => null);
    const _delOk2 = data?.ok === true;
    recordWrite(_delOk2);
    return _delOk2;
  } catch {
    recordWrite(false);
    return false;
  }
}

/**
 * QUORUM reads — the backend's replicas diverge (same key returns 200 on
 * one replica and 404 on another, seconds apart). A single GET is a coin
 * flip, so read N copies and accept ANY value found.
 *
 * Shape: sequential ROUNDS of 3 parallel reads (covers both random routing
 * and sticky-parallel routing), FIRST-HIT-WINS per round so stragglers
 * never stall a found value. Typical hit ≈ fastest replica (~0.5s).
 */
export async function kvGetQuorum<T = any>(
  key: string,
  collection: string = 'default',
  reads = 6
): Promise<T | null> {
  if (V5_ENABLED) {
    // One authoritative read — SQLite has no replica divergence to
    // quorum-read around.
    void reads;
    return kvGet<T>(key, collection);
  }
  const PER_ROUND = 3;
  const rounds = Math.max(1, Math.ceil(reads / PER_ROUND));
  for (let round = 0; round < rounds; round++) {
    const n = round === rounds - 1 ? reads - round * PER_ROUND : PER_ROUND;
    const jobs = Array.from({ length: n }, () => kvGetStatus<T>(key, collection));
    // First-hit-wins: resolve on the first found value, or null once every
    // copy in the round settled without a hit. (kvGetStatus never rejects.)
    const hit = await new Promise<T | null>((resolve) => {
      let settled = 0;
      jobs.forEach((j) =>
        j.then((r) => {
          if (r.status === 'found' && r.value !== null && r.value !== undefined) {
            resolve(r.value as T);
          } else if (++settled === jobs.length) {
            resolve(null);
          }
        })
      );
    });
    if (hit !== null) return hit;
    if (round < rounds - 1) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return null;
}

/**
 * Durable write (name kept for existing callers). Spread-copies were a
 * workaround for the backend's spray era; the backend now pins every
 * write durably, so ONE durable kvSet (with its own retries) is both
 * faster and kinder to Telegram rate limits than parallel copies
 * racing the same pin.
 */
export async function kvSetSpread(
  key: string,
  value: any,
  collection: string = 'default',
  copies = 3
): Promise<boolean> {
  void copies;
  return kvSet(key, value, collection);
}

/**
 * SPREAD delete — parallel idempotent deletes across replicas.
 * True unless every copy hit a transport error (404s count as success).
 */
export async function kvDeleteSpread(
  key: string,
  collection: string = 'default',
  copies = 5
): Promise<boolean> {
  if (V5_ENABLED) {
    // Spread redundancy is obsolete against authoritative SQLite.
    void copies;
    return kvDeleteIdempotent(key, collection);
  }
  const results = await Promise.all(
    Array.from({ length: copies }, () => kvDeleteIdempotent(key, collection))
  );
  return results.some(Boolean);
}

/**
 * List all keys in a collection. Never throws — [] on error.
 */
export async function kvList(collection: string = 'default'): Promise<string[]> {
  if (V5_ENABLED) {
    // Paginated scan (limit 1000, follow hasMore). V5 list keys arrive
    // BARE (no {collection}. prefix). Partial results on late-page
    // failure are strictly safer for the prune-style callers than [].
    const keys: string[] = [];
    let offset = 0;
    for (let page = 0; page < 100; page++) {
      const r = await v5KvListPage(collection, 1000, offset);
      if (!r) break;
      keys.push(...r.items.map((i) => i.key));
      if (!r.hasMore) break;
      offset += r.items.length;
    }
    return keys;
  }
  try {
    const res = await fetchWithTimeout(
      `${ONYXBASE_BASE_URL}/v1/list?collection=${encodeURIComponent(collection)}`,
      {
        headers: { 'Authorization': `Bearer ${ONYXBASE_API_KEY}` },
      },
      10000
    );
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    return data?.keys || [];
  } catch {
    return [];
  }
}

/**
 * Export all key-value pairs in a collection. SINGLE attempt, no sleeps —
 * sleep-cascades turned one slow backend into 15s+ responses. Never throws.
 */
/**
 * Export keys come back namespaced as `{collection}.{key}` — strip the
 * prefix to get the stored key. Unknown shapes pass through untouched.
 */
export function stripExportPrefix(key: string, collection: string): string {
  const prefix = `${collection}.`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}
export async function kvExport<T = any>(collection: string = 'default'): Promise<Record<string, T>> {
  if (V5_ENABLED) {
    // Paginated full scan (limit 1000 until !hasMore). Keys arrive BARE —
    // stripExportPrefix stays a no-op pass-through for them.
    const out: Record<string, T> = {};
    let offset = 0;
    for (let page = 0; page < 100; page++) {
      const r = await v5KvListPage(collection, 1000, offset);
      if (!r) break; // best-effort, same contract as V4's {} on error
      for (const it of r.items) out[it.key] = it.value as T;
      if (!r.hasMore) break;
      offset += r.items.length;
    }
    return out;
  }
  try {
    const res = await fetchWithTimeout(
      `${ONYXBASE_BASE_URL}/v1/export?collection=${encodeURIComponent(collection)}`,
      {
        headers: { 'Authorization': `Bearer ${ONYXBASE_API_KEY}` },
      },
      12000
    );
    if (!res.ok) return {};
    const data = await res.json().catch(() => null);
    return data?.data || {};
  } catch {
    return {};
  }
}

/**
 * Search keys in a collection (substring match).
 */
export async function kvSearch(collection: string, query: string): Promise<OnyxRecord[]> {
  const res = await fetchWithTimeout(
    `${ONYXBASE_BASE_URL}/api/v1/rpc/search`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ONYXBASE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ collection, query }),
    },
    15000
  );
  if (!res.ok) return [];
  const data = await res.json().catch(() => null);
  return data?.results || [];
}

/**
 * Count records in a collection.
 */
export async function kvCount(collection: string): Promise<number> {
  const res = await fetchWithTimeout(
    `${ONYXBASE_BASE_URL}/api/v1/rpc/count_records`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ONYXBASE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ collection }),
    },
    15000
  );
  if (!res.ok) return 0;
  const data = await res.json().catch(() => null);
  return data?.count || 0;
}

// ============ Collections ============

/**
 * Create a named collection.
 */
export async function createCollection(name: string): Promise<boolean> {
  const res = await fetch(`${ONYXBASE_BASE_URL}/v1/collections`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ONYXBASE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name }),
  });
  return res.ok;
}

/**
 * List all collections.
 */
export async function listCollections(): Promise<any[]> {
  const res = await fetch(`${ONYXBASE_BASE_URL}/v1/collections`, {
    headers: { 'Authorization': `Bearer ${ONYXBASE_API_KEY}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.collections || [];
}

// ============ Files ============

/**
 * Upload a file to OnyxBase storage (simple multipart, ≤50MB).
 * Returns file metadata including the public download URL.
 */
export async function uploadFile(
  file: File | Blob,
  fileName: string,
  mimeType: string,
  label?: string
): Promise<OnyxFileMeta | null> {
  if (V5_ENABLED) {
    // V5 blob pipeline (POST /api/v5/blobs → PUT data → finalize).
    // fileId = blobId; label is a V4 dashboard concept with no V5 equivalent.
    void label;
    const r = await v5UploadBlob(file, fileName, mimeType);
    return r.ok ? r.file : null;
  }
  const formData = new FormData();
  formData.append('file', file, fileName);
  if (label) formData.append('label', label);

  let lastError: Error | null = null;
  // SINGLE attempt, 45s cap (was 2x55s=110s — guaranteed route death):
  // fits the 60s route budget; the user/app retry owns the retry.
  for (let attempt = 0; attempt < 1; attempt++) {
    try {
      const res = await fetchWithTimeout(
        `${ONYXBASE_BASE_URL}/v1/files`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${ONYXBASE_API_KEY}` },
          body: formData,
        },
        45000
      );
      if (res.ok) {
        const data = await res.json();
        if (data.file) {
          recordWrite(true);
          return {
            ...data.file,
            url: `${ONYXBASE_BASE_URL}/f/${data.file.fileId}`,
          };
        }
      }
      const errText = await res.text();
      if (errText.includes('retry after') || res.status === 429 || res.status === 413) {
        // Extract retry seconds
        const match = errText.match(/retry after (\d+)/i);
        const wait = match ? Math.min(parseInt(match[1]), 10) : 5 * (attempt + 1);
        console.warn(`[OnyxBase] upload throttled, waiting ${wait}s (attempt ${attempt + 1})`);
        await new Promise(r => setTimeout(r, wait * 1000));
        lastError = new Error(errText);
        continue;
      }
      console.error('[OnyxBase] uploadFile failed:', res.status, errText);
      recordWrite(false);
      return null;
    } catch (err) {
      lastError = err as Error;
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  console.error('[OnyxBase] uploadFile exhausted retries:', lastError?.message);
  recordWrite(false);
  return null;
}

/**
 * Get file metadata.
 */
export async function getFileMeta(fileId: string): Promise<OnyxFileMeta | null> {
  if (V5_ENABLED) {
    const r = await v5Request(
      `/api/v5/blobs/${encodeURIComponent(fileId)}`,
      { method: 'GET' },
      { retries: 1 }
    );
    if (r.status !== 200) return null;
    const p = v5Payload(r.body);
    if (!p) return null;
    return {
      fileId: p.blobId || fileId,
      fileName: typeof p.filename === 'string' ? p.filename : undefined,
      mimeType: typeof p.mimeType === 'string' ? p.mimeType : undefined,
      size: typeof p.size === 'number' ? p.size : undefined,
      url: typeof p.publicUrl === 'string' && p.publicUrl ? p.publicUrl : getFileUrl(fileId),
      createdAt: p.createdAt,
    };
  }
  const res = await fetch(`${ONYXBASE_BASE_URL}/v1/files/${fileId}`, {
    headers: { 'Authorization': `Bearer ${ONYXBASE_API_KEY}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.file || null;
}

/**
 * Delete a file.
 */
export async function deleteFile(fileId: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(
      `${ONYXBASE_BASE_URL}/v1/files/${fileId}`,
      {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${ONYXBASE_API_KEY}` },
      },
      15000
    );
    recordWrite(res.ok || res.status === 404);
    return res.ok;
  } catch {
    recordWrite(false);
    return false;
  }
}

/**
 * Get the public download URL for a file.
 */
export function getFileUrl(fileId: string): string {
  // V5 mode: blobs are served from the V5 deployment's public /f/:blobId
  // route (V4-compatible shape); fileId IS the blobId.
  if (V5_ENABLED) return `${ONYXBASE_V5_URL}/f/${fileId}`;
  return `${ONYXBASE_BASE_URL}/f/${fileId}`;
}

// ============ Email ============

/**
 * Send an email via the connected MCPEmail credential.
 */
export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  htmlBody?: string
): Promise<{ ok: boolean; requestId?: string; error?: string }> {
  try {
    const payload: any = {
      credential: EMAIL_CREDENTIAL,
      to,
      subject,
      body,
    };
    if (htmlBody) payload.htmlBody = htmlBody;

    // BOUNDED: the email backend grinds under flood — fail fast with a clear
    // error instead of hanging the OTP request ("eternal OTP" into a 504).
    const res = await fetchWithTimeout(
      `${ONYXBASE_BASE_URL}/api/email/send`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ONYXBASE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
      20000
    );
    const data = await res.json().catch(() => null);
    if (!data) return { ok: false, error: 'Email service gave an empty response — please retry.' };
    if (data.ok || data.success) {
      return { ok: true, requestId: data.request_id };
    }
    return { ok: false, error: data.error || 'Email send failed' };
  } catch (err) {
    const msg = (err as Error).message || '';
    if ((err as Error).name === 'AbortError' || /abort/i.test(msg)) {
      return { ok: false, error: 'Auth service timed out — please retry.' };
    }
    return { ok: false, error: msg || 'Request failed — please retry.' };
  }
}

// ============ Auth ============

/**
 * Register a new OnyxBase account using email + password.
 * OnyxBase creates the account and returns an API key.
 * This does NOT require a master key — it's a public endpoint.
 *
 * Returns { ok, userId?, apiKey?, name?, email?, error? }
 */
export async function registerByEmailPassword(
  name: string,
  email: string,
  password: string
): Promise<{ ok: boolean; userId?: string; apiKey?: string; name?: string; email?: string; error?: string }> {
  try {
    // BOUNDED: fail fast under flood instead of hanging signup ("eternal").
    const res = await fetchWithTimeout(
      `${ONYXBASE_BASE_URL}/api/auth/register`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      },
      40000
    );
    const data = await res.json().catch(() => null);
    if (!data) { recordWrite(false); return { ok: false, error: 'Registration service gave an empty response — please retry.' }; }
    if (data.ok) {
      recordWrite(true);
      return {
        ok: true,
        userId: data.userId,
        apiKey: data.apiKey,
        name: data.name,
        email: data.email,
      };
    }
    const _regErr: string = data.error || 'Registration failed';
    recordWrite(backendAliveAfter(false, _regErr));
    return { ok: false, error: _regErr };
  } catch (err) {
    const msg = (err as Error).message || '';
    recordWrite(false);
    if ((err as Error).name === 'AbortError' || /abort/i.test(msg)) {
      return { ok: false, error: 'Auth service timed out — please retry.' };
    }
    return { ok: false, error: msg || 'Request failed — please retry.' };
  }
}

/**
 * Login to an existing OnyxBase account using email + password.
 * OnyxBase verifies credentials and returns the API key.
 * This does NOT require a master key — it's a public endpoint.
 *
 * Returns { ok, userId?, apiKey?, name?, email?, plan?, error? }
 */
export async function loginByEmailPassword(
  email: string,
  password: string
): Promise<{ ok: boolean; userId?: string; apiKey?: string; name?: string; email?: string; plan?: string; error?: string }> {
  try {
    // BOUNDED: fail fast under flood instead of hanging login ("eternal").
    const res = await fetchWithTimeout(
      `${ONYXBASE_BASE_URL}/api/auth/login`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      },
      40000
    );
    const data = await res.json().catch(() => null);
    if (!data) { recordWrite(false); return { ok: false, error: 'Login service gave an empty response — please retry.' }; }
    if (data.ok) {
      recordWrite(true);
      return {
        ok: true,
        userId: data.userId,
        apiKey: data.apiKey,
        name: data.name,
        email: data.email,
        plan: data.plan,
      };
    }
    const _logErr: string = data.error || 'Login failed';
    recordWrite(backendAliveAfter(false, _logErr));
    return { ok: false, error: _logErr };
  } catch (err) {
    const msg = (err as Error).message || '';
    recordWrite(false);
    if ((err as Error).name === 'AbortError' || /abort/i.test(msg)) {
      return { ok: false, error: 'Auth service timed out — please retry.' };
    }
    return { ok: false, error: msg || 'Request failed — please retry.' };
  }
}

/**
 * Verify an OnyxBase user API key (returns user info).
 * Used internally to validate keys.
 */
export async function verifyApiKey(apiKey: string): Promise<OnyxUser | null> {
  try {
    const res = await fetchWithTimeout(
      `${ONYXBASE_BASE_URL}/api/auth/verify`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      },
      15000
    );
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data) return null;
    if (data.ok === false) return null;
    return {
      userId: data.userId || data.user?.userId,
      name: data.name || data.user?.name || '',
      email: data.email || data.user?.email,
      plan: data.plan || data.user?.plan,
    };
  } catch {
    return null;
  }
}

/**
 * Get current user info from the master key.
 */
export async function whoami(): Promise<OnyxUser | null> {
  try {
    const res = await fetchWithTimeout(
      `${ONYXBASE_BASE_URL}/v1/whoami`,
      {
        headers: { 'Authorization': `Bearer ${ONYXBASE_API_KEY}` },
      },
      15000
    );
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data?.user || data || null;
  } catch {
    return null;
  }
}

export const ONYXBASE_COLLECTIONS = {
  PROFILES: 'profiles',
  IMAGES: 'editing_images',
  CLIPS: 'editing_clips',
  COMMUNITY_XMLS: 'community_xmls',
  ADMIN_XMLS: 'admin_xmls',
  OTPS: 'otps',
  SESSIONS: 'sessions',
  CATEGORIES: 'categories',
  FOLLOWS: 'follows',
  ADMINS: 'admins',
  ADMIN_ACTIVITY: 'admin_activity',
} as const;

// ============ Backend circuit breaker (Telegram 429-storm protection) ============
//
// The backend syncs every write to Telegram; when Telegram 429s, writes grind
// 45-220s server-side. Chains of such calls turned every auth/upload action
// into minutes of hanging ("eternal, then errors"). Instead:
//  - every backend WRITE records its outcome here (no extra network calls),
//  - routes check backendWriteReady() FIRST and fail in ~ms with a clear
//    "busy, retry" when recent writes are mostly failing,
//  - backendReadReady() adds a cheap cached probe for total wedges.
interface BreakerSample { at: number; ok: boolean }
const writeSamples: BreakerSample[] = [];
const BREAKER_WINDOW_MS = 60000;
const BREAKER_MIN_SAMPLES = 3;
const BREAKER_FAIL_RATIO = 0.6;

// Classify a backend mutation response for the write breaker. Transport
// failures and saturation errors (Telegram backup/flood/sync/timeout) count
// as failures; crisp client errors ("incorrect password", "already taken")
// prove the backend is ALIVE and count as success.
function backendAliveAfter(dataOk: boolean, errMsg: string): boolean {
  if (dataOk) return true;
  return !/backup|flood|sync[ .]|timed out|timeout|busy|empty response|failed|temporar|unavailable|network|retry/i.test(errMsg);
}
function recordWrite(ok: boolean): void {
  writeSamples.push({ at: Date.now(), ok });
  if (writeSamples.length > 20) writeSamples.splice(0, writeSamples.length - 20);
}

/** False when the backend is demonstrably drowning — callers should 503 fast. */
export function backendWriteReady(): boolean {
  const now = Date.now();
  const recent = writeSamples.filter((s) => now - s.at < BREAKER_WINDOW_MS);
  if (recent.length < BREAKER_MIN_SAMPLES) return true; // fail-open: not enough data
  const fails = recent.filter((s) => !s.ok).length;
  return fails < recent.length * BREAKER_FAIL_RATIO;
}

let readProbe = { at: 0, ok: false };
const READ_PROBE_TTL_MS = 10000;

/** Cheap cached read probe (whoami, 4s) — catches total backend wedges. */
export async function backendReadReady(): Promise<boolean> {
  const now = Date.now();
  if (now - readProbe.at < READ_PROBE_TTL_MS) return readProbe.ok;
  try {
    const res = await fetchWithTimeout(
      `${ONYXBASE_BASE_URL}/v1/whoami`,
      { headers: { 'Authorization': `Bearer ${ONYXBASE_API_KEY}` } },
      4000
    );
    readProbe = { at: now, ok: res.ok };
    return res.ok;
  } catch {
    readProbe = { at: now, ok: false };
    return false;
  }
}

/**
 * Combined gate for write routes: instant-false when the backend is known
 * bad (breaker) or currently unreachable (probe). Use at the top of every
 * route that writes to the backend, right after auth.
 */
export async function backendAcceptsWrites(): Promise<boolean> {
  if (!backendWriteReady()) return false;
  return backendReadReady();
}

// ============ Upload reliability (PRD: persistence & performance fix) ============

/** Max file size for a single-shot multipart upload (OnyxBase limit). */
export const MAX_SIMPLE_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Per-stage timing instrumentation for upload diagnostics (PRD §3). */
export interface UploadTimings {
  upload_init_ms: number;
  transfer_ms: number;
  storage_finalize_ms: number;
  total_upload_ms: number;
  attempts: number;
}

function emptyTimings(): UploadTimings {
  return {
    upload_init_ms: 0,
    transfer_ms: 0,
    storage_finalize_ms: 0,
    total_upload_ms: 0,
    attempts: 0,
  };
}

export type UploadFileResult =
  | { ok: true; file: OnyxFileMeta; timings: UploadTimings }
  | {
      ok: false;
      code: 'UPLOAD_STORAGE_ERROR' | 'UPLOAD_THROTTLED';
      throttled: boolean;
      retryAfterSecs?: number;
      error: string;
      timings: UploadTimings;
    };

/**
 * Upload a file to OnyxBase storage with structured results.
 *
 * Improvements over the legacy path:
 * - Returns a discriminated result (success vs throttled vs failed) so the
 *   API layer can answer 429 with a Retry-After instead of hanging ~60s.
 * - Caps any single backoff wait at 10s (Telegram flood-waits can otherwise
 *   stall one small upload for 50-60+ seconds).
 * - Emits per-stage timings for bottleneck diagnosis (PRD §3).
 */
export async function uploadFileResult(
  file: File | Blob,
  fileName: string,
  mimeType: string,
  label?: string
): Promise<UploadFileResult> {
  const timings = emptyTimings();
  const t0 = Date.now();

  // --- init: build the multipart payload (lightweight, no network) ---
  const tInit = Date.now();
  const formData = new FormData();
  formData.append('file', file, fileName);
  if (label) formData.append('label', label);
  timings.upload_init_ms = Date.now() - tInit;

  let lastError = 'Unknown upload error';
  // BOUNDED: SINGLE attempt x 45s fetch timeout (was 2x55s=110s — route
  // death). Fits the 60s route budget; the user/app retry owns the retry.
  const MAX_ATTEMPTS = 1;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    timings.attempts = attempt;
    const tTransfer = Date.now();
    try {
      const res = await fetchWithTimeout(
        `${ONYXBASE_BASE_URL}/v1/files`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${ONYXBASE_API_KEY}` },
          body: formData,
        },
        45000
      );
      timings.transfer_ms += Date.now() - tTransfer;

      if (res.ok) {
        const tFinalize = Date.now();
        const data = await res.json();
        timings.storage_finalize_ms = Date.now() - tFinalize;
        timings.total_upload_ms = Date.now() - t0;
        if (data.file) {
          recordWrite(true);
          return {
            ok: true,
            file: {
              ...data.file,
              url: `${ONYXBASE_BASE_URL}/f/${data.file.fileId}`,
            },
            timings,
          };
        }
        lastError = 'Storage returned no file reference';
      } else {
        const errText = await res.text().catch(() => `HTTP ${res.status}`);
        lastError = errText.slice(0, 300) || `HTTP ${res.status}`;
        const throttled =
          res.status === 429 || res.status === 413 || /retry after/i.test(errText);
        if (throttled) {
          const match = errText.match(/retry after (\d+)/i);
          const retryAfterSecs = match ? parseInt(match[1], 10) : 5 * attempt;
          console.warn(
            `[OnyxBase] upload throttled (attempt ${attempt}/${MAX_ATTEMPTS}), server asked retry after ${retryAfterSecs}s`
          );
          if (attempt < MAX_ATTEMPTS) {
            // Cap the wait so one small file can never hang ~60s (PRD §6, §40).
            const waitSecs = Math.min(retryAfterSecs, 10);
            await new Promise((r) => setTimeout(r, waitSecs * 1000));
            continue;
          }
          timings.total_upload_ms = Date.now() - t0;
          recordWrite(false);
          return {
            ok: false,
            code: 'UPLOAD_THROTTLED',
            throttled: true,
            retryAfterSecs,
            error: lastError,
            timings,
          };
        }
        console.error('[OnyxBase] uploadFile failed:', res.status, errText.slice(0, 300));
        timings.total_upload_ms = Date.now() - t0;
        recordWrite(false);
        return {
          ok: false,
          code: 'UPLOAD_STORAGE_ERROR',
          throttled: false,
          error: lastError,
          timings,
        };
      }
    } catch (err) {
      timings.transfer_ms += Date.now() - tTransfer;
      lastError = err instanceof Error ? err.message : 'Network error';
      console.warn(`[OnyxBase] upload network error (attempt ${attempt}/${MAX_ATTEMPTS}):`, lastError);
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
    }
  }

  timings.total_upload_ms = Date.now() - t0;
  console.error('[OnyxBase] uploadFile exhausted retries:', lastError);
  recordWrite(false);
  return {
    ok: false,
    code: 'UPLOAD_STORAGE_ERROR',
    throttled: false,
    error: lastError,
    timings,
  };
}

/**
 * Read a key with retries — used to verify read-your-write after kvSet
 * (OnyxBase is eventually consistent; an immediate read can return null).
 */
export async function kvGetWithRetry<T = any>(
  key: string,
  collection: string = 'default',
  opts: { retries?: number; baseDelayMs?: number } = {}
): Promise<{ value: T | null; attempts: number; ms: number }> {
  const retries = opts.retries ?? 5;
  const baseDelayMs = opts.baseDelayMs ?? 600;
  const t0 = Date.now();
  let value: T | null = null;
  let attempts = 0;
  for (let i = 0; i < retries; i++) {
    attempts = i + 1;
    value = await kvGet<T>(key, collection);
    if (value !== null && value !== undefined) break;
    if (i < retries - 1) {
      await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1)));
    }
  }
  return { value, attempts, ms: Date.now() - t0 };
}

/**
 * Two-phase persistent write: Phase 1 — durable kvSet (backend-verified
 * pin, with retries); Phase 2 — light quorum read-back. Only
 * { ok: true, verified: true } means the record is durable and readable.
 */
export async function kvSetVerified(
  key: string,
  value: any,
  collection: string = 'default',
): Promise<{ ok: boolean; verified: boolean; attempts: number; ms: number }> {
  const t0 = Date.now();
  const ok = await kvSet(key, value, collection);
  if (!ok) {
    return { ok: false, verified: false, attempts: 0, ms: Date.now() - t0 };
  }
  const readBack = await kvGetQuorum(key, collection, 3);
  return {
    ok: true,
    verified: readBack !== null && readBack !== undefined,
    attempts: 1,
    ms: Date.now() - t0,
  };
}
