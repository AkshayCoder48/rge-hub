'use client';

import { create } from 'zustand';
import type { Resource } from '@/lib/resources';

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
  error: string | null;

  // Actions
  fetchAll: () => Promise<void>;
  fetchMine: (userId: string) => Promise<void>;
  invalidate: () => void;

  // Selectors
  getPublic: () => Resource[];
  getByType: (type: 'image' | 'clip' | 'xml') => Resource[];
  getByOwner: (userId: string) => Resource[];
  search: (query: string) => Resource[];
}

export const useResourceStore = create<ResourceStore>((set, get) => ({
  allResources: [],
  images: [],
  clips: [],
  xmls: [],
  myResources: [],
  loading: false,
  loaded: false,
  error: null,

  fetchAll: async () => {
    if (get().loading) return; // Prevent duplicate concurrent fetches
    set({ loading: true, error: null });

    try {
      const res = await fetch('/api/resources/all', { cache: 'no-store' });
      const data = await res.json();

      if (data.ok) {
        set({
          allResources: data.all || [],
          images: data.images || [],
          clips: data.clips || [],
          xmls: data.xmls || [],
          loading: false,
          loaded: true,
          error: null,
        });
      } else {
        set({ loading: false, error: data.error || 'Failed to load' });
      }
    } catch (err) {
      set({ loading: false, error: 'Network error' });
    }
  },

  fetchMine: async (userId: string) => {
    try {
      const res = await fetch(`/api/resources/all?owner=${encodeURIComponent(userId)}`, { cache: 'no-store' });
      const data = await res.json();

      if (data.ok) {
        set({ myResources: data.all || [] });
      }
    } catch {
      // silent fail — public resources are still available
    }
  },

  invalidate: () => {
    set({ loaded: false });
    get().fetchAll();
  },

  getPublic: () => get().allResources.filter(r => r.published),

  getByType: (type) => get().allResources.filter(r => r.type === type),

  getByOwner: (userId) => {
    const state = get();
    return [...state.allResources, ...state.myResources].filter(
      r => r.ownerId === userId
    );
  },

  search: (query) => {
    const q = query.toLowerCase();
    return get().allResources.filter(r => {
      return (
        r.title?.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q) ||
        r.ownerName?.toLowerCase().includes(q) ||
        r.tags?.some(t => t.toLowerCase().includes(q))
      );
    });
  },
}));
