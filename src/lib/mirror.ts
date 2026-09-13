/**
 * Best-effort permanent mirrors for uploaded assets.
 *
 * These hosts require no signup and no API key. They are attempted
 * opportunistically with short timeouts — a mirror failure NEVER fails
 * the upload (the durable KV byte store + OnyxBase file URL remain).
 *
 * Order for images: imghosting.in (token edge-upload, primary) →
 * catbox.moe (200MB) → telegra.ph (≤5MB). Clips: catbox only.
 */

export interface MirrorResult {
  ok: boolean;
  url?: string;
  host?: string;
}

async function postForm(
  url: string,
  form: FormData,
  timeoutMs: number
): Promise<{ status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      body: form,
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (RGE-Hub)' },
    });
    const text = await res.text().catch(() => '');
    return { status: res.status, text: text.slice(0, 500) };
  } finally {
    clearTimeout(timer);
  }
}

/** catbox.moe — permanent, no signup, 200MB limit. */
async function mirrorCatbox(
  bytes: Buffer,
  fileName: string,
  mimeType: string
): Promise<MirrorResult> {
  try {
    if (bytes.length > 200 * 1024 * 1024) return { ok: false };
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', new Blob([new Uint8Array(bytes)], { type: mimeType }), fileName);
    const { status, text } = await postForm('https://catbox.moe/user/api.php', form, 25000);
    const url = text.trim();
    if (status === 200 && /^https:\/\/files\.catbox\.moe\//.test(url)) {
      return { ok: true, url, host: 'catbox' };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

/** telegra.ph — permanent-ish, no signup, images ≤5MB. */
async function mirrorTelegraph(
  bytes: Buffer,
  fileName: string,
  mimeType: string
): Promise<MirrorResult> {
  try {
    if (!mimeType.startsWith('image/')) return { ok: false };
    if (bytes.length > 5 * 1024 * 1024) return { ok: false };
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), fileName);
    const { status, text } = await postForm('https://telegra.ph/upload', form, 20000);
    if (status !== 200) return { ok: false };
    const parsed = JSON.parse(text) as Array<{ src?: string }> | unknown;
    const src = Array.isArray(parsed) ? parsed[0]?.src : undefined;
    if (src && src.startsWith('/')) {
      return { ok: true, url: `https://telegra.ph${src}`, host: 'telegraph' };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

/** imghosting.in — token-based edge upload. PRIMARY for images.
 *
 * Flow: GET imghosting.in/api/edge-upload → {token, timestamp}, then POST
 * the file to upload.imghosting.in/upload with X-Upload-Token /
 * X-Upload-Timestamp headers. Verified live: 3KB→0.65s, 3.2MB→0.95s,
 * byte-identical roundtrip, serves image/* with correct content-type.
 */
async function mirrorImghosting(
  bytes: Buffer,
  fileName: string,
  mimeType: string
): Promise<MirrorResult> {
  try {
    if (!mimeType.startsWith('image/')) return { ok: false };
    // Step 1 — fresh edge token per upload (cheap, ~1s).
    const tController = new AbortController();
    const tTimer = setTimeout(() => tController.abort(), 15000);
    let token = '';
    let timestamp = '';
    try {
      const tRes = await fetch('https://imghosting.in/api/edge-upload', {
        signal: tController.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (RGE-Hub)' },
      });
      if (!tRes.ok) return { ok: false };
      const data = (await tRes.json().catch(() => null)) as {
        token?: unknown;
        timestamp?: unknown;
      } | null;
      if (typeof data?.token !== 'string' || !data.token) return { ok: false };
      if (data.timestamp === undefined || data.timestamp === null) return { ok: false };
      token = data.token;
      timestamp = String(data.timestamp);
    } finally {
      clearTimeout(tTimer);
    }
    // Step 2 — upload the bytes.
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), fileName);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const res = await fetch('https://upload.imghosting.in/upload', {
        method: 'POST',
        body: form,
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (RGE-Hub)',
          'X-Upload-Token': token,
          'X-Upload-Timestamp': timestamp,
        },
      });
      const text = await res.text().catch(() => '');
      if (res.status !== 200) return { ok: false };
      const parsed = JSON.parse(text) as { success?: unknown; url?: unknown } | unknown;
      const url = (parsed as { url?: unknown })?.url;
      if (
        (parsed as { success?: unknown })?.success === true &&
        typeof url === 'string' &&
        /^https:\/\/imgh\.in\//.test(url)
      ) {
        return { ok: true, url, host: 'imghosting' };
      }
      return { ok: false };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { ok: false };
  }
}

/**
 * Attempt mirrors in order. Resolves quickly; never throws.
 * Only used for images and clips (small, hotlink-friendly assets).
 */
export async function mirrorAsset(
  bytes: Buffer,
  fileName: string,
  mimeType: string,
  kind: 'image' | 'clip' | 'xml'
): Promise<MirrorResult> {
  if (kind === 'xml') return { ok: false };
  if (kind === 'image') {
    const imghosting = await mirrorImghosting(bytes, fileName, mimeType);
    if (imghosting.ok) return imghosting;
  }
  const catbox = await mirrorCatbox(bytes, fileName, mimeType);
  if (catbox.ok) return catbox;
  if (kind === 'image') {
    const telegraph = await mirrorTelegraph(bytes, fileName, mimeType);
    if (telegraph.ok) return telegraph;
  }
  return { ok: false };
}
