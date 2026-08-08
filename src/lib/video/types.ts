/**
 * Shared types for the client-side video motion blur processor.
 * All processing happens in the browser using WebCodecs API.
 */

/** Configuration for motion blur effect */
export interface MotionBlurConfig {
  /** Number of frames to blend (1-10). Higher = more blur trails. Default: 5 */
  blurAmount: number;
  /** Strength of blur contribution from previous frames (0-1). 0 = no blur, 1 = full blend. Default: 0.8 */
  blurStrength: number;
  /** Quality preset affecting bitrate and encoding speed. Default: 'balanced' */
  quality: 'performance' | 'balanced' | 'quality';
  /** Output container format. Default: 'mp4' */
  outputFormat: 'mp4' | 'webm';
}

/** Metadata extracted from a video file */
export interface VideoMetadata {
  filename: string;
  duration: number; // seconds
  width: number;
  height: number;
  fps: number;
  fileSize: number; // bytes
  codec: string;
  hasAudio: boolean;
}

/** Real-time progress during processing */
export interface ProcessingProgress {
  stage: 'demuxing' | 'decoding' | 'blurring' | 'encoding' | 'muxing' | 'done';
  /** Completion percentage 0-100 */
  percent: number;
  framesProcessed: number;
  totalFrames: number;
  /** Elapsed time in ms */
  elapsed: number;
  /** Estimated remaining time in ms */
  estimatedRemaining: number;
}

/** Final result of video processing */
export interface ProcessingResult {
  blob: Blob;
  filename: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
}

/** Progress callback type */
export type ProgressCallback = (progress: ProcessingProgress) => void;

/** Default motion blur configuration */
export const DEFAULT_MOTION_BLUR_CONFIG: MotionBlurConfig = {
  blurAmount: 5,
  blurStrength: 0.8,
  quality: 'balanced',
  outputFormat: 'mp4',
};

/** Result from demuxing an MP4 file */
export interface DemuxResult {
  trackInfo: {
    codec: string;
    width: number;
    height: number;
    framerate: number;
    duration: number; // microseconds
    totalFrames: number;
    description?: Uint8Array; // codec description (AVCC config for H.264)
  };
  samples: SampleInfo[];
  audioData?: AudioTrackData;
}

/** Information about a single encoded sample from the demuxer */
export interface SampleInfo {
  data: Uint8Array;
  timestamp: number; // microseconds
  duration: number; // microseconds
  isKeyFrame: boolean;
}

/** Raw audio track data for passthrough */
export interface AudioTrackData {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  samples: AudioSampleInfo[];
}

/** Information about a single audio sample */
export interface AudioSampleInfo {
  data: Uint8Array;
  timestamp: number; // microseconds
  duration: number; // microseconds
  isKeyFrame: boolean;
}
