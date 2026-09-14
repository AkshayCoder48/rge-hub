/**
 * /api/admin/staff — admin/moderator management (admin.manage only).
 *
 * GET    → list all staff with live profiles
 * POST   → { username, role: 'admin'|'moderator', permissions[] } promote
 * PATCH  → { userId, role?, permissions? } edit
 * DELETE → ?userId= remove (back to normal user; account+content untouched)
 *
 * Guards: root users can never be targeted (env root is permanent),
 * nobody can remove their own access, roles limited to admin|moderator.
 */
import { NextRequest, NextResponse } from 'next/server';
import { kvSet, kvDeleteIdempotent, kvExport, stripExportPrefix, ONYXBASE_COLLECTIONS } from '@/lib/onyxbase';
import { getProfile, getProfileByUsername } from '@/lib/resources';
import { isAdminUser } from '@/lib/session';
import {
  requirePerm,
  getStaffRecord,
  cleanPermissions,
  logActivity,
  PERMISSIONS,
  type StaffRecord,
} from '@/lib/admin';

export const dynamic = 'force-dynamic';

function isRootTarget(profile: { email?: string; userId?: string } | null): boolean {
  if (!profile) return false;
  return isAdminUser({ email: profile.email, userId: profile.userId });
}

export async function GET() {
  const gate = await requirePerm('admin.manage');
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }
  const all = await kvExport(ONYXBASE_COLLECTIONS.ADMINS).catch(() => ({}) as Record<string, unknown>);
  const rows: Array<{
    userId: string;
    username: string;
    displayName: string;
    avatar?: string;
    role: string;
    permissions: string[];
    updatedBy: string;
    updatedAt: string;
  }> = [];
  for (const rawKey of Object.keys(all)) {
    const key = stripExportPrefix(rawKey, ONYXBASE_COLLECTIONS.ADMINS);
    if (!key.startsWith('role:')) continue;
    const rec = all[rawKey] as StaffRecord | null;
    if (!rec || (rec.role !== 'admin' && rec.role !== 'moderator') || !rec.userId) continue;
    const profile = await getProfile(rec.userId).catch(() => null);
    rows.push({
      userId: rec.userId,
      username: profile?.username || rec.username,
      displayName: profile?.displayName || rec.username,
      avatar: profile?.avatar,
      role: rec.role,
      permissions: rec.permissions || [],
      updatedBy: rec.updatedBy,
      updatedAt: rec.updatedAt,
    });
  }
  rows.sort((a, b) => a.username.localeCompare(b.username));
  return NextResponse.json({ ok: true, staff: rows, catalog: PERMISSIONS });
}

export async function POST(request: NextRequest) {
  const gate = await requirePerm('admin.manage');
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }
  const body = await request.json().catch(() => null);
  const username = typeof body?.username === 'string' ? body.username.trim().toLowerCase() : '';
  const role = body?.role;
  if (!username) {
    return NextResponse.json({ ok: false, error: 'username is required' }, { status: 400 });
  }
  if (role !== 'admin' && role !== 'moderator') {
    return NextResponse.json({ ok: false, error: "role must be 'admin' or 'moderator'" }, { status: 400 });
  }
  const profile = await getProfileByUsername(username).catch(() => null);
  if (!profile) {
    return NextResponse.json({ ok: false, error: `User @${username} not found` }, { status: 404 });
  }
  if (isRootTarget(profile)) {
    return NextResponse.json({ ok: false, error: 'The Root Admin cannot be modified here' }, { status: 403 });
  }
  const rec: StaffRecord = {
    userId: profile.userId,
    username: profile.username,
    role,
    permissions: cleanPermissions(body?.permissions),
    updatedBy: gate.username,
    updatedAt: new Date().toISOString(),
  };
  const ok = await kvSet(`role:${profile.userId}`, rec, ONYXBASE_COLLECTIONS.ADMINS).catch(() => false);
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: 'Storage is busy — please retry shortly.', retryable: true },
      { status: 503 }
    );
  }
  await logActivity(gate.userId, gate.displayName, `promoted @${profile.username} to ${role}`, profile.userId);
  return NextResponse.json({ ok: true, staff: rec });
}

export async function PATCH(request: NextRequest) {
  const gate = await requirePerm('admin.manage');
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }
  const body = await request.json().catch(() => null);
  const userId = typeof body?.userId === 'string' ? body.userId : '';
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'userId is required' }, { status: 400 });
  }
  const rec = await getStaffRecord(userId);
  if (!rec) {
    return NextResponse.json({ ok: false, error: 'User is not staff — use Add first' }, { status: 404 });
  }
  const profile = await getProfile(userId).catch(() => null);
  if (isRootTarget(profile)) {
    return NextResponse.json({ ok: false, error: 'The Root Admin cannot be modified here' }, { status: 403 });
  }
  if (body?.role !== undefined && body.role !== 'admin' && body.role !== 'moderator') {
    return NextResponse.json({ ok: false, error: "role must be 'admin' or 'moderator'" }, { status: 400 });
  }
  const next: StaffRecord = {
    ...rec,
    username: profile?.username || rec.username,
    role: (body?.role as StaffRecord['role']) || rec.role,
    permissions: body?.permissions !== undefined ? cleanPermissions(body.permissions) : rec.permissions,
    updatedBy: gate.username,
    updatedAt: new Date().toISOString(),
  };
  const ok = await kvSet(`role:${userId}`, next, ONYXBASE_COLLECTIONS.ADMINS).catch(() => false);
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: 'Storage is busy — please retry shortly.', retryable: true },
      { status: 503 }
    );
  }
  await logActivity(
    gate.userId,
    gate.displayName,
    `updated @${next.username} (${next.role}, ${next.permissions.length} permissions)`,
    userId
  );
  return NextResponse.json({ ok: true, staff: next });
}

export async function DELETE(request: NextRequest) {
  const gate = await requirePerm('admin.manage');
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId') || '';
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'userId is required' }, { status: 400 });
  }
  if (userId === gate.userId) {
    return NextResponse.json({ ok: false, error: 'You cannot remove your own access' }, { status: 403 });
  }
  const rec = await getStaffRecord(userId);
  if (!rec) {
    return NextResponse.json({ ok: true, removed: false });
  }
  const profile = await getProfile(userId).catch(() => null);
  if (isRootTarget(profile)) {
    return NextResponse.json({ ok: false, error: 'The Root Admin cannot be modified here' }, { status: 403 });
  }
  const deleted = await kvDeleteIdempotent(`role:${userId}`, ONYXBASE_COLLECTIONS.ADMINS).catch(() => false);
  if (!deleted) {
    return NextResponse.json(
      { ok: false, error: 'Storage is busy — please retry shortly.', retryable: true },
      { status: 503 }
    );
  }
  await logActivity(
    gate.userId,
    gate.displayName,
    `removed admin access from @${profile?.username || rec.username}`,
    userId
  );
  return NextResponse.json({ ok: true, removed: true });
}
