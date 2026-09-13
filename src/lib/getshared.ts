/**
 * getshared file-host integration (server-side helpers).
 *
 * Large videos / files (>50MB, up to 5GB) are uploaded DIRECTLY from the
 * browser to getshared.com (see getshared-client.ts) — no secrets are needed
 * for their handshake, and direct upload avoids all serverless payload/time
 * limits. OnyxBase stores only the resulting URLs (never bytes/base64).
 *
 * getshared removes files after 30 days WITHOUT ACTIVITY — every download
 * (even a partial Range request) extends the expiry. This module provides the
 * URL builders + the ping used by the keep-alive cron (see
 * /api/cron/keepalive and scripts/getshared-keepalive.mjs).
 *
 * Verified flow (Sep 2026, live E2E, byte-identical roundtrip):
 *   GET  /upload/genid                                   -> { upload_id }
 *   POST /upload/register (multipart: upload_id, email_from,
 *        email_to[]='', message='', password='', destruct='no',
 *        share='link', expire='2592000', preview='0')    -> {"response":"ok"}
 *   POST /upload (multipart per chunk: upload_id, file_uid,
 *        original_path, files[]; Content-Range when >50MB) -> 200 { files:[...] }
 *   POST /upload/complete (multipart: upload_id)          -> {"status":"success"}
 * Share page:  https://www.getshared.com/d/{upload_id}
 * Raw bytes:   GET /handler/download?action=download&download_id={id}&private_id=0
 * NOTE: the temp `url` in the upload response is an HTML page, NOT file bytes.
 */

export const GETSHARED_BASE = 'https://www.getshared.com';
export const GETSHARED_CHUNK_BYTES = 50 * 1024 * 1024; // server uses 50MB chunks w/ Content-Range
export const GETSHARED_MAX_BYTES = 5 * 1024 * 1024 * 1024; // hub policy: 5GB per file

/** Canonical share-page URL for an upload id. */
export function getsharedShareUrl(uploadId: string): string {
  return `${GETSHARED_BASE}/d/${uploadId}`;
}

/** Direct-download URL (serves raw bytes, byte-identical to the upload). */
export function getsharedDownloadUrl(uploadId: string): string {
  return `${GETSHARED_BASE}/handler/download?action=download&download_id=${encodeURIComponent(uploadId)}&private_id=0`;
}

/** True when the URL points at getshared (share page, temp file, or download handler). */
export function isGetsharedUrl(url: string | undefined | null): boolean {
  if (!url || typeof url !== 'string') return false;
  return url.includes('getshared.com');
}

/** Extract the upload id from a share/download URL, if recognizable. */
export function getsharedIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('getshared.com')) return null;
    const m = u.pathname.match(/^\/d\/([A-Za-z0-9_-]+)/);
    if (m) return m[1];
    const did = u.searchParams.get('download_id');
    if (did) return did;
  } catch {}
  return null;
}

/**
 * Register "activity" on a getshared file WITHOUT downloading it fully.
 * A short Range request counts as a download and extends the 30-day expiry.
 * Returns true when the file is reachable (2xx/206/302 to bytes).
 */
export async function pingGetsharedFile(
  url: string,
  timeoutMs = 20000
): Promise<{ ok: boolean; status: number; bytes: number }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Range: 'bytes=0-262143', // first 256KB is enough to count as activity
        'User-Agent': 'RGEHub-KeepAlive/1.0',
      },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    // Drain the small body so the socket closes cleanly.
    const buf = await res.arrayBuffer().catch(() => new ArrayBuffer(0));
    const ok = res.status === 200 || res.status === 206;
    return { ok, status: res.status, bytes: buf.byteLength };
  } catch {
    clearTimeout(timer);
    return { ok: false, status: 0, bytes: 0 };
  }
}
