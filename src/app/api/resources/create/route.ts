/**
 * POST /api/resources/create
 * Phase 2 of the two-phase upload pipeline (PRD §9): storage ref → DB record.
 *
 * CRITICAL: ownerId is assigned from the authenticated session, never from client input.
 * The resource is stored ONCE in OnyxBase — both profile and community reference the same record.
 *
 * Reliability (PRD §14, §24, §25, §26, §49):
 * - Accepts a stable `clientId` idempotency key: retries reuse the SAME
 *   resource id, so a retried registration never creates duplicates.
 * - Verifies the record is readable (read-your-write) before returning
 *   success. "Upload complete" is only valid after this step.
 * - If the write succeeded but verification is still pending, answers
 *   202 with code DATABASE_VERIFICATION_ERROR + retryable:true and the
 *   resource payload, so the client can retry verification WITHOUT
 *   re-uploading the file or deleting anything (PRD §22, §23).
 *
 * Auth required.
 * Body: {
 *   type, title, description, fileId, thumbnailFileId?, tags?, category?,
 *   duration?, published?, xmlSource?, downloadUrl?, thumbnailUrl?,
 *   clientId?, fileName?, mimeType?, size?
 * }
 *
 * Returns: { ok: true, resource, verified, deduped? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import {
  createResourceVerified,
  getResource,
  generateResourceId,
  type Resource,
  type ResourceType,
  type XmlSource,
} from '@/lib/resources';
import { getFileUrl } from '@/lib/onyxbase';
import type { UploadErrorCode } from '@/lib/upload-errors';

export const dynamic = 'force-dynamic';

function fail(code: UploadErrorCode, error: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, code, error, ...extra }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const sessionResult = await getSession();
    if (sessionResult.status !== 'ok') {
      return fail('AUTH_ERROR', 'Authentication required', 401);
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
      clientId,
      fileName,
      mimeType,
      size,
    } = body || {};

    // Validate
    if (!type || (type !== 'image' && type !== 'clip' && type !== 'xml')) {
      return fail('UPLOAD_STORAGE_ERROR', 'Invalid or missing "type"', 400);
    }
    if (!title || typeof title !== 'string' || !title.trim()) {
      return fail('UPLOAD_STORAGE_ERROR', 'Title is required', 400);
    }
    if (!fileId || typeof fileId !== 'string') {
      return fail('UPLOAD_STORAGE_ERROR', 'fileId is required', 400);
    }

    const resourceType = type as ResourceType;
    let resourceXmlSource: XmlSource | undefined = undefined;
    if (resourceType === 'xml') {
      resourceXmlSource = xmlSource === 'admin' ? 'admin' : 'community';
      if (resourceXmlSource === 'admin' && !session.isAdmin) {
        return fail('AUTH_ERROR', 'Admin access required to create admin XMLs', 403);
      }
    }

    // Idempotent id: retries with the same clientId map to the same record.
    const id = generateResourceId(
      resourceType,
      typeof clientId === 'string' ? clientId : undefined
    );

    // Duplicate prevention (PRD §26): same id + same owner + same file → return existing.
    const existing = await getResource(id, resourceType, resourceXmlSource).catch(() => null);
    if (existing && existing.ownerId === session.userId && existing.fileId === fileId) {
      return NextResponse.json({ ok: true, resource: existing, verified: true, deduped: true });
    }

    const now = new Date().toISOString();

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
      thumbnailUrl:
        typeof thumbnailUrl === 'string'
          ? thumbnailUrl
          : typeof thumbnailFileId === 'string'
            ? getFileUrl(thumbnailFileId)
            : undefined,
      fileName: typeof fileName === 'string' ? fileName : undefined,
      mimeType: typeof mimeType === 'string' ? mimeType : undefined,
      size: typeof size === 'number' && !Number.isNaN(size) ? size : undefined,
      status: 'ready',
      clientId: typeof clientId === 'string' ? clientId : undefined,
      tags: Array.isArray(tags) ? tags.filter((t: unknown) => typeof t === 'string') : [],
      category: typeof category === 'string' && category.trim() ? category.trim() : undefined,
      duration: typeof duration === 'number' && !Number.isNaN(duration) ? duration : undefined,
      published: typeof published === 'boolean' ? published : true,
      featured: false,
      xmlSource: resourceXmlSource,
      createdAt: now,
      updatedAt: now,
    };

    const t0 = Date.now();
    const result = await createResourceVerified(resource);
    const database_write_ms = Date.now() - t0;

    // Invalidate server-side cache so next read sees the new resource
    const { invalidateResources } = await import('@/lib/cache');
    invalidateResources();

    if (!result.ok) {
      // Storage upload succeeded but DB registration failed — the file is
      // kept (orphan recovery, PRD §23); the client retries registration.
      return fail('DATABASE_REGISTRATION_ERROR', 'Failed to persist resource record', 500, {
        retryable: true,
        resource,
      });
    }

    if (!result.verified) {
      // Write accepted but not yet readable (eventual consistency).
      // NOT a permanent failure — client retries verification.
      return NextResponse.json(
        {
          ok: false,
          code: 'DATABASE_VERIFICATION_ERROR',
          error: 'Resource saved but not yet confirmed. Retrying…',
          retryable: true,
          resource,
          database_write_ms,
          verifyAttempts: result.attempts,
        },
        { status: 202 }
      );
    }

    return NextResponse.json({
      ok: true,
      resource,
      verified: true,
      database_write_ms,
      verifyAttempts: result.attempts,
    });
  } catch (err) {
    console.error('[resources/create] error:', err);
    return fail('DATABASE_REGISTRATION_ERROR', 'Failed to create resource', 500, {
      retryable: true,
    });
  }
}
