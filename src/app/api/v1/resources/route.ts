/**
 * /api/v1/resources — the caller's own resources (API key required).
 *
 * GET  — list own resources. Query: ?type=image|clip|xml (default: all),
 *        ?published=true|false, ?limit=1..200 (default 100).
 * POST — create a resource. Two modes:
 *   Link:   { type: 'xml'|'image'|'clip', title, url, description?, tags?,
 *             category?, published?, clientId? }
 *   Text:   { title, content, fileName?, mimeType?, description?, tags?,
 *             category?, published?, clientId? }  (content ≤ 2 MB; stored as
 *             a real file on the Hub's storage, type 'xml' = generic file)
 *
 * clientId (8-64 chars [A-Za-z0-9_-]) is an idempotency key: retries with
 * the same clientId return the same resource instead of duplicating.
 */
import { NextRequest, NextResponse } from 'next/server';
import { ok, fail, ERROR_CODES, newRequestId } from '@/lib/api-contract';
import { authenticateApiKey } from '@/lib/api-key-auth';
import { isResourceType, serializeResource } from '@/lib/api-v1';
import {
  listResourcesByOwner,
  getResource,
  generateResourceId,
  createResourceVerified,
  type Resource,
  type ResourceType,
} from '@/lib/resources';
import { uploadFileResult, getFileUrl, backendAcceptsWrites } from '@/lib/onyxbase';
import { resolveRole } from '@/lib/admin';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_TEXT_CONTENT_BYTES = 2 * 1024 * 1024; // 2 MB

function authFail(auth: { status: string; retryAfterSecs?: number }, meta: { requestId: string; durationMs: number }) {
  if (auth.status === 'rate-limited') {
    return fail(ERROR_CODES.RATE_LIMITED, 'Too many requests — retry shortly.', meta, {
      status: 429,
      retryable: true,
      retryAfterSecs: auth.retryAfterSecs,
    });
  }
  if (auth.status === 'no-key') {
    return fail(ERROR_CODES.UNAUTHENTICATED, 'API key required — send Authorization: Bearer <key> or X-API-Key: <key>.', meta, { status: 401 });
  }
  return fail(ERROR_CODES.UNAUTHENTICATED, 'Invalid or revoked API key.', meta, { status: 401 });
}

export async function GET(request: NextRequest) {
  const requestId = newRequestId();
  const t0 = Date.now();
  const meta = { requestId, durationMs: 0 };

  const auth = await authenticateApiKey(request);
  if (auth.status !== 'ok') return authFail(auth, meta);

  const { searchParams } = new URL(request.url);
  const typeParam = searchParams.get('type');
  if (typeParam && !isResourceType(typeParam)) {
    meta.durationMs = Date.now() - t0;
    return fail(ERROR_CODES.VALIDATION_ERROR, 'type must be image, clip, or xml.', meta, { status: 400 });
  }
  const publishedParam = searchParams.get('published');
  const limitParam = searchParams.get('limit');
  let limit = 100;
  if (limitParam) {
    const n = parseInt(limitParam, 10);
    if (Number.isNaN(n) || n < 1) {
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.VALIDATION_ERROR, 'limit must be a positive number.', meta, { status: 400 });
    }
    limit = Math.min(n, 200);
  }

  let resources = await listResourcesByOwner(auth.userId).catch(() => [] as Resource[]);
  if (typeParam) resources = resources.filter((r) => r.type === typeParam);
  if (publishedParam === 'true') resources = resources.filter((r) => r.published);
  if (publishedParam === 'false') resources = resources.filter((r) => !r.published);

  meta.durationMs = Date.now() - t0;
  return ok(
    {
      total: resources.length,
      resources: resources.slice(0, limit).map((r) => serializeResource(r, request)),
    },
    meta
  );
}

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  const t0 = Date.now();
  const meta = { requestId, durationMs: 0 };

  const auth = await authenticateApiKey(request);
  if (auth.status !== 'ok') return authFail(auth, meta);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    meta.durationMs = Date.now() - t0;
    return fail(ERROR_CODES.VALIDATION_ERROR, 'A JSON body is required.', meta, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const title = typeof b.title === 'string' ? b.title.trim() : '';
  if (!title || title.length > 200) {
    meta.durationMs = Date.now() - t0;
    return fail(ERROR_CODES.VALIDATION_ERROR, 'title is required (1-200 chars).', meta, { status: 400 });
  }
  const description = typeof b.description === 'string' ? b.description.slice(0, 2000) : '';
  const tags = Array.isArray(b.tags) ? b.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).slice(0, 20) : [];
  const category = typeof b.category === 'string' && b.category.trim() ? b.category.trim().slice(0, 100) : undefined;
  const published = typeof b.published === 'boolean' ? b.published : true;
  const clientId = typeof b.clientId === 'string' && CLIENT_ID_RE.test(b.clientId) ? b.clientId : undefined;

  // Circuit breaker: fail fast when the storage engine is drowning.
  if (!(await backendAcceptsWrites())) {
    meta.durationMs = Date.now() - t0;
    return fail(ERROR_CODES.UPSTREAM_UNAVAILABLE, 'The storage service is briefly throttled — please retry in a moment.', meta, {
      status: 503,
      retryable: true,
    });
  }

  const isText = typeof b.content === 'string' && b.content.length > 0;
  const isLink = typeof b.url === 'string' && /^https?:\/\//i.test(b.url as string);
  if (!isText && !isLink) {
    meta.durationMs = Date.now() - t0;
    return fail(
      ERROR_CODES.VALIDATION_ERROR,
      'Provide either "url" (a http(s) link) or "content" (text file body).',
      meta,
      { status: 400 }
    );
  }

  // ─── Resolve the file + type ─────────────────────────────────────────────
  let fileId: string;
  let downloadUrl: string;
  let fileName: string | undefined;
  let mimeType: string | undefined;
  let size: number | undefined;
  let resourceType: ResourceType;

  if (isText) {
    const content = b.content as string;
    if (content.length > MAX_TEXT_CONTENT_BYTES) {
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.VALIDATION_ERROR, `content exceeds the 2 MB limit (${content.length} bytes).`, meta, { status: 413 });
    }
    resourceType = 'xml'; // generic file bucket (same as the app's File upload)
    fileName = (typeof b.fileName === 'string' && b.fileName.trim()) || 'file.txt';
    mimeType = (typeof b.mimeType === 'string' && b.mimeType.trim()) || 'text/plain';
    const blob = new Blob([content], { type: mimeType });
    size = blob.size;
    const up = await uploadFileResult(blob, fileName, mimeType);
    if (!up.ok || !up.file) {
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.UPLOAD_FAILED, 'File storage failed — retry with the same clientId.', meta, {
        status: 502,
        retryable: true,
      });
    }
    fileId = up.file.fileId;
    downloadUrl = up.file.url || getFileUrl(fileId);
  } else {
    const url = (b.url as string).trim();
    let rawType = typeof b.type === 'string' ? b.type : 'xml';
    if (!isResourceType(rawType)) {
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.VALIDATION_ERROR, 'type must be image, clip, or xml.', meta, { status: 400 });
    }
    resourceType = rawType;
    // Guess the type from the URL when the caller left it generic.
    if (resourceType === 'xml' && /\.(png|jpe?g|gif|webp|avif|bmp|svg)([?#]|$)/i.test(url)) resourceType = 'image';
    if (resourceType === 'xml' && /\.(mp4|webm|mov|mkv|avi)([?#]|$)/i.test(url)) resourceType = 'clip';
    fileId = `ext:${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    downloadUrl = url;
    fileName = typeof b.fileName === 'string' && b.fileName.trim() ? b.fileName.trim() : undefined;
    mimeType = typeof b.mimeType === 'string' && b.mimeType.trim() ? b.mimeType.trim() : undefined;
  }

  // Idempotent id: same clientId → same record.
  const id = generateResourceId(resourceType, clientId);

  // Duplicate prevention: same id + same owner → return the existing record.
  const existing = await getResource(id, resourceType, 'community').catch(() => null);
  if (existing && existing.ownerId === auth.userId) {
    meta.durationMs = Date.now() - t0;
    return ok({ resource: serializeResource(existing, request), deduped: true }, meta);
  }

  const now = new Date().toISOString();
  const { role: authorRole } = await resolveRole({
    userId: auth.userId,
    email: auth.profile?.email,
  }).catch(() => ({ role: 'user' as const }));

  const resource: Resource = {
    id,
    type: resourceType,
    ownerId: auth.userId,
    ownerName: auth.profile?.displayName || auth.profile?.username || 'Unknown',
    title,
    description,
    fileId,
    downloadUrl,
    fileName,
    mimeType,
    size,
    status: 'ready',
    clientId,
    storageUrl: isText ? getFileUrl(fileId) : downloadUrl,
    authorRole,
    isOwnerAdmin: authorRole !== 'user',
    tags,
    category,
    published,
    featured: false,
    xmlSource: resourceType === 'xml' ? 'community' : undefined,
    createdAt: now,
    updatedAt: now,
  };

  const result = await createResourceVerified(resource, { retries: 2 });
  const { invalidateResources } = await import('@/lib/cache');
  invalidateResources();

  if (!result.ok) {
    meta.durationMs = Date.now() - t0;
    // The file (text mode) is kept — retry registration with the same clientId.
    return fail(ERROR_CODES.UPLOAD_FAILED, 'Registration failed — retry with the same clientId.', meta, {
      status: 502,
      retryable: true,
    });
  }

  meta.durationMs = Date.now() - t0;
  return ok({ resource: serializeResource(resource, request) }, meta);
}
