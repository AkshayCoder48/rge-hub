/**
 * Reserved identities — prevents impersonation of the admin / platform.
 *
 * Nobody may register or rename to these usernames / display names.
 * Admin rights NEVER come from a name — only from the admin email
 * (see isAdminUser in session.ts). This module additionally blocks
 * taking the admin's NAME so users can't visually impersonate staff.
 */

const RESERVED_USERNAMES = new Set([
  'railguyedits',
  'railguy',
  'rgehub',
  'rge_hub',
  'rge',
  'admin',
  'administrator',
  'moderator',
  'mod',
  'official',
  'support',
  'staff',
  'system',
  'root',
  'owner',
  'speedramp',
  'speedramper',
]);

const RESERVED_DISPLAY_NAMES = new Set([
  'railguyedits',
  'rail guy edits',
  'rge hub',
  'rgehub',
  'admin',
  'administrator',
  'official',
  'support',
]);

function norm(name: string): string {
  return name.toLowerCase().trim().replace(/[\s._-]+/g, '');
}

function normLoose(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

export function isReservedUsername(username: string): boolean {
  const n = norm(username);
  if (RESERVED_USERNAMES.has(n)) return true;
  // Block obvious lookalikes: railguyedits + digits/underscores, admin*, etc.
  if (/^(railguyedits|rgehub|admin|administrator|official|support)[0-9_]*$/.test(n)) return true;
  return false;
}

export function isReservedDisplayName(displayName: string): boolean {
  const loose = normLoose(displayName);
  if (RESERVED_DISPLAY_NAMES.has(loose)) return true;
  if (RESERVED_DISPLAY_NAMES.has(norm(displayName))) return true;
  if (/^(railguyedits|rgehub|admin|administrator)[0-9_]*$/.test(norm(displayName))) return true;
  return false;
}

export function reservedUsernameMessage(): string {
  return 'This username is reserved. Please choose another.';
}

export function reservedDisplayNameMessage(): string {
  return 'This display name is reserved. Please choose another.';
}
