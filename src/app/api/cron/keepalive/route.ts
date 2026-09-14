/**
 * GET /api/cron/keepalive?secret=...
 * Keep externally-hosted files alive.
 *
 * - getshared deletes files after 30 days WITHOUT ACTIVITY; every download
 *   (even a partial Range request) resets the clock.
 * - qu.ax "permanent" files have no expiry timer, but files never accessed
 *   for a very long time may be pruned — regular access keeps them warm.
 *
 * This job scans every resource record for getshared/qu.ax URLs and pings
 * each file's first 256KB — enough to count as activity/access without
 * moving real bandwidth.
 *
 * Auth: `secret` must equal the SESSION_SECRET env var. Trigger it from any
 * scheduler (cron, Task Scheduler, GitHub Actions) at least every ~2 weeks:
 *   scripts/getshared-keepalive.mjs
 *
 * Returns: { ok, scanned, getsharedFiles, quaxFiles, alive, failed: [...] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { listResources } from '@/lib/resources';
import { getsharedIdFromUrl, isGetsharedUrl, pingGetsharedFile } from '@/lib/getshared';
import { isQuaxUrl, pingQuaxFile } from '@/lib/quax';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const PING_CONCURRENCY = 4;

type Target = { resourceId: string; url: string; host: 'getshared' | 'quax' };

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

    // One ping per unique external file.
    const targets = new Map<string, Target>();
    for (const r of all) {
      for (const url of [r.downloadUrl, r.storageUrl, r.mirrorUrl]) {
        if (typeof url !== 'string' || !url) continue;
        if (isGetsharedUrl(url)) {
          const id = getsharedIdFromUrl(url);
          const key = `gs:${id || url}`;
          if (!targets.has(key)) targets.set(key, { resourceId: r.id, url, host: 'getshared' });
        } else if (isQuaxUrl(url)) {
          const key = `quax:${url}`;
          if (!targets.has(key)) targets.set(key, { resourceId: r.id, url, host: 'quax' });
        }
      }
    }

    const entries = [...targets.values()];
    const failed: { resourceId: string; url: string; status: number }[] = [];
    let alive = 0;
    let quaxFiles = 0;
    let getsharedFiles = 0;

    for (let i = 0; i < entries.length; i += PING_CONCURRENCY) {
      const batch = entries.slice(i, i + PING_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (t) => ({
          t,
          r:
            t.host === 'quax'
              ? await pingQuaxFile(t.url)
              : await pingGetsharedFile(t.url).then((x) => ({ ok: x.ok, status: x.status })),
        }))
      );
      for (const { t, r } of results) {
        if (t.host === 'quax') quaxFiles += 1;
        else getsharedFiles += 1;
        if (r.ok) alive += 1;
        else failed.push({ resourceId: t.resourceId, url: t.url, status: r.status });
      }
    }

    return NextResponse.json({
      ok: true,
      scanned: all.length,
      getsharedFiles,
      quaxFiles,
      alive,
      failed,
      at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[cron/keepalive] error:', err);
    return NextResponse.json({ ok: false, error: 'Keep-alive run failed' }, { status: 500 });
  }
}
