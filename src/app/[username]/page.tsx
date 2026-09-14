/**
 * Public profile page: rge-hub.vercel.app/{username}
 * Every creator's handle doubles as their shareable profile URL.
 *
 * Server-resolves username -> userId, then renders the shared UserView
 * inside a lightweight public chrome (logo + open-app link).
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Logo } from '@/components/logo';
import { PublicProfileClient } from '@/components/public-profile-client';
import { getProfileByUsername } from '@/lib/resources';

// Single-segment app routes that must NEVER be treated as usernames.
const RESERVED = new Set([
  'api', 'r', 'admin', 'login', 'signup', 'search', 'profile', 'community',
  'images', 'clips', 'xmls', 'files', 'studio', 'home', 'user', 'users',
  'f', 'img', 'uploads', 'quax', 'resources', 'speedramp', 'analyze',
  'cron', 'auth',
]);

export const dynamic = 'force-dynamic';

function cleanUsername(raw: string): string | null {
  const u = decodeURIComponent(raw).toLowerCase().trim();
  if (!/^[a-z0-9_]{3,20}$/.test(u)) return null;
  if (RESERVED.has(u)) return null;
  return u;
}

export async function generateMetadata(
  { params }: { params: Promise<{ username: string }> }
): Promise<Metadata> {
  const { username } = await params;
  const clean = cleanUsername(username);
  if (!clean) return { title: 'Not found | RGE Hub' };
  const profile = await getProfileByUsername(clean).catch(() => null);
  if (!profile) return { title: 'Not found | RGE Hub' };
  const title = `${profile.displayName} (@${profile.username}) | RGE Hub`;
  const description = profile.bio || `Check out ${profile.displayName}'s uploads on RGE Hub.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: profile.avatar ? [profile.avatar] : undefined,
    },
    twitter: {
      card: 'summary',
      title,
      description,
      images: profile.avatar ? [profile.avatar] : undefined,
    },
  };
}

export default async function PublicProfilePage(
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  const clean = cleanUsername(username);
  const profile = clean ? await getProfileByUsername(clean).catch(() => null) : null;
  if (!clean || !profile) {
    notFound();
    return null; // unreachable (notFound throws) — satisfies tsc without next types
  }

  return (
    <div className="min-h-screen bg-black text-white relative">
      {/* Red Noir background */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0202] to-black" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-red-600/5 rounded-full blur-[120px]" />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-white/5 bg-black/60 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Logo size={22} />
            <span className="font-manrope font-bold text-base text-white">RGE Hub</span>
          </Link>
          <Link
            href="/"
            className="text-xs font-manrope text-zinc-400 hover:text-white transition-colors"
          >
            Open the app →
          </Link>
        </div>
      </header>

      <main className="relative z-10 px-4 sm:px-6 py-6 lg:py-10 max-w-5xl mx-auto">
        <PublicProfileClient initialUserId={profile.userId} initialUsername={profile.username} />
      </main>
    </div>
  );
}
