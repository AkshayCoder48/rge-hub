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
import { resolveRole, hasPermission } from '@/lib/admin';
import {
  getResource,
  updateResource,
  deleteResourceVerified,
  blindDeleteResource,
  purgeLegacyTombstones,
  type Resource,
  type ResourceType,
  type XmlSource,
} from '@/lib/resources';
import { deleteFile, backendAcceptsWrites } from '@/lib/onyxbase';
import { deleteImageBytes } from '@/lib/image-bytes';
import { isGetsharedUrl, pingGetsharedFile } from '@/lib/getshared';
import { isQuaxUrl, pingQuaxFile } from '@/lib/quax';

// Deletes honestly propagate before responding (engine-side in-request
// snapshot attempts) — allow the full budget so a delete is never cut off
// mid-propagation by the platform default.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

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

/**
 * Staff content rights: email-root passes everything; role staff need the
 * matching content.* permission for the resource type.
 */
async function contentPermFor(session: { userId?: string; email?: string; isAdmin?: boolean }, type: string): Promise<boolean> {
  if (session.isAdmin) return true;
  const perm = type === 'xml' ? 'content.files' : `content.${type}s`;
  const resolved = await resolveRole({ userId: session.userId, email: session.email }).catch(() => null);
  return !!resolved && hasPermission(resolved, perm);
}

async function isElevated(session: { userId?: string; email?: string; isAdmin?: boolean }): Promise<boolean> {
  if (session.isAdmin) return true;
  const resolved = await resolveRole({ userId: session.userId, email: session.email }).catch(() => null);
  return !!resolved && resolved.role !== 'user';
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    // Circuit breaker: fail fast in seconds when the backend is drowning.
    if (!(await backendAcceptsWrites())) {
      return NextResponse.json(
        { ok: false, error: 'The storage service is briefly throttled — your data is safe; please retry in a moment.', retryable: true },
        { status: 503 }
      );
    }
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

    // Passive keep-alive: every real view of an externally-hosted file
    // registers activity (resets getshared's 30-day expiry, keeps qu.ax warm).
    // Fire-and-forget — the cron is the guarantee, this is a bonus.
    if (isGetsharedUrl(resource.downloadUrl)) {
      void pingGetsharedFile(resource.downloadUrl as string, 8000).catch(() => {});
    } else if (isQuaxUrl(resource.downloadUrl)) {
      void pingQuaxFile(resource.downloadUrl as string, 8000).catch(() => {});
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
    // Circuit breaker: fail fast in seconds when the backend is drowning.
    if (!(await backendAcceptsWrites())) {
      return NextResponse.json(
        { ok: false, error: 'The storage service is briefly throttled — your data is safe; please retry in a moment.', retryable: true },
        { status: 503 }
      );
    }
    const { searchParams } = new URL(request.url);
    const type = isResourceType(searchParams.get('type')) ? searchParams.get('type') : null;
    const xmlSource = isXmlSource(searchParams.get('xmlSource')) ? searchParams.get('xmlSource') : null;

    const sessionResult = await getSession();
    if (sessionResult.status !== 'ok') {
      return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 });
    }
    const session = sessionResult.session;

    const elevated = await isElevated(session);
    const resource = await locateResource(id, type, xmlSource, elevated);
    if (!resource) {
      return NextResponse.json({ ok: false, error: 'Resource not found' }, { status: 404 });
    }

    // Owner, root, or staff with the matching content.* permission
    const isOwner = resource.ownerId === session.userId;
    if (!isOwner && !(await contentPermFor(session, resource.type))) {
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

    // featured needs the content.feature permission (root bypasses)
    if (typeof featured === 'boolean') {
      const canFeature = session.isAdmin
        ? true
        : await resolveRole({ userId: session.userId, email: session.email })
            .then((r) => hasPermission(r, 'content.feature'))
            .catch(() => false);
      if (!canFeature) {
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

    const elevatedDel = await isElevated(session);
    const resource = await locateResource(id, type, xmlSource, elevatedDel);
    if (!resource) {
      // IDEMPOTENT delete: V5 reads are authoritative, so a locate miss
      // means the row is already gone — but the caller may carry a stale or
      // wrong type param, so REAL idempotent deletes still go out to every
      // resource collection (each a no-op when absent). Nothing is UI-only.
      await blindDeleteResource(id);
      const { invalidateResources } = await import('@/lib/cache');
      invalidateResources();
      // Fire-and-forget: sweep legacy V4 tombstone debris (bounded, throttled).
      void purgeLegacyTombstones().catch(() => {});
      return NextResponse.json({ ok: true, alreadyDeleted: true });
    }

    const isOwner = resource.ownerId === session.userId;
    if (!isOwner && !(await contentPermFor(session, resource.type))) {
      return NextResponse.json(
        { ok: false, error: 'Not authorized to delete this resource' },
        { status: 403 }
      );
    }

    // Delete the OnyxBase file (best-effort; also delete thumbnail if present).
    // ext: records hold no backend bytes (URL-only) — nothing to delete.
    // V5 deletes the blob permanently; a V5 404 falls through to the legacy
    // V4 store delete so pre-V5 files are really removed too.
    if (resource.fileId && !resource.fileId.startsWith('ext:')) {
      try {
        await deleteFile(resource.fileId);
      } catch (e) {
        console.warn('[resources/delete] failed to delete file', resource.fileId, e);
      }
      // Also purge the lossless byte-store shards (rb:*) for this fileKey —
      // legacy-era images parked original bytes in KV; without this they
      // would leak in KV + the Telegram snapshot forever. Idempotent.
      void deleteImageBytes(resource.fileId).catch(() => {});
    }
    if (resource.thumbnailFileId) {
      try {
        await deleteFile(resource.thumbnailFileId);
      } catch (e) {
        console.warn('[resources/delete] failed to delete thumbnail', resource.thumbnailFileId, e);
      }
      void deleteImageBytes(resource.thumbnailFileId).catch(() => {});
    }

    // V5-native deterministic delete: ONE authoritative row delete on the
    // exact collection (durable SQLite soft-delete + Telegram mirror op +
    // ~1-2s kv-delta convergence to every engine instance). Idempotent —
    // ghosts can never error, deleted ids can never resurrect.
    const result = await deleteResourceVerified(id, resource.type, resource.xmlSource);

    // Fire-and-forget: sweep legacy V4 tombstone debris (bounded, throttled).
    void purgeLegacyTombstones().catch(() => {});

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
