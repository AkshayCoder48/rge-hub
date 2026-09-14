/**
 * GET /api/admin/me — own role + permissions (drives sidebar/panel gating).
 * Auth required. Never fails hard: KV trouble degrades to plain user.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { resolveRole } from '@/lib/admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const sr = await getSession();
  if (sr.status !== 'ok') {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 });
  }
  const resolved = await resolveRole({ userId: sr.session.userId, email: sr.session.email }).catch(
    () => ({ role: 'user' as const, permissions: [] as string[] })
  );
  return NextResponse.json({
    ok: true,
    role: resolved.role,
    permissions: resolved.permissions,
    isAdmin: sr.session.isAdmin === true,
  });
}
