/**
 * qu.ax permanent file storage (server-side relay).
 *
 * qu.ax is free, needs no signup, and keeps files with NO expiry timer
 * (`expiry=-1` → `"expires":null`). Limits: 256MB per file + an extension
 * allowlist (no mkv/avi/xml/apk/…). qu.ax sends no CORS headers, so uploads
 * are relayed hub-side (small: single POST; large: chunked staging, then one
 * POST here). OnyxBase stores only the resulting URLs (never bytes/base64).
 *
 * Verified live (Sep 2026, byte-identical roundtrips incl. 60MB):
 *   POST https://qu.ax/upload  (multipart: files[], expiry=-1)
 *     -> {"success":true,"files":[{"url":"https://qu.ax/{name}","expires":null,…}]}
 * Viewer page:  https://qu.ax/{name}
 * Direct bytes: https://qu.ax/x/{name}.{ext}  (requires ANY Referer header —
 *   browsers send one, so embeds + downloads work; bare curl gets a 302)
 * Over 256MB: clean HTTP 413. Wrong type: {"success":false,"message":"file type is not allowed"}.
 *
 * TOS honesty: "permanent" is best-effort — files never ACCESSED for a very
 * long time may be pruned. The keep-alive cron pings these URLs (see
 * /api/cron/keepalive) so nothing goes cold.
 */

export const QUAX_BASE = 'https://qu.ax';
export const QUAX_MAX_BYTES = 256 * 1024 * 1024;

/** Extension allowlist (lowercase, no dot) — anything else is rejected by qu.ax. */
const QUAX_EXTS = new Set([
  // video
  'mp4', 'mov', 'wmv', 'mpeg', 'mpg', 'webm',
  // images
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg',
  // files
  'zip', 'rar', '7z', 'tar', 'gz', 'pdf', 'txt',
]);

export function quaxExtOf(fileName: string): string {
  const m = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

/** True when qu.ax will accept this file (type + size). */
export function isQuaxEligible(fileName: string, size: number): boolean {
  if (!size || size <= 0 || size > QUAX_MAX_BYTES) return false;
  return QUAX_EXTS.has(quaxExtOf(fileName));
}

export interface QuaxStoreResult {
  ok: boolean;
  /** Viewer/share page, e.g. https://qu.ax/aEu4b */
  viewerUrl?: string;
  /** Direct bytes URL, e.g. https://qu.ax/x/aEu4b.mp4 */
  directUrl?: string;
  /** Short name (aEu4b) — stored as ext:quax:{name} */
  name?: string;
  expiresNull?: boolean;
  error?: string;
}

/** Build the direct-bytes URL from a viewer URL (or short name) + extension. */
export function quaxDirectUrl(viewerUrlOrName: string, ext: string): string {
  const cleanExt = ext.toLowerCase().replace(/^\./, '');
  let name = viewerUrlOrName;
  const m = viewerUrlOrName.match(/qu\.ax\/([A-Za-z0-9]+)\/?$/);
  if (m) name = m[1];
  return `${QUAX_BASE}/x/${name}.${cleanExt}`;
}

export function isQuaxUrl(url: string | undefined | null): boolean {
  if (!url || typeof url !== 'string') return false;
  try {
    return new URL(url).hostname === 'qu.ax';
  } catch {
    return false;
  }
}

/**
 * Store bytes on qu.ax permanently (single POST, multipart).
 * Returns URL-only references — the caller stores those, never the bytes.
 */
export async function storeQuax(
  bytes: Buffer,
  fileName: string,
  mimeType: string,
  timeoutMs = 55000
): Promise<QuaxStoreResult> {
  if (!isQuaxEligible(fileName, bytes.length)) {
    const ext = quaxExtOf(fileName);
    return {
      ok: false,
      error:
        bytes.length > QUAX_MAX_BYTES
          ? `File is ${(bytes.length / 1024 / 1024).toFixed(0)}MB — qu.ax limit is 256MB.`
          : `“.${ext || '?'}” files aren't accepted by qu.ax.`,
    };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const form = new FormData();
    form.append('files[]', new Blob([new Uint8Array(bytes)], { type: mimeType }), fileName);
    form.append('expiry', '-1'); // permanent (expires:null)
    const res = await fetch(`${QUAX_BASE}/upload`, {
      method: 'POST',
      body: form,
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (RGE-Hub)' },
    });
    clearTimeout(timer);
    const data = (await res.json().catch(() => null)) as {
      success?: unknown;
      message?: unknown;
      files?: Array<{ url?: unknown; expires?: unknown }>;
    } | null;
    if (!res.ok || !data || data.success !== true) {
      const msg = typeof data?.message === 'string' ? data.message : `HTTP ${res.status}`;
      return { ok: false, error: `qu.ax rejected the upload (${msg}).` };
    }
    const file = data.files?.[0];
    const viewerUrl = typeof file?.url === 'string' ? file.url : '';
    if (!viewerUrl.startsWith('https://qu.ax/')) {
      return { ok: false, error: 'qu.ax returned an unexpected response.' };
    }
    const m = viewerUrl.match(/qu\.ax\/([A-Za-z0-9]+)\/?$/);
    const name = m ? m[1] : viewerUrl;
    return {
      ok: true,
      viewerUrl,
      directUrl: quaxDirectUrl(name, quaxExtOf(fileName)),
      name,
      expiresNull: file?.expires === null,
    };
  } catch (err) {
    clearTimeout(timer);
    const timedOut = (err as Error)?.name === 'AbortError';
    return {
      ok: false,
      error: timedOut ? 'qu.ax upload timed out — please retry.' : 'qu.ax upload failed — please retry.',
    };
  }
}

/**
 * Keep a qu.ax file "warm" (prevents best-effort pruning of cold files).
 * A short Range GET with a Referer counts as access.
 */
export async function pingQuaxFile(
  url: string,
  timeoutMs = 20000
): Promise<{ ok: boolean; status: number }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        Range: 'bytes=0-262143',
        Referer: 'https://rge-hub.vercel.app/',
        'User-Agent': 'RGEHub-KeepAlive/1.0',
      },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    await res.arrayBuffer().catch(() => new ArrayBuffer(0));
    return { ok: res.status === 200 || res.status === 206, status: res.status };
  } catch {
    clearTimeout(timer);
    return { ok: false, status: 0 };
  }
}
