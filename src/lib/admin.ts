/**
 * Admin roles + granular permissions (server-side authority).
 *
 * Roles:
 * - root:      the email/userId-configured main admin (permanent, env-driven).
 *              Full access, bypasses permission checks.
 * - admin:     lower administrator. Badge [Admin]. Permissions granted by root.
 * - moderator: lower administrator. Badge [Moderator]. Permissions granted by root.
 * - user:      normal member. No admin access.
 *
 * Storage: `admins` collection, key `role:{userId}` -> StaffRecord.
 * Root is NEVER stored here (env is the root source of truth) so a lower
 * admin can neither create, modify, nor remove root access.
 *
 * Every admin API enforces via requirePerm() — frontend gating is UI only.
 */
import { kvSet, kvGet, kvDeleteIdempotent, kvExport, stripExportPrefix } from './onyxbase';
import { ONYXBASE_COLLECTIONS } from './onyxbase';
import { getSession, isAdminUser } from './session';
import type { Profile } from './resources';

export type AdminRole = 'root' | 'admin' | 'moderator' | 'user';

export interface StaffRecord {
  userId: string;
  username: string;
  role: 'admin' | 'moderator';
  permissions: string[];
  updatedBy: string;
  updatedAt: string;
}

export interface PermissionDef {
  id: string;
  label: string;
  group: string;
  hint: string;
}

/** The full permission catalog. Every id maps to REAL enforced behavior. */
export const PERMISSIONS: PermissionDef[] = [
  { id: 'admin.view', label: 'View Admin Panel', group: 'Administration', hint: 'See the Admin section in the sidebar + open the dashboard' },
  { id: 'content.images', label: 'Manage Images', group: 'Content', hint: 'List, view and delete any image (incl. unpublished)' },
  { id: 'content.clips', label: 'Manage Clips', group: 'Content', hint: 'List, view and delete any clip (incl. unpublished)' },
  { id: 'content.files', label: 'Manage Files', group: 'Content', hint: 'List, view and delete any file incl. admin files' },
  { id: 'content.feature', label: 'Feature Content', group: 'Content', hint: 'Toggle the featured flag on any resource' },
  { id: 'users.view', label: 'View Users', group: 'Users', hint: 'Search and list community members' },
  { id: 'admin.manage', label: 'Manage Admins & Roles', group: 'Administration', hint: 'Add/remove staff, change roles & permissions, view activity' },
];

export const PERMISSION_IDS = new Set(PERMISSIONS.map((p) => p.id));

const adminsCollection = () => ONYXBASE_COLLECTIONS.ADMINS;
const activityCollection = () => ONYXBASE_COLLECTIONS.ADMIN_ACTIVITY;
const roleKey = (userId: string) => `role:${userId}`;

export function cleanPermissions(perms: unknown): string[] {
  if (!Array.isArray(perms)) return [];
  const out = new Set<string>();
  for (const p of perms) {
    if (typeof p === 'string' && PERMISSION_IDS.has(p)) out.add(p);
  }
  // admin.view is implied for every staffer (else they can't open the panel).
  out.add('admin.view');
  return [...out];
}

export async function getStaffRecord(userId: string): Promise<StaffRecord | null> {
  if (!userId) return null;
  const rec = await kvGet<StaffRecord>(roleKey(userId), adminsCollection()).catch(() => null);
  if (!rec || (rec.role !== 'admin' && rec.role !== 'moderator')) return null;
  return rec;
}

export interface ResolvedRole {
  role: AdminRole;
  permissions: string[];
}

/** Resolve the effective role for an authenticated session. Root bypasses all. */
export async function resolveRole(session: {
  userId?: string;
  email?: string;
}): Promise<ResolvedRole> {
  if (isAdminUser({ email: session.email, userId: session.userId })) {
    return { role: 'root', permissions: ['*'] };
  }
  const rec = await getStaffRecord(session.userId || '').catch(() => null);
  if (!rec) return { role: 'user', permissions: [] };
  return { role: rec.role, permissions: cleanPermissions(rec.permissions) };
}

export function hasPermission(resolved: ResolvedRole, perm: string): boolean {
  if (resolved.role === 'root') return true;
  if (resolved.permissions.includes('*')) return true;
  return resolved.permissions.includes(perm);
}

export interface PermCheckOk {
  ok: true;
  role: AdminRole;
  permissions: string[];
  userId: string;
  username: string;
  displayName: string;
}
export interface PermCheckFail {
  ok: false;
  status: 401 | 403;
  error: string;
}

/**
 * Server-side gate for admin APIs. Authenticates, resolves role, checks one
 * permission. Root passes everything.
 */
export async function requirePerm(perm: string): Promise<PermCheckOk | PermCheckFail> {
  const sr = await getSession();
  if (sr.status !== 'ok') {
    return { ok: false, status: 401, error: 'Authentication required' };
  }
  const s = sr.session;
  const resolved = await resolveRole({ userId: s.userId, email: s.email }).catch(() => ({
    role: 'user' as AdminRole,
    permissions: [] as string[],
  }));
  if (!hasPermission(resolved, perm)) {
    return { ok: false, status: 403, error: 'Admin access required' };
  }
  return {
    ok: true,
    role: resolved.role,
    permissions: resolved.permissions,
    userId: s.userId,
    username: s.username,
    displayName: s.displayName || s.username,
  };
}

/** userId -> staff role for badge display (admins collection is tiny). */
export async function loadStaffRoleMap(): Promise<Map<string, 'admin' | 'moderator'>> {
  const map = new Map<string, 'admin' | 'moderator'>();
  const all = await kvExport(adminsCollection()).catch(() => ({}) as Record<string, unknown>);
  for (const rawKey of Object.keys(all)) {
    const key = stripExportPrefix(rawKey, adminsCollection());
    if (!key.startsWith('role:')) continue;
    const rec = all[rawKey] as StaffRecord | null;
    if (rec && (rec.role === 'admin' || rec.role === 'moderator') && rec.userId) {
      map.set(rec.userId, rec.role);
    }
  }
  return map;
}

/**
 * Public badge role for a profile: staff record wins, else root iff their
 * email/userId matches the env root, else user. Never trusts client input.
 */
export function publicRoleFor(
  profile: { userId?: string; email?: string },
  staffMap: Map<string, 'admin' | 'moderator'>
): AdminRole {
  if (profile.userId && staffMap.has(profile.userId)) {
    return staffMap.get(profile.userId) as 'admin' | 'moderator';
  }
  if (isAdminUser({ email: profile.email, userId: profile.userId })) return 'root';
  return 'user';
}

// ============ Activity log ============

export interface ActivityEntry {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  target?: string;
  detail?: string;
  ts: number;
}

/** Best-effort audit write — never fails the action it records. */
export async function logActivity(
  actorId: string,
  actorName: string,
  action: string,
  target?: string,
  detail?: string
): Promise<void> {
  // Audit is advisory (never fails the action), but worth one retry —
  // a lost audit entry is a hole in the record.
  for (let i = 0; i < 2; i++) {
    try {
      const ts = Date.now();
      const id = `act:${ts}:${Math.random().toString(36).slice(2, 8)}`;
      const entry: ActivityEntry = { id, actorId, actorName, action, target, detail, ts };
      const ok = await kvSet(id, entry, activityCollection());
      if (ok) return;
    } catch {
      // fall through to retry, then give up quietly
    }
    if (i === 0) await new Promise((r) => setTimeout(r, 4000));
  }
}

export async function listActivity(limit = 60): Promise<ActivityEntry[]> {
  const all = await kvExport(activityCollection()).catch(() => ({}) as Record<string, unknown>);
  const entries: ActivityEntry[] = [];
  for (const rawKey of Object.keys(all)) {
    const key = stripExportPrefix(rawKey, activityCollection());
    if (!key.startsWith('act:')) continue;
    const e = all[rawKey] as ActivityEntry | null;
    if (e && typeof e.ts === 'number' && e.action) entries.push(e);
  }
  entries.sort((a, b) => b.ts - a.ts);
  return entries.slice(0, limit);
}
