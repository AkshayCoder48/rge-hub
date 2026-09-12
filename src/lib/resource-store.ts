'use client';

import { create } from 'zustand';
import type { Resource } from '@/lib/resources';

/**
 * Client-side resource store with write-through overlay + stale-while-revalidate.
 *
 * Why this exists (PRD §13, §30, §31, §32, §33, §46):
 * OnyxBase is eventually consistent — a listing fetched right after a write
 * can come back empty or stale. Without protection, a refresh in that window
 * makes fresh uploads "disappear" and renders "Recently added" empty.
 *
 * Protections:
 * 1. `upsertLocal` — newly created resources are merged into every slice
 *    immediately and kept in a local overlay until the server confirms them.
 * 2. `fetchAll`/`fetchMine` merge the server payload with the local overlay
 *    (server wins on conflict; locals drop once confirmed or after 10 min).
 * 3. Stale-while-revalidate — if the server returns an empty list while the
 *    store already holds items, the old items are KEPT and a background
 *    refetch is scheduled instead of flashing an empty library.
 */

interface LocalOverlay {
  resource: Resource;
  localUntil: number;
}

const LOCAL_OVERLAY_TTL_MS = 10 * 60 * 1000; // 10 minutes
const BG_RETRY_DELAY_MS = 4000;
const BG_RETRY_MAX = 3;

interface ResourceStore {
  // Data
  allResources: Resource[];
  images: Resource[];
  clips: Resource[];
  xmls: Resource[];
  myResources: Resource[];

  // State
  loading: boolean;
  loaded: boolean;
  stale: boolean;
  error: string | null;

  // Actions
  fetchAll: () => Promise<void>;
  fetchMine: (userId: string) => Promise<void>;
  invalidate: () => void;
  upsertLocal: (resource: Resource) => void;
  removeById: (id: string) => void;

  // Selectors
  getPublic: () => Resource[];
  getByType: (type: 'image' | 'clip' | 'xml') => Resource[];
  getByOwner: (userId: string) => Resource[];
  search: (query: string) => Resource[];
}

function sortNewest(list: Resource[]): Resource[] {
  return [...list].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/** Merge overlay locals into a server list (server wins on id conflict). */
function mergeOverlay(server: Resource[], overlays: LocalOverlay[]): Resource[] {
  const now = Date.now();
  const fresh = overlays.filter((o) => o.localUntil > now);
  if (fresh.length === 0) return server;
  const ids = new Set(server.map((r) => r.id));
  const missing = fresh.map((o) => o.resource).filter((r) => !ids.has(r.id));
  if (missing.length === 0) return server;
  return sortNewest([...server, ...missing]);
}

function sliceByType(all: Resource[], type: 'image' | 'clip' | 'xml'): Resource[] {
  return all.filter((r) => r.type === type);
}

export const useResourceStore = create<ResourceStore>((set, get) => {
  // Module-scoped (per-store) mutable bits kept outside React state
  let overlays: LocalOverlay[] = [];
  let bgRetries = 0;
  let bgTimer: ReturnType<typeof setTimeout> | null = null;

  const pruneOverlays = (serverIds: Set<string>) => {
    const now = Date.now();
    overlays = overlays.filter((o) => o.localUntil > now && !serverIds.has(o.resource.id));
  };

  const scheduleBgRefetch = () => {
    if (bgRetries >= BG_RETRY_MAX) return;
    if (bgTimer) return;
    bgRetries += 1;
    bgTimer = setTimeout(() => {
      bgTimer = null;
      get().fetchAll();
    }, BG_RETRY_DELAY_MS);
  };

  return {
    allResources: [],
    images: [],
    clips: [],
    xmls: [],
    myResources: [],
    loading: false,
    loaded: false,
    stale: false,
    error: null,

    fetchAll: async () => {
      if (get().loading) return; // Prevent duplicate concurrent fetches
      set({ loading: true, error: null });

      try {
        const res = await fetch('/api/resources/all', { cache: 'no-store' });
        const data = await res.json();

        if (data.ok) {
          const serverAll: Resource[] = data.all || [];
          const prevAll = get().allResources;

          // Stale-while-revalidate: never replace a populated store with an
          // empty server payload (transient consistency gap). Keep old data,
          // flag it stale, and retry in the background (PRD §13).
          if (serverAll.length === 0 && prevAll.length > 0) {
            set({ loading: false, stale: true });
            scheduleBgRefetch();
            return;
          }
          bgRetries = 0;

          const merged = mergeOverlay(serverAll, overlays);
          pruneOverlays(new Set(serverAll.map((r) => r.id)));

          set({
            allResources: merged,
            images: data.images ? mergeOverlay(data.images, overlays) : sliceByType(merged, 'image'),
            clips: data.clips ? mergeOverlay(data.clips, overlays) : sliceByType(merged, 'clip'),
            xmls: data.xmls ? mergeOverlay(data.xmls, overlays) : sliceByType(merged, 'xml'),
            loading: false,
            loaded: true,
            stale: false,
            error: null,
          });
        } else {
          // Error but we may have data — keep it, flag stale, retry behind.
          if (get().allResources.length > 0) {
            set({ loading: false, stale: true });
            scheduleBgRefetch();
          } else {
            set({ loading: false, error: data.error || 'Failed to load' });
          }
        }
      } catch {
        if (get().allResources.length > 0) {
          set({ loading: false, stale: true });
          scheduleBgRefetch();
        } else {
          set({ loading: false, error: 'Network error' });
        }
      }
    },

    fetchMine: async (userId: string) => {
      try {
        const res = await fetch(`/api/resources/all?owner=${encodeURIComponent(userId)}`, {
          cache: 'no-store',
        });
        const data = await res.json();

        if (data.ok) {
          const serverMine: Resource[] = data.all || [];
          const prevMine = get().myResources;
          // Same stale-while-revalidate guard for the profile slice.
          if (serverMine.length === 0 && prevMine.length > 0) {
            return;
          }
          const mineOverlay = overlays.filter((o) => o.resource.ownerId === userId);
          const merged = mergeOverlay(serverMine, mineOverlay);
          pruneOverlays(new Set(serverMine.map((r) => r.id)));
          set({ myResources: merged });
        }
      } catch {
        // silent fail — public resources are still available
      }
    },

    invalidate: () => {
      set({ loaded: false });
      get().fetchAll();
    },

    upsertLocal: (resource: Resource) => {
      // Add to the overlay so it survives subsequent fetches until confirmed.
      overlays = [
        ...overlays.filter((o) => o.resource.id !== resource.id),
        { resource, localUntil: Date.now() + LOCAL_OVERLAY_TTL_MS },
      ];
      const upsert = (list: Resource[]) =>
        sortNewest([resource, ...list.filter((r) => r.id !== resource.id)]);
      const all = upsert(get().allResources);
      set({
        allResources: all,
        images: resource.type === 'image' ? upsert(get().images) : get().images,
        clips: resource.type === 'clip' ? upsert(get().clips) : get().clips,
        xmls: resource.type === 'xml' ? upsert(get().xmls) : get().xmls,
        myResources: upsert(get().myResources),
        loaded: true,
      });
    },

    removeById: (id: string) => {
      overlays = overlays.filter((o) => o.resource.id !== id);
      const strip = (list: Resource[]) => list.filter((r) => r.id !== id);
      set({
        allResources: strip(get().allResources),
        images: strip(get().images),
        clips: strip(get().clips),
        xmls: strip(get().xmls),
        myResources: strip(get().myResources),
      });
    },

    getPublic: () => get().allResources.filter((r) => r.published),

    getByType: (type) => get().allResources.filter((r) => r.type === type),

    getByOwner: (userId) => {
      const state = get();
      const seen = new Set<string>();
      const out: Resource[] = [];
      for (const r of [...state.allResources, ...state.myResources]) {
        if (r.ownerId === userId && !seen.has(r.id)) {
          seen.add(r.id);
          out.push(r);
        }
      }
      return out;
    },

    search: (query) => {
      const q = query.toLowerCase();
      return get().allResources.filter((r) => {
        return (
          r.title?.toLowerCase().includes(q) ||
          r.description?.toLowerCase().includes(q) ||
          r.ownerName?.toLowerCase().includes(q) ||
          r.tags?.some((t) => t.toLowerCase().includes(q))
        );
      });
    },
  };
});
