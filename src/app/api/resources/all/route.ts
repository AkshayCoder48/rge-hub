/**
 * GET /api/resources/all
 * Batch fetch ALL resources (images, clips, community XMLs) in a single request.
 *
 * This is the key performance optimization — instead of the client making
 * separate requests per type, this endpoint fetches everything in parallel
 * server-side (using cached OnyxBase reads) and returns it in one response.
 *
 * Reliability fixes (PRD §13, §33, §46):
 * - Empty results are NEVER cached: OnyxBase is eventually consistent and can
 *   briefly return empty lists right after a write. Caching that emptiness is
 *   what made uploads "disappear" (and "Recently added" render empty).
 * - When the backing store returns empty, we retry twice before accepting it,
 *   so transient consistency gaps don't surface as an empty library.
 *
 * Query params:
 *   - owner: userId (optional — filter to a specific owner)
 *
 * Returns: { ok: true, images, clips, xmls, all }
 */
import { NextRequest, NextResponse } from 'next/server';
import { listResources, type Resource } from '@/lib/resources';
import { getCached, setCachedNonEmpty } from '@/lib/cache';

export const dynamic = 'force-dynamic';

async function fetchFiltered(owner: string | null) {
  const [images, clips, xmls] = await Promise.all([
    listResources('image'),
    listResources('clip'),
    listResources('xml', 'community'),
  ]);

  // Filter by owner if specified, otherwise filter to published (public)
  const filterFn = owner
    ? (r: Resource) => r.ownerId === owner
    : (r: Resource) => r.published;

  return {
    images: images.filter(filterFn),
    clips: clips.filter(filterFn),
    xmls: xmls.filter(filterFn),
  };
}

function toAll(f: { images: Resource[]; clips: Resource[]; xmls: Resource[] }) {
  return [...f.images, ...f.clips, ...f.xmls].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const owner = searchParams.get('owner');

    // Check cache first (near-instant if cached; empties are never cached)
    const cacheKey = owner ? `resources:all:${owner}` : 'resources:all:public';
    const cached = getCached<{ images: Resource[]; clips: Resource[]; xmls: Resource[] }>(cacheKey);
    if (cached) {
      return NextResponse.json(
        { ok: true, ...cached, all: toAll(cached), cached: true },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // Batch fetch all resource types in parallel, retrying transient empties.
    let filtered = await fetchFiltered(owner);
    let total = filtered.images.length + filtered.clips.length + filtered.xmls.length;
    for (let attempt = 0; attempt < 2 && total === 0; attempt++) {
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      filtered = await fetchFiltered(owner);
      total = filtered.images.length + filtered.clips.length + filtered.xmls.length;
    }

    // Cache only non-empty payloads (see setCachedNonEmpty docs).
    const wasCached = setCachedNonEmpty(cacheKey, filtered, total === 0);

    return NextResponse.json(
      { ok: true, ...filtered, all: toAll(filtered), cached: false, retriedEmpty: !wasCached && total === 0 },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('[resources/all] error:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to fetch resources' },
      { status: 500 }
    );
  }
}
