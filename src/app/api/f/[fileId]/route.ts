/**
 * GET /api/f/[fileId]
 * Stable on-domain file URL — redirects to the backing storage object.
 *
 * Every uploaded asset keeps a permanent address on OUR domain
 * (https://<domain>/api/f/<fileId>) even if the storage host changes.
 * A 302 redirect is used (not a proxy) so large files never flow through
 * the application server (PRD §4).
 *
 * The redirect target is cacheable basically forever: fileIds are immutable.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFileUrl } from '@/lib/onyxbase';

export const dynamic = 'force-dynamic';

const FILE_ID_RE = /^[A-Za-z0-9_-]{4,128}$/;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const { fileId } = await params;
  if (!FILE_ID_RE.test(fileId)) {
    return NextResponse.json({ ok: false, error: 'Invalid file id' }, { status: 400 });
  }
  return NextResponse.redirect(getFileUrl(fileId), {
    status: 302,
    headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
}
