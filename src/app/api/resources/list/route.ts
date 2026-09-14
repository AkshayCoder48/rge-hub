/**
 * GET /api/resources/list
 * List resources with optional filtering.
 *
 * Query params:
 *   - type: 'image' | 'clip' | 'xml'
 *   - xmlSource: 'community' | 'admin' (only for type=xml)
 *   - owner: userId
 *   - search: query string
 *   - published: 'true' | 'false' | 'all'  (default 'true')
 *
 * Access rules:
 *   - Default: only published resources are returned.
 *   - published=false or owner set → auth required; non-admins can only see their own unpublished resources.
 *   - Admin can see all (incl. unpublished).
 *   - For type=xml & xmlSource=admin → only admin can access.
 *
 * Returns: { ok: true, resources: Resource[] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import {
  listResourcesFast,
  listAllPublicResources,
  listResourcesByOwner,
  searchResources,
  type ResourceType,
  type XmlSource,
  type Resource,
} from '@/lib/resources';

function isResourceType(v: string | null): v is ResourceType {
  return v === 'image' || v === 'clip' || v === 'xml';
}
function isXmlSource(v: string | null): v is XmlSource {
  return v === 'community' || v === 'admin';
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const xmlSource = searchParams.get('xmlSource');
    const owner = searchParams.get('owner');
    const search = searchParams.get('search');
    const publishedParam = searchParams.get('published') ?? 'true';
    const wantUnpublished = publishedParam === 'false';
    const wantAll = publishedParam === 'all';

    const sessionResult = await getSession();
    const session = sessionResult.status === 'ok' ? sessionResult.session : null;
    const isAuthenticated = session !== null;
    const isAdmin = session?.isAdmin === true;

    // Admin xmls are privileged — COMPLETELY hidden from non-admins
    if (type === 'xml' && xmlSource === 'admin') {
      if (!isAuthenticated || !isAdmin) {
        return NextResponse.json(
          { ok: false, error: 'Admin access required' },
          { status: 403 }
        );
      }
    }

    // Auth required when requesting unpublished resources
    if (wantUnpublished && !isAuthenticated) {
      return NextResponse.json(
        { ok: false, error: 'Authentication required to view unpublished resources' },
        { status: 401 }
      );
    }

    // Auth required when filtering by owner
    if (owner && !isAuthenticated) {
      return NextResponse.json(
        { ok: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Non-admin requesting unpublished can only see their own
    if (wantUnpublished && isAuthenticated && !isAdmin && owner && owner !== session.userId) {
      return NextResponse.json(
        { ok: false, error: 'Cannot view another user\'s unpublished resources' },
        { status: 403 }
      );
    }

    let resources: Resource[] = [];

    if (search) {
      // searchResources only returns public resources
      resources = await searchResources(search);
      // Optional narrowing by type if provided
      if (isResourceType(type)) {
        resources = resources.filter(r => r.type === type);
      }
      if (isXmlSource(xmlSource)) {
        resources = resources.filter(r => r.xmlSource === xmlSource);
      }
      if (owner) {
        resources = resources.filter(r => r.ownerId === owner);
      }
    } else if (owner) {
      // Filter by owner (uses community xmls + images + clips)
      resources = await listResourcesByOwner(owner);
      if (isResourceType(type)) {
        resources = resources.filter(r => r.type === type);
      }
      if (isXmlSource(xmlSource)) {
        resources = resources.filter(r => r.xmlSource === xmlSource);
      }
      // Non-admin sees only their own published resources unless wantUnpublished/own self
      const isOwn = isAuthenticated && owner === session.userId;
      if (!isAdmin) {
        resources = isOwn && wantUnpublished
          ? resources
          : resources.filter(r => r.published);
      }
    } else if (isResourceType(type)) {
      if (type === 'xml' && !isXmlSource(xmlSource)) {
        // No xmlSource provided — default to community for non-admins
        resources = await listResourcesFast('xml', 'community');
      } else {
        resources = await listResourcesFast(type, isXmlSource(xmlSource) ? xmlSource : undefined);
      }

      // Visibility filtering
      if (!isAdmin) {
        // Non-admins: only published unless it's their own
        resources = resources.filter(r => r.published || (isAuthenticated && r.ownerId === session.userId));
      }
      if (!wantAll && !wantUnpublished) {
        // published=true default — caller only wants published
        if (isAuthenticated) {
          resources = resources.filter(r => r.published || r.ownerId === session.userId);
        } else {
          resources = resources.filter(r => r.published);
        }
      }
    } else {
      // No type filter → public feed (community only, never admin)
      resources = await listAllPublicResources();
    }

    // Final sort by createdAt desc
    resources.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return NextResponse.json({ ok: true, resources });
  } catch (err) {
    console.error('[resources/list] error:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to list resources' },
      { status: 500 }
    );
  }
}
