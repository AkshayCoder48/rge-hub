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
 */

const ONYXBASE_BASE_URL = process.env.ONYXBASE_BASE_URL || 'https://onyxbase-phi.vercel.app';
const ONYXBASE_API_KEY = process.env.ONYXBASE_API_KEY || '';
const EMAIL_CREDENTIAL = process.env.ONYXBASE_EMAIL_CREDENTIAL || 'Email_Verification';

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
 * Set a key-value pair in a collection.
 */
export async function kvSet(key: string, value: any, collection: string = 'default'): Promise<boolean> {
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
      15000
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[OnyxBase] kvSet failed:', res.status, text.slice(0, 200));
      return false;
    }
    const data = await res.json().catch(() => null);
    return data?.ok === true;
  } catch (err) {
    console.error('[OnyxBase] kvSet error/timeout:', err instanceof Error ? err.message : err);
    return false;
  }
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
  try {
    const res = await fetchWithTimeout(
      `${ONYXBASE_BASE_URL}/v1/delete/${encodeURIComponent(key)}?collection=${encodeURIComponent(collection)}`,
      {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${ONYXBASE_API_KEY}` },
      },
      10000
    );
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    return data?.ok === true;
  } catch {
    return false;
  }
}

/**
 * Idempotent delete: 404 (already gone / rotted) counts as success.
 * Deleting a ghost must never surface an error to the user.
 */
export async function kvDeleteIdempotent(key: string, collection: string = 'default'): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(
      `${ONYXBASE_BASE_URL}/v1/delete/${encodeURIComponent(key)}?collection=${encodeURIComponent(collection)}`,
      {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${ONYXBASE_API_KEY}` },
      },
      10000
    );
    if (res.status === 404) return true;
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    return data?.ok === true;
  } catch {
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
 * SPREAD writes — PARALLEL SETs so copies land on different backend
 * instances. Proven: the backend sprays parallel requests across
 * per-instance memory (4 parallel SETs → all-200, then all-404 from a
 * fresh reader), so parallel copies maximize the number of instances
 * holding the value — exactly what quorum reads then exploit.
 * True if ANY copy landed.
 */
export async function kvSetSpread(
  key: string,
  value: any,
  collection: string = 'default',
  copies = 3
): Promise<boolean> {
  const results = await Promise.all(
    Array.from({ length: copies }, () => kvSet(key, value, collection))
  );
  return results.some(Boolean);
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
  const results = await Promise.all(
    Array.from({ length: copies }, () => kvDeleteIdempotent(key, collection))
  );
  return results.some(Boolean);
}

/**
 * List all keys in a collection. Never throws — [] on error.
 */
export async function kvList(collection: string = 'default'): Promise<string[]> {
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
export async function kvExport(collection: string = 'default'): Promise<Record<string, any>> {
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
  const res = await fetch(`${ONYXBASE_BASE_URL}/api/v1/rpc/search`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ONYXBASE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ collection, query }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.results || [];
}

/**
 * Count records in a collection.
 */
export async function kvCount(collection: string): Promise<number> {
  const res = await fetch(`${ONYXBASE_BASE_URL}/api/v1/rpc/count_records`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ONYXBASE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ collection }),
  });
  if (!res.ok) return 0;
  const data = await res.json();
  return data.count || 0;
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
  const formData = new FormData();
  formData.append('file', file, fileName);
  if (label) formData.append('label', label);

  let lastError: Error | null = null;
  // Retry with backoff for Telegram rate limits
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${ONYXBASE_BASE_URL}/v1/files`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ONYXBASE_API_KEY}` },
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        if (data.file) {
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
        const wait = match ? parseInt(match[1]) : 5 * (attempt + 1);
        console.warn(`[OnyxBase] upload throttled, waiting ${wait}s (attempt ${attempt + 1})`);
        await new Promise(r => setTimeout(r, wait * 1000));
        lastError = new Error(errText);
        continue;
      }
      console.error('[OnyxBase] uploadFile failed:', res.status, errText);
      return null;
    } catch (err) {
      lastError = err as Error;
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  console.error('[OnyxBase] uploadFile exhausted retries:', lastError?.message);
  return null;
}

/**
 * Get file metadata.
 */
export async function getFileMeta(fileId: string): Promise<OnyxFileMeta | null> {
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
  const res = await fetch(`${ONYXBASE_BASE_URL}/v1/files/${fileId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${ONYXBASE_API_KEY}` },
  });
  return res.ok;
}

/**
 * Get the public download URL for a file.
 */
export function getFileUrl(fileId: string): string {
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

    const res = await fetch(`${ONYXBASE_BASE_URL}/api/email/send`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ONYXBASE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.ok || data.success) {
      return { ok: true, requestId: data.request_id };
    }
    return { ok: false, error: data.error || 'Email send failed' };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
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
    const res = await fetch(`${ONYXBASE_BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await res.json();
    if (data.ok) {
      return {
        ok: true,
        userId: data.userId,
        apiKey: data.apiKey,
        name: data.name,
        email: data.email,
      };
    }
    return { ok: false, error: data.error || 'Registration failed' };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
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
    const res = await fetch(`${ONYXBASE_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (data.ok) {
      return {
        ok: true,
        userId: data.userId,
        apiKey: data.apiKey,
        name: data.name,
        email: data.email,
        plan: data.plan,
      };
    }
    return { ok: false, error: data.error || 'Login failed' };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Verify an OnyxBase user API key (returns user info).
 * Used internally to validate keys.
 */
export async function verifyApiKey(apiKey: string): Promise<OnyxUser | null> {
  try {
    const res = await fetch(`${ONYXBASE_BASE_URL}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });
    if (!res.ok) return null;
    const data = await res.json();
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
  const res = await fetch(`${ONYXBASE_BASE_URL}/v1/whoami`, {
    headers: { 'Authorization': `Bearer ${ONYXBASE_API_KEY}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.user || data;
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
} as const;

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
  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    timings.attempts = attempt;
    const tTransfer = Date.now();
    try {
      const res = await fetch(`${ONYXBASE_BASE_URL}/v1/files`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ONYXBASE_API_KEY}` },
        body: formData,
      });
      timings.transfer_ms += Date.now() - tTransfer;

      if (res.ok) {
        const tFinalize = Date.now();
        const data = await res.json();
        timings.storage_finalize_ms = Date.now() - tFinalize;
        timings.total_upload_ms = Date.now() - t0;
        if (data.file) {
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
 * Two-phase persistent write (PRD §9, §14):
 * Phase 1 — spread write (copies across replicas); Phase 2 — quorum
 * read-back (any replica). Sequential retries are useless against divergent
 * replicas, so verification is ONE parallel wave, not a sleep cascade.
 * Only { ok: true, verified: true } means the record is durable and readable.
 */
export async function kvSetVerified(
  key: string,
  value: any,
  collection: string = 'default',
): Promise<{ ok: boolean; verified: boolean; attempts: number; ms: number }> {
  const t0 = Date.now();
  const ok = await kvSetSpread(key, value, collection, 3);
  if (!ok) {
    return { ok: false, verified: false, attempts: 0, ms: Date.now() - t0 };
  }
  const readBack = await kvGetQuorum(key, collection, 5);
  return {
    ok: true,
    verified: readBack !== null && readBack !== undefined,
    attempts: 1,
    ms: Date.now() - t0,
  };
}
