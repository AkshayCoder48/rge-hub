'use client';

import React from 'react';
import { Crown, ShieldCheck } from 'lucide-react';

/**
 * Canonical role badge. Root and Admin both render [Admin] (red);
 * Moderator renders [Moderator] (amber). Normal users render nothing.
 * The role MUST come from server-resolved data — never client-claimable.
 */
export function RoleBadge({
  role,
  size = 'xs',
}: {
  role?: string | null;
  size?: 'xs' | 'sm';
}) {
  if (role !== 'root' && role !== 'admin' && role !== 'moderator') return null;
  const isMod = role === 'moderator';
  const cls =
    size === 'sm'
      ? 'px-2 py-0.5 text-[10px] gap-1'
      : 'px-1.5 py-px text-[8px] gap-0.5';
  const iconCls = size === 'sm' ? 'w-3 h-3' : 'w-2.5 h-2.5';
  return (
    <span
      className={`inline-flex items-center rounded-full border font-manrope uppercase tracking-wider ${cls} ${
        isMod
          ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
          : 'bg-[#ef233c]/15 border-[#ef233c]/30 text-[#ef233c]'
      }`}
    >
      {isMod ? <ShieldCheck className={iconCls} /> : <Crown className={iconCls} />}
      {isMod ? 'Moderator' : 'Admin'}
    </span>
  );
}

/** Display role for a resource: stamped authorRole, legacy fallback to isOwnerAdmin. */
export function authorDisplayRole(resource: {
  authorRole?: string;
  isOwnerAdmin?: boolean;
}): string {
  if (
    resource.authorRole === 'root' ||
    resource.authorRole === 'admin' ||
    resource.authorRole === 'moderator'
  ) {
    return resource.authorRole;
  }
  return resource.isOwnerAdmin ? 'admin' : 'user';
}
