/**
 * GET /api/resources/all
 * Batch fetch ALL resources in a SINGLE request — public feed, typed slices,
 * and (optionally) the caller's own resources including drafts.
 *
 * Speed design (this endpoint must answer in ~1-4s, not 15s):
 * - Listings are index reads (1 KV read per collection + point gets),
 *   all parallel, all hard-timeouted. No sleep-cascade retries anywhere.
 * - `?owner=<userId>&mine=1` returns the owner's slice in the SAME response,
 *   so the client makes ONE request instead of two sequential 10s+ fetches.
 * - Empty results are NEVER cached; non-empty responses cache for 15s.
 *
 * Query params:
 *   - owner: userId (optional)
 *   - mine=1: include `mine` (owner's resources incl. drafts) — requires owner
 *
 * Returns: { ok: true, images, clips, xmls, all, mine? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { listResourcesFast, type Resource } from '@/lib/resources';
import { getCached, setCachedNonEmpty } from '@/lib/cache';
import { newRequestId } from '@/lib/api-contract';

export const dynamic = 'force-dynamic';

function toAll(f: { images: Resource[]; clips: Resource[]; xmls: Resource[] }) {
  return [...f.images, ...f.clips, ...f.xmls].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

interface AllPayload {
  images: Resource[];
  clips: Resource[];
  xmls: Resource[];
  all: Resource[];
  mine?: Resource[];
}

export async function GET(request: NextRequest) {
  const t0 = Date.now();
  const requestId = newRequestId();
  try {
    const { searchParams } = new URL(request.url);
    const owner = searchParams.get('owner');
    const withMine = searchParams.get('mine') === '1' && !!owner;

    const cacheKey = withMine
      ? `resources:all:mine:${owner}`
      : owner
        ? `resources:all:${owner}`
        : 'resources:all:public';
    const cached = getCached<AllPayload>(cacheKey);
    if (cached) {
      return NextResponse.json(
        { ok: true, ...cached, cached: true, ms: Date.now() - t0 },
        { headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId } }
      );
    }

    // FAST listings: 1 export per collection (20s-cached inside) instead
    // of the old 2 LISTs + 12N point-reads per collection (PRD §14).
    const [images, clips, xmls] = await Promise.all([
      listResourcesFast('image'),
      listResourcesFast('clip'),
      listResourcesFast('xml', 'community'),
    ]);

    const isPublic = (r: Resource) => r.published;
    const isOwner = (r: Resource) => r.ownerId === owner;

    let payload: AllPayload;
    if (owner && !withMine) {
      // Legacy owner-only shape.
      const own = {
        images: images.filter(isOwner),
        clips: clips.filter(isOwner),
        xmls: xmls.filter(isOwner),
      };
      payload = { ...own, all: toAll(own) };
    } else {
      const pub = {
        images: images.filter(isPublic),
        clips: clips.filter(isPublic),
        xmls: xmls.filter(isPublic),
      };
      payload = { ...pub, all: toAll(pub) };
      if (withMine) {
        payload.mine = toAll({
          images: images.filter(isOwner),
          clips: clips.filter(isOwner),
          xmls: xmls.filter(isOwner),
        });
      }
    }

    const total = payload.all.length + (payload.mine?.length ?? 0);
    setCachedNonEmpty(cacheKey, payload, total === 0);

    return NextResponse.json(
      { ok: true, ...payload, cached: false, ms: Date.now() - t0 },
      { headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId } }
    );
  } catch (err) {
    console.error('[resources/all] error:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to fetch resources' },
      { status: 500 }
    );
  }
}
