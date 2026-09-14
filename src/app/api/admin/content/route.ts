/**
 * /api/admin/content — staff content management.
 *
 * GET  ?type=image|clip|xml → all resources of that type incl. unpublished
 *                              + admin files (perm content.images|clips|files)
 * POST { id, type, xmlSource?, featured } → toggle featured (perm content.feature)
 *
 * Deletes reuse DELETE /api/resources/[id] (owner, root, or content.* perm).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requirePerm, logActivity } from '@/lib/admin';
import { listResources, getResource, updateResource, type ResourceType } from '@/lib/resources';

export const dynamic = 'force-dynamic';

function permFor(type: string): string | null {
  if (type === 'image') return 'content.images';
  if (type === 'clip') return 'content.clips';
  if (type === 'xml') return 'content.files';
  return null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || '';
  const perm = permFor(type);
  if (!perm) {
    return NextResponse.json({ ok: false, error: 'type must be image|clip|xml' }, { status: 400 });
  }
  const gate = await requirePerm(perm);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }
  try {
    const list =
      type === 'xml'
        ? [...(await listResources('xml', 'community')), ...(await listResources('xml', 'admin'))]
        : await listResources(type as ResourceType);
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return NextResponse.json({ ok: true, resources: list });
  } catch (err) {
    console.error('[admin/content] error:', err);
    return NextResponse.json({ ok: false, error: 'Failed to load content' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const gate = await requirePerm('content.feature');
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }
  const body = await request.json().catch(() => null);
  const { id, type, xmlSource, featured } = body || {};
  if (!id || !permFor(type) || typeof featured !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'id, type and featured are required' }, { status: 400 });
  }
  try {
    const resource = await getResource(id, type, xmlSource === 'admin' ? 'admin' : undefined).catch(() => null);
    if (!resource) {
      return NextResponse.json({ ok: false, error: 'Resource not found' }, { status: 404 });
    }
    resource.featured = featured;
    const ok = await updateResource(resource);
    if (!ok) {
      return NextResponse.json({ ok: false, error: 'Failed to update resource' }, { status: 500 });
    }
    const { invalidateResources } = await import('@/lib/cache');
    invalidateResources();
    await logActivity(
      gate.userId,
      gate.displayName,
      `${featured ? 'featured' : 'unfeatured'} ${type} "${resource.title}"`,
      id
    );
    return NextResponse.json({ ok: true, resource });
  } catch (err) {
    console.error('[admin/content/feature] error:', err);
    return NextResponse.json({ ok: false, error: 'Failed to update resource' }, { status: 500 });
  }
}
