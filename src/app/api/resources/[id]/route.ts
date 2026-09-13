/**
 * /api/resources/[id]
 *
 * GET    — get a single resource
 * PATCH  — update fields (auth required; owner or admin only)
 * DELETE — delete the resource + file (auth required; owner or admin only)
 *
 * Query params:
 *   - type: 'image' | 'clip' | 'xml'
 *   - xmlSource?: 'community' | 'admin'
 *
 * Access:
 *   - Published resources: visible to anyone.
 *   - Unpublished: only owner or admin.
 *   - Admin XMLs (xmlSource=admin): only admin — COMPLETELY hidden from public.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import {
  getResource,
  updateResource,
  deleteResourceVerified,
  tombstoneAdd,
  type Resource,
  type ResourceType,
  type XmlSource,
} from '@/lib/resources';
import { deleteFile } from '@/lib/onyxbase';

function isResourceType(v: string | null): v is ResourceType {
  return v === 'image' || v === 'clip' || v === 'xml';
}
function isXmlSource(v: string | null): v is XmlSource {
  return v === 'community' || v === 'admin';
}

/**
 * Locate a resource. If type/xmlSource is provided, look there directly.
 * Otherwise fall back to scanning all collections.
 * CRITICAL: Never returns admin XMLs to non-admin users.
 */
async function locateResource(
  id: string,
  type: ResourceType | null,
  xmlSource: XmlSource | null,
  isAdmin: boolean
): Promise<Resource | null> {
  if (type) {
    if (type === 'xml') {
      if (xmlSource) {
        // Admin XMLs only accessible to admins
        if (xmlSource === 'admin' && !isAdmin) return null;
        return getResource(id, type, xmlSource);
      }
      // search community first, then admin (only if admin)
      const community = await getResource(id, type, 'community');
      if (community) return community;
      if (isAdmin) {
        return getResource(id, type, 'admin');
      }
      return null;
    }
    return getResource(id, type, undefined);
  }
  // No type provided → scan (community only for non-admins)
  const img = await getResource(id, 'image');
  if (img) return img;
  const clip = await getResource(id, 'clip');
  if (clip) return clip;
  const cx = await getResource(id, 'xml', 'community');
  if (cx) return cx;
  if (isAdmin) {
    const ax = await getResource(id, 'xml', 'admin');
    if (ax) return ax;
  }
  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const type = isResourceType(searchParams.get('type')) ? searchParams.get('type') : null;
    const xmlSource = isXmlSource(searchParams.get('xmlSource')) ? searchParams.get('xmlSource') : null;

    const sessionResult = await getSession();
    const session = sessionResult.status === 'ok' ? sessionResult.session : null;
    const isAuthenticated = session !== null;
    const isAdmin = session?.isAdmin === true;

    // Admin XMLs require admin
    if (type === 'xml' && xmlSource === 'admin' && !isAdmin) {
      return NextResponse.json(
        { ok: false, error: 'Admin access required' },
        { status: 403 }
      );
    }

    const resource = await locateResource(id, type, xmlSource, isAdmin);
    if (!resource) {
      return NextResponse.json({ ok: false, error: 'Resource not found' }, { status: 404 });
    }

    // If this turns out to be an admin xml, enforce admin even if caller didn't specify xmlSource
    if (resource.type === 'xml' && resource.xmlSource === 'admin' && !isAdmin) {
      return NextResponse.json(
        { ok: false, error: 'Admin access required' },
        { status: 403 }
      );
    }

    // Visibility for unpublished
    if (!resource.published) {
      if (!isAuthenticated) {
        return NextResponse.json(
          { ok: false, error: 'Authentication required' },
          { status: 401 }
        );
      }
      const isOwner = resource.ownerId === session.userId;
      if (!isOwner && !isAdmin) {
        return NextResponse.json(
          { ok: false, error: 'Resource not found' },
          { status: 404 }
        );
      }
    }

    return NextResponse.json({ ok: true, resource });
  } catch (err) {
    console.error('[resources/get] error:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to fetch resource' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const type = isResourceType(searchParams.get('type')) ? searchParams.get('type') : null;
    const xmlSource = isXmlSource(searchParams.get('xmlSource')) ? searchParams.get('xmlSource') : null;

    const sessionResult = await getSession();
    if (sessionResult.status !== 'ok') {
      return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 });
    }
    const session = sessionResult.session;

    const resource = await locateResource(id, type, xmlSource, session.isAdmin);
    if (!resource) {
      return NextResponse.json({ ok: false, error: 'Resource not found' }, { status: 404 });
    }

    // Owner or admin only
    const isOwner = resource.ownerId === session.userId;
    if (!isOwner && !session.isAdmin) {
      return NextResponse.json(
        { ok: false, error: 'Not authorized to update this resource' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      title,
      description,
      tags,
      category,
      duration,
      published,
      featured,
      thumbnailFileId,
      thumbnailUrl,
      downloadUrl,
    } = body || {};

    // Apply allowed updates (cannot change ownerId, type, fileId, id, xmlSource)
    if (typeof title === 'string' && title.trim()) resource.title = title.trim();
    if (typeof description === 'string') resource.description = description;
    if (Array.isArray(tags)) {
      resource.tags = tags.filter((t: unknown) => typeof t === 'string');
    }
    if (typeof category === 'string') resource.category = category.trim() || undefined;
    if (typeof duration === 'number' && !Number.isNaN(duration)) resource.duration = duration;
    if (typeof published === 'boolean') resource.published = published;

    // featured is admin-only
    if (typeof featured === 'boolean') {
      if (!session.isAdmin) {
        return NextResponse.json(
          { ok: false, error: 'Admin access required to set featured flag' },
          { status: 403 }
        );
      }
      resource.featured = featured;
    }

    // Optional thumbnail updates
    if (typeof thumbnailFileId === 'string') resource.thumbnailFileId = thumbnailFileId || undefined;
    if (typeof thumbnailUrl === 'string') resource.thumbnailUrl = thumbnailUrl || undefined;
    if (typeof downloadUrl === 'string') resource.downloadUrl = downloadUrl;

    const ok = await updateResource(resource);
    if (!ok) {
      return NextResponse.json(
        { ok: false, error: 'Failed to update resource' },
        { status: 500 }
      );
    }

    // Invalidate server-side cache so listings reflect the update (PRD §46)
    const { invalidateResources } = await import('@/lib/cache');
    invalidateResources();

    return NextResponse.json({ ok: true, resource });
  } catch (err) {
    console.error('[resources/patch] error:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to update resource' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const type = isResourceType(searchParams.get('type')) ? searchParams.get('type') : null;
    const xmlSource = isXmlSource(searchParams.get('xmlSource')) ? searchParams.get('xmlSource') : null;

    const sessionResult = await getSession();
    if (sessionResult.status !== 'ok') {
      return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 });
    }
    const session = sessionResult.session;

    const resource = await locateResource(id, type, xmlSource, session.isAdmin);
    if (!resource) {
      // IDEMPOTENT delete: already gone (or backend-rotted ghost) still
      // returns success — tombstone it so no listing can ever resurface it.
      // This is what previously surfaced as a confusing "delete error"
      // for records the backend had already lost.
      await tombstoneAdd(id);
      const { invalidateResources } = await import('@/lib/cache');
      invalidateResources();
      return NextResponse.json({ ok: true, alreadyDeleted: true });
    }

    const isOwner = resource.ownerId === session.userId;
    if (!isOwner && !session.isAdmin) {
      return NextResponse.json(
        { ok: false, error: 'Not authorized to delete this resource' },
        { status: 403 }
      );
    }

    // Delete the OnyxBase file (best-effort; also delete thumbnail if present)
    if (resource.fileId) {
      try {
        await deleteFile(resource.fileId);
      } catch (e) {
        console.warn('[resources/delete] failed to delete file', resource.fileId, e);
      }
    }
    if (resource.thumbnailFileId) {
      try {
        await deleteFile(resource.thumbnailFileId);
      } catch (e) {
        console.warn('[resources/delete] failed to delete thumbnail', resource.thumbnailFileId, e);
      }
    }

    // Deterministic delete: tombstone (spread write = instant + durable
    // hide) + backend record deletes (parallel, idempotent). Always
    // succeeds from the user's perspective — ghosts can no longer error.
    const result = await deleteResourceVerified(id, resource.type, resource.xmlSource);

    // Invalidate server-side cache
    const { invalidateResources } = await import('@/lib/cache');
    invalidateResources();

    return NextResponse.json({ ok: true, confirmed: result.confirmed });
  } catch (err) {
    console.error('[resources/delete] error:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to delete resource' },
      { status: 500 }
    );
  }
}
