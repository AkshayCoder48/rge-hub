export interface MotionBlurSettings {
  enabled: boolean;
  frames: number; // Number of frames to blend (1-10), default 2
  mode: 'average' | 'light' | 'heavy'; // Blend mode
}

export interface VideoClip {
  id: string;
  fileName: string;
  originalName: string;
  duration: number; // Original full video duration
  width: number;
  height: number;
  fps: number;
  codec: string;
  bitrate: number;
  format: string;
  fileSize: number;
  url: string;
  trimDuration: number; // How many seconds of the original to use (default: 1.00)
  speedRamps: SpeedRampPoint[]; // V-shaped: 4x → 0.6x → 4x
  motionBlur: MotionBlurSettings; // Motion blur settings
  processedUrl?: string;
  status: 'idle' | 'ready' | 'processing' | 'done' | 'error';
  error?: string;
}

export interface SpeedRampPoint {
  time: number;
  speed: number;
}

export interface ProcessingState {
  isProcessing: boolean;
  progress: number;
  currentClipId: string | null;
  message: string;
}

// Interpolation mode: MCI = motion compensated (high quality), blend = fast blending, framerate = lightweight
export type InterpolationMode = 'mci' | 'blend' | 'framerate';

export interface InterpolationClip {
  id: string;
  fileName: string;
  originalName: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  bitrate: number;
  format: string;
  fileSize: number;
  url: string;
  targetFps: number; // default 120
  interpolationMode: InterpolationMode; // default 'mci'
  motionBlur: MotionBlurSettings; // Motion blur settings
  processedUrl?: string;
  status: 'idle' | 'ready' | 'processing' | 'done' | 'error';
  error?: string;
}

export interface InterpolationState {
  isProcessing: boolean;
  progress: number;
  currentClipId: string | null;
  message: string;
}

// Standalone motion blur clip type
export type MotionBlurFilterType = 'tblend' | 'tmix';

export interface MotionBlurClip {
  id: string;
  fileName: string;
  originalName: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  bitrate: number;
  format: string;
  fileSize: number;
  url: string;
  // Motion blur specific settings
  filterType: MotionBlurFilterType; // 'tblend' or 'tmix'
  frames: number; // Number of frames to blend (2-16)
  intensity: 'light' | 'average' | 'heavy'; // Filter passes/intensity
  processedUrl?: string;
  status: 'idle' | 'ready' | 'processing' | 'done' | 'error';
  error?: string;
}

export interface MotionBlurProcessingState {
  isProcessing: boolean;
  progress: number;
  currentClipId: string | null;
  message: string;
}

export type ActiveTab = 'speedramp' | 'interpolation' | 'motionblur';

export interface AppState {
  clips: VideoClip[];
  selectedClipId: string | null;
  processingState: ProcessingState;
  addClip: (clip: VideoClip) => void;
  removeClip: (id: string) => void;
  selectClip: (id: string | null) => void;
  updateClip: (id: string, updates: Partial<VideoClip>) => void;
  setClipTrimDuration: (id: string, trimDuration: number) => void;
  setClipMotionBlur: (id: string, settings: Partial<MotionBlurSettings>) => void;
  setProcessingState: (state: Partial<ProcessingState>) => void;
  setClipStatus: (id: string, status: VideoClip['status'], error?: string) => void;
  setClipProcessedUrl: (id: string, url: string) => void;
  clearAllClips: () => void;
  // Interpolation clips
  interpolationClips: InterpolationClip[];
  selectedInterpolationClipId: string | null;
  selectInterpolationClip: (id: string | null) => void;
  addInterpolationClip: (clip: InterpolationClip) => void;
  removeInterpolationClip: (id: string) => void;
  setInterpolationClipStatus: (id: string, status: InterpolationClip['status'], error?: string) => void;
  setInterpolationClipProcessedUrl: (id: string, url: string) => void;
  setInterpolationClipTargetFps: (id: string, fps: number) => void;
  setInterpolationClipMode: (id: string, mode: InterpolationMode) => void;
  setInterpolationClipMotionBlur: (id: string, settings: Partial<MotionBlurSettings>) => void;
  clearAllInterpolationClips: () => void;
  interpolationState: InterpolationState;
  setInterpolationState: (state: Partial<InterpolationState>) => void;
  // Motion blur clips (standalone)
  motionBlurClips: MotionBlurClip[];
  selectedMotionBlurClipId: string | null;
  selectMotionBlurClip: (id: string | null) => void;
  addMotionBlurClip: (clip: MotionBlurClip) => void;
  removeMotionBlurClip: (id: string) => void;
  setMotionBlurClipStatus: (id: string, status: MotionBlurClip['status'], error?: string) => void;
  setMotionBlurClipProcessedUrl: (id: string, url: string) => void;
  setMotionBlurClipSettings: (id: string, settings: Partial<Pick<MotionBlurClip, 'filterType' | 'frames' | 'intensity'>>) => void;
  clearAllMotionBlurClips: () => void;
  motionBlurState: MotionBlurProcessingState;
  setMotionBlurState: (state: Partial<MotionBlurProcessingState>) => void;
  // Tab navigation
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
}
