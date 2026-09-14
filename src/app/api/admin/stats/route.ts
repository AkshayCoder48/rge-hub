/**
 * GET /api/admin/stats  — CACHED AGGREGATES (PRD §15, §22, OnyxBase PRD §21–23).
 *
 * Previously recomputed on every load: full profiles export + 4 full
 * listing fan-outs (the slowest endpoint in the app). Now:
 *   - aggregates derived from listResourcesFast (1 export/collection,
 *     20s cached) + cached profiles (60s)
 *   - the final stats object cached 60s server-side
 *   - writes invalidate via invalidateListings()/invalidateResources()
 *
 * Response: { success, data: { totals... }, requestId, durationMs }
 */
import { NextRequest, NextResponse } from 'next/server';
import { requirePerm } from '@/lib/admin';
import { getAllProfiles, listResourcesFast } from '@/lib/resources';
import { getCached, setCached } from '@/lib/cache';
import { newRequestId } from '@/lib/api-contract';

export const dynamic = 'force-dynamic';

const STATS_CACHE_KEY = 'admin:stats';
const STATS_TTL_MS = 60 * 1000;

interface StatsPayload {
  totalUsers: number;
  totalImages: number;
  totalClips: number;
  totalCommunityXmls: number;
  totalAdminXmls: number;
  publishedCount: number;
  unpublishedCount: number;
  cached: boolean;
}

export async function GET(_request: NextRequest) {
  const requestId = newRequestId();
  const t0 = Date.now();
  try {
    const gate = await requirePerm('admin.view');
    if (!gate.ok) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'FORBIDDEN', message: gate.error },
          requestId,
        },
        { status: gate.status, headers: { 'x-request-id': requestId } }
      );
    }

    const cached = getCached<StatsPayload>(STATS_CACHE_KEY);
    if (cached) {
      return NextResponse.json(
        { success: true, data: { ...cached, cached: true }, requestId, durationMs: Date.now() - t0 },
        { headers: { 'x-request-id': requestId, 'Cache-Control': 'no-store' } }
      );
    }

    // Parallel independent queries (PRD §15 — no sequential waits).
    const [profiles, images, clips, communityXmls, adminXmls] = await Promise.all([
      getAllProfiles(),
      listResourcesFast('image'),
      listResourcesFast('clip'),
      listResourcesFast('xml', 'community'),
      listResourcesFast('xml', 'admin'),
    ]);

    const all = [...images, ...clips, ...communityXmls, ...adminXmls];
    const publishedCount = all.filter((r) => r.published).length;

    const payload: StatsPayload = {
      totalUsers: profiles.length,
      totalImages: images.length,
      totalClips: clips.length,
      totalCommunityXmls: communityXmls.length,
      totalAdminXmls: adminXmls.length,
      publishedCount,
      unpublishedCount: all.length - publishedCount,
      cached: false,
    };
    setCached(STATS_CACHE_KEY, payload);

    return NextResponse.json(
      { success: true, data: payload, requestId, durationMs: Date.now() - t0 },
      { headers: { 'x-request-id': requestId, 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('[admin/stats] error:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load admin stats' }, requestId },
      { status: 500, headers: { 'x-request-id': requestId } }
    );
  }
}
