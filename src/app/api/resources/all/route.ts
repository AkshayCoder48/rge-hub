/**
 * GET /api/resources/all
 * Batch fetch ALL resources (images, clips, community XMLs) in a single request.
 *
 * This is the key performance optimization — instead of the client making
 * separate requests per type, this endpoint fetches everything in parallel
 * server-side (using cached OnyxBase reads) and returns it in one response.
 *
 * The server-side cache provides near-instant reads (15s TTL).
 *
 * Query params:
 *   - owner: userId (optional — filter to a specific owner)
 *
 * Returns: { ok: true, images, clips, xmls, all }
 */
import { NextRequest, NextResponse } from 'next/server';
import { listResources, type Resource } from '@/lib/resources';
import { getCached, setCached, invalidateResources } from '@/lib/cache';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const owner = searchParams.get('owner');

    // Check cache first (near-instant if cached)
    const cacheKey = owner ? `resources:all:${owner}` : 'resources:all:public';
    const cached = getCached<{ images: Resource[]; clips: Resource[]; xmls: Resource[] }>(cacheKey);
    if (cached) {
      const all = [...cached.images, ...cached.clips, ...cached.xmls].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      return NextResponse.json({
        ok: true,
        ...cached,
        all,
        cached: true,
      });
    }

    // Batch fetch all resource types in parallel
    const [images, clips, xmls] = await Promise.all([
      listResources('image'),
      listResources('clip'),
      listResources('xml', 'community'),
    ]);

    // Filter by owner if specified, otherwise filter to published (public)
    const filterFn = owner
      ? (r: Resource) => r.ownerId === owner
      : (r: Resource) => r.published;

    const filtered = {
      images: images.filter(filterFn),
      clips: clips.filter(filterFn),
      xmls: xmls.filter(filterFn),
    };

    // Cache the result
    setCached(cacheKey, filtered);

    const all = [...filtered.images, ...filtered.clips, ...filtered.xmls].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return NextResponse.json({
      ok: true,
      ...filtered,
      all,
      cached: false,
    });
  } catch (err) {
    console.error('[resources/all] error:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to fetch resources' },
      { status: 500 }
    );
  }
}
