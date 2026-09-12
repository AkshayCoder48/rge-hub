/**
 * POST /api/resources/create
 * Create a new resource record.
 *
 * CRITICAL: ownerId is assigned from the authenticated session, never from client input.
 * The resource is stored ONCE in OnyxBase — both profile and community reference the same record.
 *
 * Auth required.
 * Body: {
 *   type, title, description, fileId, thumbnailFileId?, tags?, category?,
 *   duration?, published?, xmlSource?, downloadUrl?, thumbnailUrl?
 * }
 *
 * ownerId / ownerName come from the session (server-side, never trusted from client).
 * For xmlSource='admin', the caller must be an admin.
 *
 * Returns: { ok: true, resource }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import {
  createResource,
  generateResourceId,
  type Resource,
  type ResourceType,
  type XmlSource,
} from '@/lib/resources';
import { getFileUrl } from '@/lib/onyxbase';

export async function POST(request: NextRequest) {
  try {
    const sessionResult = await getSession();
    if (sessionResult.status !== 'ok') {
      return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 });
    }
    const session = sessionResult.session;

    const body = await request.json();
    const {
      type,
      title,
      description,
      fileId,
      thumbnailFileId,
      tags,
      category,
      duration,
      published,
      xmlSource,
      downloadUrl,
      thumbnailUrl,
    } = body || {};

    // Validate
    if (!type || (type !== 'image' && type !== 'clip' && type !== 'xml')) {
      return NextResponse.json({ ok: false, error: 'Invalid or missing "type"' }, { status: 400 });
    }
    if (!title || typeof title !== 'string' || !title.trim()) {
      return NextResponse.json({ ok: false, error: 'Title is required' }, { status: 400 });
    }
    if (!fileId || typeof fileId !== 'string') {
      return NextResponse.json({ ok: false, error: 'fileId is required' }, { status: 400 });
    }

    const resourceType = type as ResourceType;
    let resourceXmlSource: XmlSource | undefined = undefined;
    if (resourceType === 'xml') {
      resourceXmlSource = xmlSource === 'admin' ? 'admin' : 'community';
      if (resourceXmlSource === 'admin' && !session.isAdmin) {
        return NextResponse.json(
          { ok: false, error: 'Admin access required to create admin XMLs' },
          { status: 403 }
        );
      }
    }

    const now = new Date().toISOString();
    const id = generateResourceId(resourceType);

    // CRITICAL: ownerId comes from the authenticated session, never from client input
    const resource: Resource = {
      id,
      type: resourceType,
      ownerId: session.userId,
      ownerName: session.displayName || session.username,
      title: title.trim(),
      description: typeof description === 'string' ? description : '',
      fileId,
      thumbnailFileId: typeof thumbnailFileId === 'string' ? thumbnailFileId : undefined,
      downloadUrl: typeof downloadUrl === 'string' ? downloadUrl : getFileUrl(fileId),
      thumbnailUrl: typeof thumbnailUrl === 'string'
        ? thumbnailUrl
        : (typeof thumbnailFileId === 'string' ? getFileUrl(thumbnailFileId) : undefined),
      tags: Array.isArray(tags) ? tags.filter((t: unknown) => typeof t === 'string') : [],
      category: typeof category === 'string' && category.trim() ? category.trim() : undefined,
      duration: typeof duration === 'number' && !Number.isNaN(duration) ? duration : undefined,
      published: typeof published === 'boolean' ? published : true,
      featured: false,
      xmlSource: resourceXmlSource,
      createdAt: now,
      updatedAt: now,
    };

    const ok = await createResource(resource);
    if (!ok) {
      return NextResponse.json(
        { ok: false, error: 'Failed to persist resource' },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, resource });
  } catch (err) {
    console.error('[resources/create] error:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to create resource' },
      { status: 500 }
    );
  }
}
