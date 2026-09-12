/**
 * POST /api/auth/logout
 * Destroys the current session.
 */
import { NextResponse } from 'next/server';
import { destroySession } from '@/lib/session';

export async function POST() {
  await destroySession();
  return NextResponse.json({ ok: true });
}
