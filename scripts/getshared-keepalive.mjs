#!/usr/bin/env node
/**
 * getshared-keepalive.mjs — stop getshared files from expiring.
 *
 * getshared deletes a file after 30 days WITHOUT ACTIVITY; every download
 * (even a partial Range request) resets the clock. Run this at least every
 * ~2 weeks (cron / Task Scheduler / GitHub Actions / `vercel cron` alt).
 *
 * Mode 1 — hub route (recommended): scans ALL resource records server-side
 *   HUB_URL=https://rge-hub.vercel.app KEEPALIVE_SECRET=<SESSION_SECRET> \
 *     node scripts/getshared-keepalive.mjs
 *
 * Mode 2 — direct URLs (no hub needed, e.g. single-file check):
 *   node scripts/getshared-keepalive.mjs --ping <url> [<url> ...]
 *
 * Exit code: 0 when every file answered, 1 otherwise.
 */

const HUB_URL = (process.env.HUB_URL || '').replace(/\/+$/, '');
const SECRET = process.env.KEEPALIVE_SECRET || '';

async function pingDirect(url, timeoutMs = 25000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Range: 'bytes=0-262143', 'User-Agent': 'RGEHub-KeepAlive/1.0' },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    const buf = await res.arrayBuffer().catch(() => new ArrayBuffer(0));
    return { url, ok: res.status === 200 || res.status === 206, status: res.status, bytes: buf.byteLength };
  } catch (err) {
    clearTimeout(timer);
    return { url, ok: false, status: 0, bytes: 0, error: err?.message || 'fetch failed' };
  }
}

async function main() {
  const args = process.argv.slice(2);

  // ---- Mode 2: direct ping list ----
  if (args[0] === '--ping') {
    const urls = args.slice(1).filter(Boolean);
    if (urls.length === 0) {
      console.error('Usage: node scripts/getshared-keepalive.mjs --ping <url> [<url> ...]');
      process.exit(2);
    }
    let allOk = true;
    for (const url of urls) {
      const r = await pingDirect(url);
      console.log(`${r.ok ? 'ALIVE ' : 'FAILED'} [${r.status}] ${url}${r.error ? ` (${r.error})` : ''}`);
      if (!r.ok) allOk = false;
    }
    process.exit(allOk ? 0 : 1);
  }

  // ---- Mode 1: hub cron route ----
  if (!HUB_URL || !SECRET) {
    console.error(
      'Missing HUB_URL / KEEPALIVE_SECRET.\n' +
        'Usage: HUB_URL=https://<your-hub>.vercel.app KEEPALIVE_SECRET=<SESSION_SECRET> node scripts/getshared-keepalive.mjs\n' +
        '   or: node scripts/getshared-keepalive.mjs --ping <url> [...]'
    );
    process.exit(2);
  }
  const endpoint = `${HUB_URL}/api/cron/keepalive?secret=${encodeURIComponent(SECRET)}`;
  console.log(`Triggering keep-alive: ${HUB_URL}/api/cron/keepalive`);
  const res = await fetch(endpoint, { headers: { 'User-Agent': 'RGEHub-KeepAlive/1.0' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    console.error(`FAILED: HTTP ${res.status} ${data.error || ''}`);
    process.exit(1);
  }
  console.log(
    `OK: scanned ${data.scanned} resources, ${data.getsharedFiles} getshared file(s), ${data.alive} alive.`
  );
  for (const f of data.failed || []) {
    console.log(`FAILED [${f.status}] ${f.resourceId} ${f.url}`);
  }
  process.exit((data.failed || []).length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FAILED:', err?.message || err);
  process.exit(1);
});
