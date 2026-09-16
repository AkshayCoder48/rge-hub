/**
 * Shared helpers for the PUBLIC API v1 routes (/api/v1/*).
 */

import { NextRequest, NextResponse } from 'next/server';
import { allow, clientIpFrom } from './rate-limit';
import { resourceExtension, type Resource, type ResourceType } from './resources';
import type { ApiMeta } from './api-contract';

/** Absolute on-domain URL (honors NEXT_PUBLIC_SITE_URL, then proxy headers). */
export function absoluteUrl(request: NextRequest, path: string): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '');
  if (configured) return `${configured}${path}`;
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const proto =
    request.headers.get('x-forwarded-proto') || (host?.includes('localhost') ? 'http' : 'https');
  if (host) return `${proto}://${host}${path}`;
  return path;
}

/** Serialize a resource for public API output: raw record + computed URLs. */
export function serializeResource(r: Resource, request: NextRequest) {
  return {
    ...r,
    extension: resourceExtension(r),
    url: r.downloadUrl || absoluteUrl(request, `/api/f/${r.fileId}`),
    fileUrl: absoluteUrl(request, `/api/f/${r.fileId}`),
    apiUrl: absoluteUrl(request, `/api/v1/resources/${r.id}`),
    thumbnailUrl: r.thumbnailUrl || (r.thumbnailFileId ? absoluteUrl(request, `/api/f/${r.thumbnailFileId}`) : undefined),
  };
}

/** Light per-IP limiter for unauthenticated public endpoints. */
export function guardPublicIp(
  request: NextRequest,
  limit: number,
  windowMs = 60_000
): { ok: true } | { ok: false; retryAfterSecs: number } {
  const rl = allow(`apiv1-ip:${clientIpFrom(request)}`, limit, windowMs);
  return rl.allowed ? { ok: true } : { ok: false, retryAfterSecs: rl.retryAfterSecs ?? 60 };
}

export function isResourceType(v: unknown): v is ResourceType {
  return v === 'image' || v === 'clip' || v === 'xml';
}

/** Uniform 429 body builder (meta from the calling route). */
export function tooManyRequests(retryAfterSecs: number, meta: ApiMeta) {
  const res = NextResponse.json(
    {
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests — slow down and retry shortly.',
        retryable: true,
        retryAfterSecs,
      },
      requestId: meta.requestId,
    },
    { status: 429, headers: { 'retry-after': String(retryAfterSecs), 'x-request-id': meta.requestId } }
  );
  return res;
}
