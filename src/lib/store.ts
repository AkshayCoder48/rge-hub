import { create } from 'zustand';
import type { AppState, VideoClip, SpeedRampPoint, InterpolationClip, InterpolationState, InterpolationMode, MotionBlurClip, MotionBlurSettings, MotionBlurProcessingState } from './types';

// Speed ramp configuration: V-shaped 4x → 0.6x → 4x
export const RAMP_START = 4.0;
export const RAMP_MID = 0.6;
export const RAMP_END = 4.0;
export const DEFAULT_TRIM_DURATION = 1.00; // seconds of original video to use
export const DEFAULT_INTERPOLATION_FPS = 120;

export const DEFAULT_MOTION_BLUR: MotionBlurSettings = {
  enabled: false,
  frames: 2,
  mode: 'average',
};

export const DEFAULT_INTERPOLATION_MODE: InterpolationMode = 'mci';

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

  setClipMotionBlur: (id, settings) => set((state) => ({
    clips: state.clips.map(c => c.id === id
      ? { ...c, motionBlur: { ...c.motionBlur, ...settings } }
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

  // Interpolation clips
  interpolationClips: [],
  selectedInterpolationClipId: null,

  selectInterpolationClip: (id) => set({ selectedInterpolationClipId: id }),

  addInterpolationClip: (clip) => set((state) => ({
    interpolationClips: [...state.interpolationClips, clip],
    selectedInterpolationClipId: clip.id,
  })),

  removeInterpolationClip: (id) => set((state) => ({
    interpolationClips: state.interpolationClips.filter(c => c.id !== id),
    selectedInterpolationClipId: state.selectedInterpolationClipId === id
      ? (state.interpolationClips.find(c => c.id !== id)?.id || null)
      : state.selectedInterpolationClipId,
  })),

  setInterpolationClipStatus: (id, status, error) => set((state) => ({
    interpolationClips: state.interpolationClips.map(c => c.id === id ? { ...c, status, error } : c),
  })),

  setInterpolationClipProcessedUrl: (id, url) => set((state) => ({
    interpolationClips: state.interpolationClips.map(c => c.id === id ? { ...c, processedUrl: url } : c),
  })),

  setInterpolationClipTargetFps: (id, fps) => set((state) => ({
    interpolationClips: state.interpolationClips.map(c => c.id === id ? { ...c, targetFps: fps } : c),
  })),

  setInterpolationClipMode: (id, mode) => set((state) => ({
    interpolationClips: state.interpolationClips.map(c => c.id === id ? { ...c, interpolationMode: mode } : c),
  })),

  setInterpolationClipMotionBlur: (id, settings) => set((state) => ({
    interpolationClips: state.interpolationClips.map(c => c.id === id
      ? { ...c, motionBlur: { ...c.motionBlur, ...settings } }
      : c
    ),
  })),

  clearAllInterpolationClips: () => set({ interpolationClips: [], selectedInterpolationClipId: null }),

  // Interpolation processing state
  interpolationState: {
    isProcessing: false,
    progress: 0,
    currentClipId: null,
    message: '',
  },

  setInterpolationState: (newState) => set((state) => ({
    interpolationState: { ...state.interpolationState, ...newState },
  })),

  // Motion blur clips (standalone)
  motionBlurClips: [],
  selectedMotionBlurClipId: null,

  selectMotionBlurClip: (id) => set({ selectedMotionBlurClipId: id }),

  addMotionBlurClip: (clip) => set((state) => ({
    motionBlurClips: [...state.motionBlurClips, clip],
    selectedMotionBlurClipId: clip.id,
  })),

  removeMotionBlurClip: (id) => set((state) => ({
    motionBlurClips: state.motionBlurClips.filter(c => c.id !== id),
    selectedMotionBlurClipId: state.selectedMotionBlurClipId === id
      ? (state.motionBlurClips.find(c => c.id !== id)?.id || null)
      : state.selectedMotionBlurClipId,
  })),

  setMotionBlurClipStatus: (id, status, error) => set((state) => ({
    motionBlurClips: state.motionBlurClips.map(c => c.id === id ? { ...c, status, error } : c),
  })),

  setMotionBlurClipProcessedUrl: (id, url) => set((state) => ({
    motionBlurClips: state.motionBlurClips.map(c => c.id === id ? { ...c, processedUrl: url } : c),
  })),

  setMotionBlurClipSettings: (id, settings) => set((state) => ({
    motionBlurClips: state.motionBlurClips.map(c => c.id === id ? { ...c, ...settings } : c),
  })),

  clearAllMotionBlurClips: () => set({ motionBlurClips: [], selectedMotionBlurClipId: null }),

  // Motion blur processing state
  motionBlurState: {
    isProcessing: false,
    progress: 0,
    currentClipId: null,
    message: '',
  },

  setMotionBlurState: (newState) => set((state) => ({
    motionBlurState: { ...state.motionBlurState, ...newState },
  })),

  // Tab navigation
  activeTab: 'speedramp',

  setActiveTab: (tab) => set({ activeTab: tab }),
}));
