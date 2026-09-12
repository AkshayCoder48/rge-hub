/**
 * GET /api/community/feed
 * Public feed of all published community resources, sorted by createdAt desc.
 *
 * Optional query:
 *   - limit: number (default 50)
 *
 * Returns: { ok: true, resources: Resource[] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { listAllPublicResources } from '@/lib/resources';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit');
    let limit = 50;
    if (limitParam) {
      const parsed = parseInt(limitParam, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        limit = Math.min(parsed, 500); // hard cap to avoid abuse
      }
    }

    const resources = await listAllPublicResources();
    const sliced = resources.slice(0, limit);

    return NextResponse.json({ ok: true, resources: sliced });
  } catch (err) {
    console.error('[community/feed] error:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to load community feed' },
      { status: 500 }
    );
  }
}
