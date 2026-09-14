/**
 * GET /api/admin/users?q= — staff member directory (perm users.view).
 * Empty q returns the first 40. apiKeys never leave the server.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requirePerm, loadStaffRoleMap, publicRoleFor } from '@/lib/admin';
import { getAllProfiles } from '@/lib/resources';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const gate = await requirePerm('users.view');
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim().toLowerCase();
  try {
    const [profiles, staffMap] = await Promise.all([getAllProfiles(), loadStaffRoleMap()]);
    const users: Array<{
      userId: string;
      username: string;
      displayName: string;
      avatar?: string;
      email?: string;
      role: string;
      createdAt: string;
    }> = [];
    for (const p of profiles) {
      if (!p || !p.userId) continue;
      if (q && !`${p.username || ''} ${p.displayName || ''}`.toLowerCase().includes(q)) continue;
      users.push({
        userId: p.userId,
        username: p.username,
        displayName: p.displayName,
        avatar: p.avatar,
        email: p.email,
        role: publicRoleFor(p, staffMap),
        createdAt: p.createdAt,
      });
      if (users.length >= 40) break;
    }
    return NextResponse.json({ ok: true, users });
  } catch (err) {
    console.error('[admin/users] error:', err);
    return NextResponse.json({ ok: false, error: 'Failed to load users' }, { status: 500 });
  }
}
