/**
 * GET /api/resources/verify
 * Lightweight post-upload verification (PRD §49) + orphan recovery probe (PRD §23).
 *
 * After Phase 2 (registration) the client calls this to confirm the record
 * is durably readable before showing "Upload complete". It performs a cheap
 * single-record read with a few retries — NOT a full collection reload.
 *
 * Query params:
 *   - id (required): resource id
 *   - type (required): 'image' | 'clip' | 'xml'
 *   - xmlSource (optional): 'community' | 'admin'
 *
 * Visibility: published resources verify for anyone; unpublished only for
 * owner/admin; admin XMLs only for admin.
 *
 * Returns: { ok: true, verified: true, resource } or { ok: true, verified: false }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import {
  verifyResource,
  type ResourceType,
  type XmlSource,
} from '@/lib/resources';

export const dynamic = 'force-dynamic';

function isResourceType(v: string | null): v is ResourceType {
  return v === 'image' || v === 'clip' || v === 'xml';
}
function isXmlSource(v: string | null): v is XmlSource {
  return v === 'community' || v === 'admin';
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const typeParam = searchParams.get('type');
    const xmlSourceParam = searchParams.get('xmlSource');

    if (!id || !isResourceType(typeParam)) {
      return NextResponse.json(
        { ok: false, error: 'Missing or invalid "id" / "type"' },
        { status: 400 }
      );
    }
    const xmlSource = isXmlSource(xmlSourceParam) ? xmlSourceParam : undefined;

    const sessionResult = await getSession();
    const session = sessionResult.status === 'ok' ? sessionResult.session : null;
    const isAdmin = session?.isAdmin === true;

    if (typeParam === 'xml' && xmlSource === 'admin' && !isAdmin) {
      return NextResponse.json({ ok: false, error: 'Admin access required' }, { status: 403 });
    }

    const { verified, resource, attempts } = await verifyResource(id, typeParam, xmlSource);

    if (!verified || !resource) {
      return NextResponse.json({ ok: true, verified: false, attempts });
    }

    // Enforce visibility before returning the record
    if (resource.type === 'xml' && resource.xmlSource === 'admin' && !isAdmin) {
      return NextResponse.json({ ok: false, error: 'Admin access required' }, { status: 403 });
    }
    if (!resource.published) {
      const isOwner = session && resource.ownerId === session.userId;
      if (!isOwner && !isAdmin) {
        // Record exists but caller may not see it — report unverified rather
        // than leaking existence.
        return NextResponse.json({ ok: true, verified: false, attempts });
      }
    }

    return NextResponse.json({ ok: true, verified: true, resource, attempts });
  } catch (err) {
    console.error('[resources/verify] error:', err);
    return NextResponse.json({ ok: false, error: 'Verification failed' }, { status: 500 });
  }
}
