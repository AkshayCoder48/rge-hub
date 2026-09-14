/**
 * Public resource page — every image / clip / XML gets its own URL on OUR domain:
 *   https://<domain>/r/<resourceId>
 *
 * Server-rendered with Open Graph + Twitter Card metadata so links unfurl
 * with the asset preview on WhatsApp, Discord, X, etc.
 *
 * Only PUBLISHED community resources are visible here. Drafts, private items
 * and admin XMLs never render on a public URL.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getResourceAny, getProfileByUsername, type Resource } from '@/lib/resources';
import { CopyLinkButton } from './copy-link';
import { SafeImage } from './safe-image';
import { Logo } from '@/components/logo';

export const dynamic = 'force-dynamic';

function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return 'http://localhost:3000';
}

async function loadResource(id: string): Promise<Resource | null> {
  try {
    const resource = await getResourceAny(id);
    if (!resource) return null;
    // Public pages: published community resources only.
    if (!resource.published) return null;
    if (resource.type === 'xml' && resource.xmlSource === 'admin') return null;
    return resource;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const base = siteUrl();
  const resource = await loadResource(id);
  if (!resource) {
    return {
      title: 'Not found — RGE Hub',
      description: 'This resource does not exist or is no longer public.',
    };
  }
  const url = `${base}/r/${resource.id}`;
  const title = `${resource.title} — RGE Hub`;
  const description =
    resource.description ||
    `${resource.type.toUpperCase()} by ${resource.ownerName} on RGE Hub — Indian railway editing assets.`;
  const preview = resource.downloadUrl || resource.thumbnailUrl;
  const images = preview ? [{ url: preview, alt: resource.title }] : [];

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      siteName: 'RGE Hub',
      title,
      description,
      url,
      images,
    },
    twitter: {
      card: resource.type === 'image' ? 'summary_large_image' : 'summary',
      title,
      description,
      images: preview ? [preview] : [],
    },
  };
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

export default async function ResourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const resource = await loadResource(id);
  if (!resource) notFound();

  const base = siteUrl();
  const pageUrl = `${base}/r/${resource.id}`;

  // Resolve the owner's current display identity (non-fatal if it fails).
  let displayName = resource.ownerName;
  let avatar: string | undefined;
  try {
    const profile = await getProfileByUsername(resource.ownerName);
    if (profile) {
      displayName = profile.displayName || displayName;
      avatar = profile.avatar;
    }
  } catch {}

  const preview = resource.downloadUrl || resource.thumbnailUrl;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': resource.type === 'image' ? 'ImageObject' : resource.type === 'clip' ? 'VideoObject' : 'DigitalDocument',
    name: resource.title,
    description: resource.description || undefined,
    contentUrl: resource.downloadUrl || undefined,
    thumbnailUrl: resource.thumbnailUrl || (resource.type === 'image' ? preview : undefined),
    uploadDate: resource.createdAt,
    author: { '@type': 'Person', name: displayName },
  };

  return (
    <div className="min-h-screen bg-black text-white relative">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Background */}
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

      {/* Body */}
      <main className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="rounded-2xl border border-white/10 bg-black/60 backdrop-blur-xl overflow-hidden">
          {/* Preview */}
          <div className="bg-black/60 flex items-center justify-center p-4 sm:p-6 min-h-[240px]">
            {resource.type === 'image' && preview ? (
              // Plain <img> keeps full original resolution with zero optimization cost.
              // Fallback chain: canonical → mirror → storage, swapped on error.
              <SafeImage
                src={preview}
                fallbacks={[resource.mirrorUrl, resource.storageUrl]}
                alt={resource.title}
                className="max-w-full max-h-[70vh] object-contain rounded-xl"
              />
            ) : resource.type === 'clip' && resource.downloadUrl ? (
              <video
                src={resource.downloadUrl}
                poster={resource.thumbnailUrl}
                controls
                playsInline
                className="max-w-full max-h-[70vh] rounded-xl"
              />
            ) : resource.type === 'xml' ? (
              <div className="flex flex-col items-center gap-3 py-16">
                <div className="w-16 h-16 rounded-2xl bg-[#ef233c]/10 border border-[#ef233c]/20 flex items-center justify-center">
                  <span className="font-mono text-2xl text-[#ef233c]">{'</>'}</span>
                </div>
                <p className="font-inter text-sm text-zinc-500">XML preset — download to use</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-16">
                <p className="font-inter text-sm text-zinc-500">No preview available</p>
              </div>
            )}
          </div>

          {/* Info */}
          <div className="p-6 sm:p-8 space-y-5 border-t border-white/5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[9px] font-manrope uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#ef233c]/10 border border-[#ef233c]/25 text-[#ef233c]">
                    {resource.type}
                  </span>
                  {resource.category && (
                    <span className="text-[9px] font-manrope uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/10 text-zinc-400">
                      {resource.category}
                    </span>
                  )}
                  <span className="text-[10px] font-manrope text-zinc-600">
                    {formatDate(resource.createdAt)}
                    {resource.type === 'clip' && resource.duration ? ` · ${resource.duration.toFixed(1)}s` : ''}
                  </span>
                </div>
                <h1 className="font-manrope font-semibold text-2xl sm:text-3xl text-white leading-tight break-words">
                  {resource.title}
                </h1>
              </div>

              {/* Creator */}
              <div className="flex items-center gap-3 shrink-0">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#ef233c]/20 to-zinc-800 flex items-center justify-center text-sm font-medium text-white overflow-hidden">
                  {avatar ? (
                    <img src={avatar} alt={displayName} className="w-full h-full object-cover" />
                  ) : (
                    displayName?.charAt(0).toUpperCase() || '?'
                  )}
                </div>
                <div>
                  <p className="font-inter text-sm font-medium text-white">{displayName}</p>
                  <p className="text-[11px] font-manrope text-zinc-500">@{resource.ownerName}</p>
                </div>
              </div>
            </div>

            {resource.description && (
              <p className="font-inter text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
                {resource.description}
              </p>
            )}

            {resource.tags && resource.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {resource.tags.map((tag, i) => (
                  <span
                    key={i}
                    className="text-[11px] font-manrope px-2 py-1 rounded-lg bg-white/[0.03] border border-white/5 text-zinc-400"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {resource.downloadUrl && (
                <a
                  href={resource.downloadUrl}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-[#ef233c] hover:bg-red-700 text-white text-sm font-medium transition-all duration-300"
                >
                  Download {resource.type}
                </a>
              )}
              <CopyLinkButton url={pageUrl} />
              <span className="w-full sm:w-auto sm:ml-2 font-mono text-[11px] text-zinc-600 truncate">
                {pageUrl}
              </span>
            </div>
          </div>
        </div>

        <p className="mt-6 text-center font-inter text-xs text-zinc-600">
          Shared from <Link href="/" className="text-zinc-400 hover:text-white">RGE Hub</Link> — Indian railway editing assets.
        </p>
      </main>
    </div>
  );
}
