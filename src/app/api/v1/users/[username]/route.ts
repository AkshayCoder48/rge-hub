/**
 * GET /api/v1/users/[username] — public creator profile by username +
 * published resources + follower counts (no auth required).
 */
import { NextRequest } from 'next/server';
import { ok, fail, ERROR_CODES, newRequestId } from '@/lib/api-contract';
import {
  getProfileByUsername,
  listResourcesByOwner,
  getFollowCounts,
} from '@/lib/resources';
import { serializeResource, guardPublicIp, tooManyRequests } from '@/lib/api-v1';

export const dynamic = 'force-dynamic';

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const requestId = newRequestId();
  const t0 = Date.now();
  const meta = { requestId, durationMs: 0 };

  const ip = guardPublicIp(request, 30, 60_000);
  if (!ip.ok) return tooManyRequests(ip.retryAfterSecs, meta);

  const { username } = await params;
  if (!USERNAME_RE.test(username)) {
    meta.durationMs = Date.now() - t0;
    return fail(ERROR_CODES.VALIDATION_ERROR, 'Malformed username.', meta, { status: 400 });
  }

  const profile = await getProfileByUsername(username).catch(() => null);
  if (!profile) {
    meta.durationMs = Date.now() - t0;
    return fail(ERROR_CODES.NOT_FOUND, 'User not found.', meta, { status: 404 });
  }

  const [allResources, counts] = await Promise.all([
    listResourcesByOwner(profile.userId).catch(() => []),
    getFollowCounts(profile.userId).catch(() => ({ followersCount: 0, followingCount: 0 })),
  ]);
  const published = allResources.filter((r) => r.published);

  meta.durationMs = Date.now() - t0;
  return ok(
    {
      user: {
        userId: profile.userId,
        username: profile.username,
        displayName: profile.displayName,
        avatar: profile.avatar || null,
        bio: profile.bio || '',
        createdAt: profile.createdAt,
      },
      counts: {
        uploads: published.length,
        ...counts,
      },
      resources: published.slice(0, 100).map((r) => serializeResource(r, request)),
    },
    meta
  );
}
