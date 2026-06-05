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

export interface AppState {
  clips: VideoClip[];
  selectedClipId: string | null;
  processingState: ProcessingState;
  addClip: (clip: VideoClip) => void;
  removeClip: (id: string) => void;
  selectClip: (id: string | null) => void;
  updateClip: (id: string, updates: Partial<VideoClip>) => void;
  setClipTrimDuration: (id: string, trimDuration: number) => void;
  setProcessingState: (state: Partial<ProcessingState>) => void;
  setClipStatus: (id: string, status: VideoClip['status'], error?: string) => void;
  setClipProcessedUrl: (id: string, url: string) => void;
  clearAllClips: () => void;
}
