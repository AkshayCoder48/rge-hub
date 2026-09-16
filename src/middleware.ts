/**
 * CORS for the PUBLIC API surface (/api/v1/*) only.
 *
 * The public API authenticates with API keys (Authorization / X-API-Key) —
 * never cookies — so a permissive origin policy is safe: a browser on any
 * origin can call the API, but can only act with a key the user explicitly
 * gives it. The rest of the app (session-cookie routes) is untouched.
 *
 * Preflight: OPTIONS on any /api/v1 path → 204 with CORS headers.
 * Actual responses: CORS headers appended to every /api/v1 response.
 */

import { NextResponse, type NextRequest } from 'next/server';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, X-API-Key, Content-Type, Idempotency-Key, X-Request-Id',
  'Access-Control-Expose-Headers': 'x-request-id',
  'Access-Control-Max-Age': '86400',
};

export function middleware(req: NextRequest) {
  if (req.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
  }
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

export const config = {
  matcher: ['/api/v1/:path*'],
};
