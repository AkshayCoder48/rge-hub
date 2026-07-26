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
  trimDuration: number;
  speedRamps: SpeedRampPoint[];
  processedUrl?: string;
  processedBlob?: Blob; // Client-side only: holds processed video blob for download
  status: 'idle' | 'ready' | 'processing' | 'done' | 'error';
  error?: string;
  hasAudio: boolean;
  originalFile?: File; // Client-side only: original file for re-uploading during process
}

export interface AppState {
  clips: VideoClip[];
  selectedClipId: string | null;
  processingState: ProcessingState;
  addClip: (clip: VideoClip) => void;
  removeClip: (id: string) => void;
  selectClip: (id: string | null) => void;
  setClipTrimDuration: (id: string, trimDuration: number) => void;
  setProcessingState: (state: Partial<ProcessingState>) => void;
  setClipStatus: (id: string, status: VideoClip['status'], error?: string) => void;
  setClipProcessedUrl: (id: string, url: string) => void;
  setClipProcessedBlob: (id: string, blob: Blob) => void;
  clearAllClips: () => void;
}
