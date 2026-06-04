import { create } from 'zustand';
import type { AppState, VideoClip, SpeedRampPoint } from './types';

// Normal: 4x → 0.6x (decelerate)
export const NORMAL_RAMP: [number, number] = [4.0, 0.6];
// Reversed: 0.6x → 4x (accelerate)
export const REVERSED_RAMP: [number, number] = [0.6, 4.0];

export function createSpeedRamp(startSpeed: number, endSpeed: number, duration: number): SpeedRampPoint[] {
  return [
    { time: 0, speed: startSpeed },
    { time: duration, speed: endSpeed },
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

  addClip: (clip) => set((state) => {
    // Auto-create reversed clip alongside the original
    // The reversed clip's sourceClipId = clip.id so the process API can find the uploaded file
    const reversedId = `rev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const reversedClip: VideoClip = {
      ...clip,
      id: reversedId,
      originalName: `${clip.originalName} (reversed)`,
      sourceClipId: clip.id, // KEY: points to original clip's ID for file lookup
      speedRamps: createSpeedRamp(REVERSED_RAMP[0], REVERSED_RAMP[1], clip.duration),
      status: 'ready',
      processedUrl: undefined,
      error: undefined,
    };

    return {
      clips: [...state.clips, clip, reversedClip],
      selectedClipId: state.selectedClipId || clip.id,
    };
  }),

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

  setClipTrim: (id, trimStart, trimEnd) => set((state) => ({
    clips: state.clips.map(c => c.id === id ? { ...c, trimStart, trimEnd } : c),
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
