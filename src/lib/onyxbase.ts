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

// ============ Core KV ============

/**
 * Set a key-value pair in a collection.
 */
export async function kvSet(key: string, value: any, collection: string = 'default'): Promise<boolean> {
  const res = await fetch(`${ONYXBASE_BASE_URL}/v1/set`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ONYXBASE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ key, value, collection }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('[OnyxBase] kvSet failed:', res.status, text);
    return false;
  }
  const data = await res.json();
  return data.ok === true;
}

/**
 * Get a value by key from a collection.
 */
export async function kvGet<T = any>(key: string, collection: string = 'default'): Promise<T | null> {
  const res = await fetch(`${ONYXBASE_BASE_URL}/v1/get/${encodeURIComponent(key)}?collection=${encodeURIComponent(collection)}`, {
    headers: { 'Authorization': `Bearer ${ONYXBASE_API_KEY}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (data.ok === false) return null;
  return data.value as T;
}

/**
 * Delete a key from a collection.
 */
export async function kvDelete(key: string, collection: string = 'default'): Promise<boolean> {
  const res = await fetch(`${ONYXBASE_BASE_URL}/v1/delete/${encodeURIComponent(key)}?collection=${encodeURIComponent(collection)}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${ONYXBASE_API_KEY}` },
  });
  if (!res.ok) return false;
  const data = await res.json();
  return data.ok === true;
}

/**
 * List all keys in a collection.
 */
export async function kvList(collection: string = 'default'): Promise<string[]> {
  const res = await fetch(`${ONYXBASE_BASE_URL}/v1/list?collection=${encodeURIComponent(collection)}`, {
    headers: { 'Authorization': `Bearer ${ONYXBASE_API_KEY}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.keys || [];
}

/**
 * Export all key-value pairs in a collection.
 */
export async function kvExport(collection: string = 'default'): Promise<Record<string, any>> {
  const res = await fetch(`${ONYXBASE_BASE_URL}/v1/export?collection=${encodeURIComponent(collection)}`, {
    headers: { 'Authorization': `Bearer ${ONYXBASE_API_KEY}` },
  });
  if (!res.ok) return {};
  const data = await res.json();
  return data.data || {};
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
 * Verify an OnyxBase user API key (returns user info).
 * This is used to verify user-provided keys during login.
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
