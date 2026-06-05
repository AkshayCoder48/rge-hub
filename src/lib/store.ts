import { create } from 'zustand';
import type { AppState, VideoClip, SpeedRampPoint } from './types';

// Speed ramp configuration: V-shaped 4x → 0.6x → 4x
export const RAMP_START = 4.0;
export const RAMP_MID = 0.6;
export const RAMP_END = 4.0;
export const DEFAULT_TRIM_DURATION = 1.00; // seconds of original video to use

/**
 * Create a V-shaped speed ramp: 4x → 0.6x → 4x
 * First half: deceleration (forward video)
 * Second half: acceleration (reversed video)
 */
export function createReverseSpeedRamp(trimDuration: number): SpeedRampPoint[] {
  const halfDuration = trimDuration / 2;
  return [
    { time: 0, speed: RAMP_START },
    { time: halfDuration, speed: RAMP_MID },
    { time: trimDuration, speed: RAMP_END },
  ];
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const useAppStore = create<AppState>((set) => ({
  clips: [],
  selectedClipId: null,
  processingState: {
    isProcessing: false,
    progress: 0,
    currentClipId: null,
    message: '',
  },

  addClip: (clip) => set((state) => ({
    clips: [...state.clips, clip],
    selectedClipId: clip.id,
  })),

  removeClip: (id) => set((state) => ({
    clips: state.clips.filter(c => c.id !== id),
    selectedClipId: state.selectedClipId === id
      ? (state.clips.find(c => c.id !== id)?.id || null)
      : state.selectedClipId,
  })),

  selectClip: (id) => set({ selectedClipId: id }),

  updateClip: (id, updates) => set((state) => ({
    clips: state.clips.map(c => c.id === id ? { ...c, ...updates } : c),
  })),

  setClipTrimDuration: (id, trimDuration) => set((state) => ({
    clips: state.clips.map(c => c.id === id
      ? { ...c, trimDuration, speedRamps: createReverseSpeedRamp(trimDuration) }
      : c
    ),
  })),

  setProcessingState: (newState) => set((state) => ({
    processingState: { ...state.processingState, ...newState },
  })),

  setClipStatus: (id, status, error) => set((state) => ({
    clips: state.clips.map(c => c.id === id ? { ...c, status, error } : c),
  })),

  setClipProcessedUrl: (id, url) => set((state) => ({
    clips: state.clips.map(c => c.id === id ? { ...c, processedUrl: url } : c),
  })),

  clearAllClips: () => set({ clips: [], selectedClipId: null }),
}));
