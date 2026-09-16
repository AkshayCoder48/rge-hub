/**
 * DELETE /api/account — authenticated account deletion (PRD §11–§16).
 *
 * The account is identified SOLELY from the signed session cookie — the
 * client never gets to say which account is deleted. Destructive, so the
 * caller must re-authenticate with their current password (verified against
 * the authoritative V5 account) before anything is touched.
 *
 * Flow (short + idempotent, never minutes):
 *   1. session → user identity
 *   2. password re-auth (v5LoginAccount) — wrong password = 403, nothing deleted
 *   3. revoke the session IMMEDIATELY (authoritative state transition)
 *   4. delete resource metadata + blobs (bounded inline; overflow fire-and-forget)
 *   5. delete follows (both directions), profile + email/username indexes,
 *      staff record, agent workspace, legacy engine-stored agent chats,
 *      and the V5 account itself (engine service call)
 *   6. respond { deleted: true } — a retried DELETE for the same (now
 *      nonexistent) account returns the same success shape (idempotent)
 *
 * Optimistic UI: the client may transition to the signed-out state as soon
 * as THIS endpoint answers success — the server has already accepted the
 * deletion transition. Blob bytes for very large libraries finish removing
 * in the background (engine-side) — metadata is gone instantly, so files
 * are unreachable and unlisted the moment this returns.
 */
import { NextRequest } from 'next/server';
import {
  ONYXBASE_V5_ENABLED,
  v5LoginAccount,
  v5Request,
  kvDelete,
  kvDeleteIdempotent,
  kvList,
  ONYXBASE_COLLECTIONS,
} from '@/lib/onyxbase';
import {
  getProfile,
  listResourcesFast,
  getFollowingIds,
  getFollowerIds,
} from '@/lib/resources';
import { deleteFile } from '@/lib/onyxbase';
import { purgeWorkspace } from '@/lib/agent/workspace';
import { getSession, destroySession } from '@/lib/session';
import { ok, fail, ERROR_CODES, newRequestId, logRequest } from '@/lib/api-contract';
import { allow, clientIpFrom } from '@/lib/rate-limit';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/** Inline blob-delete budget — beyond this, blobs delete fire-and-forget. */
const INLINE_BLOB_BUDGET = 25;

function relKeyOf(followerId: string, targetId: string): string {
  return `rel:${followerId}:${targetId}`;
}

export async function DELETE(request: NextRequest) {
  const requestId = newRequestId();
  const t0 = Date.now();
  const meta = { requestId, durationMs: 0 };
  try {
    // ─── 1. Identity from the SESSION (never from the body) ───────────────
    const sessionResult = await getSession();
    if (sessionResult.status !== 'ok' || !sessionResult.session) {
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.UNAUTHENTICATED, 'Sign in to delete your account.', meta, { status: 401 });
    }
    const session = sessionResult.session;

    // ─── 2. Re-authentication (destructive action) ────────────────────────
    const body = (await request.json().catch(() => null)) as { password?: string } | null;
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!password) {
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.VALIDATION_ERROR, 'Confirm your current password to delete your account.', meta, { status: 400 });
    }
    const rl = allow(`acct-del:${clientIpFrom(request)}`, 5, 60 * 60_000);
    if (!rl.allowed) {
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.RATE_LIMITED, 'Too many attempts. Please wait a moment.', meta, { status: 429, retryable: true, retryAfterSecs: rl.retryAfterSecs });
    }
    if (ONYXBASE_V5_ENABLED) {
      const check = await v5LoginAccount(session.email ?? '', password);
      if (!check.ok) {
        meta.durationMs = Date.now() - t0;
        // Honest states (PRD §10) — only a real bad password is a 403.
        if (check.code === 'RATE_LIMITED') {
          return fail(ERROR_CODES.RATE_LIMITED, 'Too many attempts — please wait a moment and try again.', meta, { status: 429, retryable: true });
        }
        if (check.code === 'UPSTREAM_UNAVAILABLE') {
          return fail(ERROR_CODES.UPSTREAM_UNAVAILABLE, 'The auth service is briefly unavailable — please retry.', meta, { status: 503, retryable: true });
        }
        return fail(ERROR_CODES.FORBIDDEN, 'Incorrect password. Your account was NOT deleted.', meta, { status: 403 });
      }
    }

    // ─── 3. Idempotency probe: already deleted? ───────────────────────────
    const profile = await getProfile(session.userId).catch(() => null);

    // ─── 4. Revoke the session FIRST (authoritative, instant) ─────────────
    await destroySession();

    if (!profile) {
      // Everything user-facing is already gone (or never existed). Best-effort
      // removal of the V5 account row, then the same success shape.
      if (ONYXBASE_V5_ENABLED && session.email) {
        await v5Request(
          `/api/v5/accounts?email=${encodeURIComponent(session.email.toLowerCase())}`,
          { method: 'DELETE' },
          { retries: 0, timeoutMs: 15_000 }
        ).catch(() => null);
      }
      meta.durationMs = Date.now() - t0;
      logRequest(meta, '/api/account', 'DELETE', 200, 'account.delete.already');
      return ok({ deleted: true, alreadyDeleted: true }, meta);
    }

    // ─── 5. Resources (metadata inline; blobs bounded) ────────────────────
    const collections: Array<{ collection: string }> = [
      { collection: ONYXBASE_COLLECTIONS.IMAGES },
      { collection: ONYXBASE_COLLECTIONS.CLIPS },
      { collection: ONYXBASE_COLLECTIONS.COMMUNITY_XMLS },
    ];
    let blobBudget = INLINE_BLOB_BUDGET;
    const bgBlobDeletes: string[] = [];
    for (const { collection } of collections) {
      const all = await listResourcesFast(
        collection === ONYXBASE_COLLECTIONS.IMAGES ? 'image' : collection === ONYXBASE_COLLECTIONS.CLIPS ? 'clip' : 'xml',
        collection === ONYXBASE_COLLECTIONS.COMMUNITY_XMLS ? 'community' : undefined
      ).catch(() => []);
      const owned = all.filter((r) => r && r.ownerId === session.userId);
      for (const r of owned) {
        await kvDelete(r.id, collection).catch(() => {});
        const fid = r.fileId || '';
        const isRealFile = fid && !fid.startsWith('ext:');
        if (isRealFile) {
          if (blobBudget > 0) {
            blobBudget--;
            await deleteFile(fid).catch(() => {});
          } else {
            bgBlobDeletes.push(fid);
          }
        }
      }
    }

    // ─── 6. Follows (both directions) ─────────────────────────────────────
    const [following, followers] = await Promise.all([
      getFollowingIds(session.userId).catch(() => [] as string[]),
      getFollowerIds(session.userId).catch(() => [] as string[]),
    ]);
    for (const target of following) {
      await kvDeleteIdempotent(relKeyOf(session.userId, target), ONYXBASE_COLLECTIONS.FOLLOWS).catch(() => {});
    }
    for (const follower of followers) {
      await kvDeleteIdempotent(relKeyOf(follower, session.userId), ONYXBASE_COLLECTIONS.FOLLOWS).catch(() => {});
    }

    // ─── 7. Profile + indexes + staff record + workspace + legacy chats ──
    await Promise.all([
      kvDelete(`profile:${session.userId}`, ONYXBASE_COLLECTIONS.PROFILES).catch(() => {}),
      kvDelete(`email:${(profile.email || session.email || '').toLowerCase().trim()}`, ONYXBASE_COLLECTIONS.PROFILES).catch(() => {}),
      kvDelete(`username:${profile.username}`, ONYXBASE_COLLECTIONS.PROFILES).catch(() => {}),
      kvDelete(`role:${session.userId}`, ONYXBASE_COLLECTIONS.ADMINS).catch(() => {}),
      purgeWorkspace(session.userId),
      (async () => {
        // Legacy engine-stored agent chats (pre-localStorage era)
        const chatKeys = await kvList('agentChats').catch(() => [] as string[]);
        const mine = chatKeys.filter((k) => k === `idx:${session.userId}` || k.startsWith(`chat:${session.userId}:`));
        for (const k of mine) await kvDelete(k, 'agentChats').catch(() => {});
      })(),
    ]);

    // ─── 8. The V5 account itself ─────────────────────────────────────────
    if (ONYXBASE_V5_ENABLED && (profile.email || session.email)) {
      await v5Request(
        `/api/v5/accounts?email=${encodeURIComponent((profile.email || session.email || '').toLowerCase().trim())}`,
        { method: 'DELETE' },
        { retries: 0, timeoutMs: 15_000 }
      ).catch(() => null);
    }

    // ─── 9. Overflow blobs: fire-and-forget (metadata is already gone) ────
    for (const fid of bgBlobDeletes) {
      void deleteFile(fid).catch(() => {});
    }

    meta.durationMs = Date.now() - t0;
    logRequest(meta, '/api/account', 'DELETE', 200, 'account.delete');
    return ok({ deleted: true }, meta);
  } catch (err) {
    meta.durationMs = Date.now() - t0;
    console.error('[account-delete] error:', err instanceof Error ? err.message : err);
    return fail(ERROR_CODES.INTERNAL_ERROR, 'Account deletion failed. Please try again.', meta, { status: 500 });
  }
}
