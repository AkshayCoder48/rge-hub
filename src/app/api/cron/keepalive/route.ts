/**
 * GET /api/cron/keepalive?secret=...
 * Keep getshared-backed files alive.
 *
 * getshared deletes files after 30 days WITHOUT ACTIVITY; every download
 * (even a partial Range request) resets the clock. This job scans every
 * resource record for getshared URLs and pings each file's first 256KB —
 * enough to count as a download without moving real bandwidth.
 *
 * Auth: `secret` must equal the SESSION_SECRET env var. Trigger it from any
 * scheduler (cron, Task Scheduler, GitHub Actions) at least every ~2 weeks:
 *   scripts/getshared-keepalive.mjs
 *
 * Returns: { ok, scanned, alive, failed: [{ resourceId, url, status }] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { listResources } from '@/lib/resources';
import { getsharedIdFromUrl, isGetsharedUrl, pingGetsharedFile } from '@/lib/getshared';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const PING_CONCURRENCY = 4;

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret') || '';
  const expected = process.env.SESSION_SECRET || '';
  if (!expected || secret !== expected) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const [images, clips, communityXmls, adminXmls] = await Promise.all([
      listResources('image').catch(() => []),
      listResources('clip').catch(() => []),
      listResources('xml', 'community').catch(() => []),
      listResources('xml', 'admin').catch(() => []),
    ]);
    const all = [...images, ...clips, ...communityXmls, ...adminXmls];

    // One ping per unique getshared upload (share + download URLs map to one id).
    const targets = new Map<string, { resourceId: string; url: string }>();
    for (const r of all) {
      for (const url of [r.downloadUrl, r.storageUrl, r.mirrorUrl]) {
        if (!isGetsharedUrl(url)) continue;
        const id = getsharedIdFromUrl(url as string);
        const key = id || (url as string);
        if (!targets.has(key)) targets.set(key, { resourceId: r.id, url: url as string });
      }
    }

    const entries = [...targets.entries()];
    const failed: { resourceId: string; url: string; status: number }[] = [];
    let alive = 0;

    for (let i = 0; i < entries.length; i += PING_CONCURRENCY) {
      const batch = entries.slice(i, i + PING_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async ([, t]) => ({ t, r: await pingGetsharedFile(t.url) }))
      );
      for (const { t, r } of results) {
        if (r.ok) alive += 1;
        else failed.push({ resourceId: t.resourceId, url: t.url, status: r.status });
      }
    }

    return NextResponse.json({
      ok: true,
      scanned: all.length,
      getsharedFiles: entries.length,
      alive,
      failed,
      at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[cron/keepalive] error:', err);
    return NextResponse.json({ ok: false, error: 'Keep-alive run failed' }, { status: 500 });
  }
}
