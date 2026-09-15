'use client';

/**
 * User preferences store (Settings → Preferences).
 *
 * Plain localStorage persistence — no server round-trips:
 *   - hydrated once on the first client read (post-mount, so SSR markup and
 *     the first client render agree — no hydration mismatch);
 *   - write-through on every set (the stored blob always mirrors state).
 *
 * Reading state outside React: `usePreferences.getState().confirmBeforeDelete`.
 */

import { useEffect } from 'react';
import { create } from 'zustand';

export interface Preferences {
  autoplayVideos: boolean;
  confirmBeforeDelete: boolean;
  reducedMotion: boolean;
}

const DEFAULTS: Preferences = {
  autoplayVideos: false,
  confirmBeforeDelete: false,
  reducedMotion: false,
};

const STORAGE_KEY = 'rge-prefs';

/** Parse the stored blob defensively — anything malformed yields defaults. */
function readStored(): Partial<Preferences> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const p = parsed as Record<string, unknown>;
    return {
      autoplayVideos: p.autoplayVideos === true,
      confirmBeforeDelete: p.confirmBeforeDelete === true,
      reducedMotion: p.reducedMotion === true,
    };
  } catch {
    return {};
  }
}

/** Write-through persist. Private mode / quota errors are non-fatal. */
function writeStored(prefs: Preferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable — preferences stay session-only.
  }
}

interface PreferencesState extends Preferences {
  /** Load persisted preferences once after mount (idempotent). */
  hydrate: () => void;
  /** Set one preference and persist immediately (write-through). */
  setPreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
}

let hydrated = false;

export const usePreferences = create<PreferencesState>((set, get) => ({
  ...DEFAULTS,
  hydrate: () => {
    if (hydrated || typeof window === 'undefined') return;
    hydrated = true;
    const stored = readStored();
    if (
      stored.autoplayVideos !== undefined ||
      stored.confirmBeforeDelete !== undefined ||
      stored.reducedMotion !== undefined
    ) {
      set(stored as Partial<PreferencesState>);
    }
  },
  setPreference: (key, value) => {
    set({ [key]: value } as unknown as Partial<PreferencesState>);
    const s = get();
    writeStored({
      autoplayVideos: s.autoplayVideos,
      confirmBeforeDelete: s.confirmBeforeDelete,
      reducedMotion: s.reducedMotion,
    });
  },
}));

/**
 * Apply the reduced-motion preference globally. Call ONCE from the app shell.
 *
 * - hydrates the store from localStorage after mount (deferred via
 *   queueMicrotask — no setState synchronously inside an effect body, per
 *   the repo's established pattern);
 * - reflects the preference onto `<html data-motion="on|off">`, which the
 *   reduced-motion CSS block in globals.css keys off.
 */
export function useApplyReducedMotion(): void {
  const reducedMotion = usePreferences((s) => s.reducedMotion);

  useEffect(() => {
    queueMicrotask(() => {
      usePreferences.getState().hydrate();
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.motion = reducedMotion ? 'off' : 'on';
  }, [reducedMotion]);
}
