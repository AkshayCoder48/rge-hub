/**
 * /api/v1/resources/[id] — a single resource.
 *
 * GET    — detail. Public for published resources; drafts need the owner's
 *          key. Admin XMLs are excluded from the public API entirely.
 * PATCH  — update (owner's key only): title, description, tags, category,
 *          published.
 * DELETE — delete (owner's key only).
 */
import { NextRequest } from 'next/server';
import { ok, fail, ERROR_CODES, newRequestId } from '@/lib/api-contract';
import { authenticateApiKey } from '@/lib/api-key-auth';
import { serializeResource } from '@/lib/api-v1';
import {
  getResource,
  updateResource,
  deleteResourceVerified,
  type Resource,
} from '@/lib/resources';
import { backendAcceptsWrites } from '@/lib/onyxbase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const RESOURCE_ID_RE = /^(img|clip|xml)_[A-Za-z0-9_-]{4,48}$/;

type Auth =
  | { status: 'ok'; userId: string; isAdmin: boolean }
  | { status: 'no-key' | 'invalid' | 'rate-limited'; retryAfterSecs?: number };

async function softAuth(request: NextRequest): Promise<Auth> {
  const auth = await authenticateApiKey(request);
  if (auth.status === 'ok') return { status: 'ok', userId: auth.userId, isAdmin: auth.isAdmin };
  return { status: auth.status, ...(auth.status === 'rate-limited' ? { retryAfterSecs: auth.retryAfterSecs } : {}) };
}

function authRequired(meta: { requestId: string }, a: Auth) {
  if (a.status === 'rate-limited') {
    return fail(ERROR_CODES.RATE_LIMITED, 'Too many requests — retry shortly.', meta as never, {
      status: 429,
      retryable: true,
      retryAfterSecs: a.retryAfterSecs,
    });
  }
  return fail(ERROR_CODES.UNAUTHENTICATED, 'API key required — send Authorization: Bearer <key> or X-API-Key: <key>.', meta as never, { status: 401 });
}

/** Locate a PUBLIC-API-visible resource: images, clips, community XMLs.
 *  Admin XMLs are internal and never exposed on /api/v1. */
async function locate(id: string): Promise<Resource | null> {
  const img = await getResource(id, 'image').catch(() => null);
  if (img) return img;
  const clip = await getResource(id, 'clip').catch(() => null);
  if (clip) return clip;
  return getResource(id, 'xml', 'community').catch(() => null);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = newRequestId();
  const t0 = Date.now();
  const meta = { requestId, durationMs: 0 };

  const { id } = await params;
  if (!RESOURCE_ID_RE.test(id)) {
    meta.durationMs = Date.now() - t0;
    return fail(ERROR_CODES.VALIDATION_ERROR, 'Malformed resource id.', meta, { status: 400 });
  }

  const auth = await softAuth(request);
  if (auth.status === 'rate-limited') return authRequired(meta, auth);

  const resource = await locate(id);
  if (!resource) {
    meta.durationMs = Date.now() - t0;
    return fail(ERROR_CODES.NOT_FOUND, 'Resource not found.', meta, { status: 404 });
  }

  // Draft visibility: owner only (admins too — same rule as the app).
  if (!resource.published) {
    if (auth.status !== 'ok' || (auth.userId !== resource.ownerId && !auth.isAdmin)) {
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.NOT_FOUND, 'Resource not found.', meta, { status: 404 });
    }
  }

  meta.durationMs = Date.now() - t0;
  return ok({ resource: serializeResource(resource, request) }, meta);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = newRequestId();
  const t0 = Date.now();
  const meta = { requestId, durationMs: 0 };

  const auth = await softAuth(request);
  if (auth.status !== 'ok') return authRequired(meta, auth);

  const { id } = await params;
  if (!RESOURCE_ID_RE.test(id)) {
    meta.durationMs = Date.now() - t0;
    return fail(ERROR_CODES.VALIDATION_ERROR, 'Malformed resource id.', meta, { status: 400 });
  }

  const resource = await locate(id);
  if (!resource) {
    meta.durationMs = Date.now() - t0;
    return fail(ERROR_CODES.NOT_FOUND, 'Resource not found.', meta, { status: 404 });
  }
  if (resource.ownerId !== auth.userId && !auth.isAdmin) {
    meta.durationMs = Date.now() - t0;
    return fail(ERROR_CODES.FORBIDDEN, 'You can only edit your own resources.', meta, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    meta.durationMs = Date.now() - t0;
    return fail(ERROR_CODES.VALIDATION_ERROR, 'A JSON body is required.', meta, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  if (typeof b.title === 'string') {
    const t = b.title.trim();
    if (!t || t.length > 200) {
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.VALIDATION_ERROR, 'title must be 1-200 chars.', meta, { status: 400 });
    }
    resource.title = t;
  }
  if (typeof b.description === 'string') resource.description = b.description.slice(0, 2000);
  if (Array.isArray(b.tags)) {
    resource.tags = b.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).slice(0, 20);
  }
  if (typeof b.category === 'string' && b.category.trim()) resource.category = b.category.trim().slice(0, 100);
  if (typeof b.published === 'boolean') resource.published = b.published;
  resource.updatedAt = new Date().toISOString();

  const saved = await updateResource(resource);
  if (!saved) {
    meta.durationMs = Date.now() - t0;
    return fail(ERROR_CODES.UPSTREAM_UNAVAILABLE, 'Update failed — please retry.', meta, { status: 502, retryable: true });
  }
  const { invalidateResources } = await import('@/lib/cache');
  invalidateResources();

  meta.durationMs = Date.now() - t0;
  return ok({ resource: serializeResource(resource, request) }, meta);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = newRequestId();
  const t0 = Date.now();
  const meta = { requestId, durationMs: 0 };

  const auth = await softAuth(request);
  if (auth.status !== 'ok') return authRequired(meta, auth);

  const { id } = await params;
  if (!RESOURCE_ID_RE.test(id)) {
    meta.durationMs = Date.now() - t0;
    return fail(ERROR_CODES.VALIDATION_ERROR, 'Malformed resource id.', meta, { status: 400 });
  }

  if (!(await backendAcceptsWrites())) {
    meta.durationMs = Date.now() - t0;
    return fail(ERROR_CODES.UPSTREAM_UNAVAILABLE, 'The storage service is briefly throttled — please retry in a moment.', meta, {
      status: 503,
      retryable: true,
    });
  }

  const resource = await locate(id);
  if (!resource) {
    meta.durationMs = Date.now() - t0;
    // Idempotent delete: already gone = success.
    return ok({ deleted: true, id, alreadyDeleted: true }, meta);
  }
  if (resource.ownerId !== auth.userId && !auth.isAdmin) {
    meta.durationMs = Date.now() - t0;
    return fail(ERROR_CODES.FORBIDDEN, 'You can only delete your own resources.', meta, { status: 403 });
  }

  const result = await deleteResourceVerified(id, resource.type, resource.xmlSource);
  if (!result.deleted) {
    meta.durationMs = Date.now() - t0;
    return fail(ERROR_CODES.UPSTREAM_UNAVAILABLE, 'Delete failed — please retry.', meta, { status: 502, retryable: true });
  }
  const { invalidateResources } = await import('@/lib/cache');
  invalidateResources();

  meta.durationMs = Date.now() - t0;
  return ok({ deleted: true, id }, meta);
}
