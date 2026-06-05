export interface VideoClip {
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
  sourceClipId?: string; // Points to the ORIGINAL clip's ID for finding the uploaded file
  trimStart: number;
  trimEnd: number;
  speedRamps: SpeedRampPoint[]; // Just 2 points: start speed → end speed
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
  setClipTrim: (id: string, trimStart: number, trimEnd: number) => void;
  setProcessingState: (state: Partial<ProcessingState>) => void;
  setClipStatus: (id: string, status: VideoClip['status'], error?: string) => void;
  setClipProcessedUrl: (id: string, url: string) => void;
  clearAllClips: () => void;
}
