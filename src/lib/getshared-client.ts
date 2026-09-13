/**
 * getshared direct-from-browser uploader (client-side).
 *
 * The whole handshake runs in the browser against https://www.getshared.com
 * (their API sends `Access-Control-Allow-Origin: *`, and the handshake needs
 * no secret), so multi-GB files never touch our serverless functions:
 *
 *   genid -> register -> chunk uploads (50MB, Content-Range) -> complete
 *
 * On success returns the share + direct-download URLs, which are then saved
 * as a URL-only resource record (no bytes/base64 in OnyxBase).
 */

import {
  GETSHARED_BASE,
  GETSHARED_CHUNK_BYTES,
  getsharedDownloadUrl,
  getsharedShareUrl,
} from './getshared';

export interface GetsharedProgress {
  loaded: number;
  total: number;
  pct: number; // 0..100
  chunk: number; // chunks completed
  chunks: number; // total chunks
}

export interface GetsharedResult {
  uploadId: string;
  shareUrl: string;
  downloadUrl: string;
  fileId: string; // ext:getshared:{uploadId} — stored as the resource fileId
}

async function postForm(path: string, form: FormData, extraHeaders?: Record<string, string>): Promise<Response> {
  return fetch(`${GETSHARED_BASE}${path}`, {
    method: 'POST',
    body: form,
    headers: extraHeaders,
  });
}

/**
 * Upload a file directly to getshared with progress + per-chunk retries.
 * `senderEmail` is only a label (share='link' sends no mail); any string works.
 */
export async function uploadToGetshared(
  file: File,
  opts: {
    senderEmail?: string;
    signal?: AbortSignal;
    onProgress?: (p: GetsharedProgress) => void;
  } = {}
): Promise<GetsharedResult> {
  const { senderEmail = 'uploads@rge-hub.app', signal, onProgress } = opts;

  // ---- 1. handshake: genid + register (same session/IP, like the real site) ----
  const genidRes = await fetch(`${GETSHARED_BASE}/upload/genid`, { signal });
  if (!genidRes.ok) throw new Error(`getshared handshake failed (HTTP ${genidRes.status})`);
  const genidData = await genidRes.json().catch(() => ({}));
  const uploadId: string | undefined = genidData.upload_id || genidData.uploadId;
  if (!uploadId) throw new Error('getshared handshake failed (no upload id)');

  const reg = new FormData();
  reg.append('upload_id', uploadId);
  reg.append('email_from', senderEmail);
  reg.append('email_to[]', '');
  reg.append('message', '');
  reg.append('password', '');
  reg.append('destruct', 'no');
  reg.append('share', 'link');
  reg.append('expire', '2592000'); // 30 days, extended on every download
  reg.append('preview', '0');
  const regRes = await postForm('/upload/register', reg);
  if (!regRes.ok) throw new Error(`getshared register failed (HTTP ${regRes.status})`);

  // ---- 2. chunk uploads (50MB slices; Content-Range required above 50MB total) ----
  const total = file.size;
  const chunks = Math.max(1, Math.ceil(total / GETSHARED_CHUNK_BYTES));
  const fileUid = `${file.name}_${Date.now()}`;
  let loaded = 0;

  for (let i = 0; i < chunks; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const start = i * GETSHARED_CHUNK_BYTES;
    const end = Math.min(start + GETSHARED_CHUNK_BYTES, total);
    const slice = file.slice(start, end);

    let lastErr = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      try {
        const chunk = new FormData();
        chunk.append('upload_id', uploadId);
        chunk.append('file_uid', fileUid);
        chunk.append('original_path', file.name);
        chunk.append('files[]', slice, file.name);
        const headers =
          total > GETSHARED_CHUNK_BYTES
            ? { 'Content-Range': `bytes ${start}-${end - 1}/${total}` }
            : undefined;
        const res = await postForm('/upload', chunk, headers);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        break; // chunk accepted
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
        if (attempt === 3) {
          throw new Error(`getshared chunk ${i + 1}/${chunks} failed: ${lastErr}`);
        }
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }

    loaded = end;
    onProgress?.({
      loaded,
      total,
      pct: total > 0 ? Math.min(99, Math.round((loaded / total) * 100)) : 0,
      chunk: i + 1,
      chunks,
    });
  }

  // ---- 3. complete ----
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const done = new FormData();
  done.append('upload_id', uploadId);
  const doneRes = await postForm('/upload/complete', done);
  if (!doneRes.ok) throw new Error(`getshared finalize failed (HTTP ${doneRes.status})`);

  onProgress?.({ loaded: total, total, pct: 100, chunk: chunks, chunks });

  return {
    uploadId,
    shareUrl: getsharedShareUrl(uploadId),
    downloadUrl: getsharedDownloadUrl(uploadId),
    fileId: `ext:getshared:${uploadId}`,
  };
}
