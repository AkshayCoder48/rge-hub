/**
 * Best-effort permanent mirrors for uploaded assets.
 *
 * These hosts require no signup and no API key. They are attempted
 * opportunistically with short timeouts — a mirror failure NEVER fails
 * the upload (the durable KV byte store + OnyxBase file URL remain).
 *
 * Order: catbox.moe (200MB, any type) → telegra.ph (images ≤5MB).
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
  const catbox = await mirrorCatbox(bytes, fileName, mimeType);
  if (catbox.ok) return catbox;
  if (kind === 'image') {
    const telegraph = await mirrorTelegraph(bytes, fileName, mimeType);
    if (telegraph.ok) return telegraph;
  }
  return { ok: false };
}
