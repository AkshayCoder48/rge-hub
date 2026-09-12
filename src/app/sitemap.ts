/**
 * Dynamic sitemap — every published resource gets its own canonical URL
 * (https://<domain>/r/<id>) for search indexing and link sharing.
 */
import type { MetadataRoute } from 'next';
import { listAllPublicResources } from '@/lib/resources';

function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return 'http://localhost:3000';
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  let resources: Awaited<ReturnType<typeof listAllPublicResources>> = [];
  try {
    resources = await listAllPublicResources();
  } catch {
    resources = [];
  }
  return [
    { url: base, lastModified: new Date(), changeFrequency: 'daily', priority: 1 },
    ...resources.map((r) => ({
      url: `${base}/r/${r.id}`,
      lastModified: new Date(r.updatedAt || r.createdAt),
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
  ];
}
