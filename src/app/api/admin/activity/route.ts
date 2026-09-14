/**
 * GET /api/admin/activity — audit log, newest first (perm admin.manage).
 */
import { NextResponse } from 'next/server';
import { requirePerm, listActivity } from '@/lib/admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const gate = await requirePerm('admin.manage');
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }
  const entries = await listActivity(60);
  return NextResponse.json({ ok: true, activity: entries });
}
