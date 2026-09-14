/**
 * GET /api/admin/stats
 * Returns aggregate counts for the admin dashboard.
 *
 * CRITICAL: Admin only. Server-side verified. Never trusts client-side role.
 *
 * Returns:
 *   { ok: true,
 *     totalUsers, totalImages, totalClips, totalCommunityXmls, totalAdminXmls,
 *     publishedCount, unpublishedCount }
 */
import { NextRequest, NextResponse } from 'next/server';
import { requirePerm } from '@/lib/admin';
import { getAllProfiles, listResources } from '@/lib/resources';

export async function GET(_request: NextRequest) {
  try {
    const gate = await requirePerm('admin.view');
    if (!gate.ok) {
      return NextResponse.json(
        { ok: false, error: gate.error },
        { status: gate.status }
      );
    }

    const [profiles, images, clips, communityXmls, adminXmls] = await Promise.all([
      getAllProfiles(),
      listResources('image'),
      listResources('clip'),
      listResources('xml', 'community'),
      listResources('xml', 'admin'),
    ]);

    const all = [...images, ...clips, ...communityXmls, ...adminXmls];
    const publishedCount = all.filter(r => r.published).length;
    const unpublishedCount = all.length - publishedCount;

    return NextResponse.json({
      ok: true,
      totalUsers: profiles.length,
      totalImages: images.length,
      totalClips: clips.length,
      totalCommunityXmls: communityXmls.length,
      totalAdminXmls: adminXmls.length,
      publishedCount,
      unpublishedCount,
    });
  } catch (err) {
    console.error('[admin/stats] error:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to load admin stats' },
      { status: 500 }
    );
  }
}
