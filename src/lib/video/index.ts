/**
 * Video motion blur processing library — client-side only.
 *
 * All processing happens in the browser using WebCodecs API.
 * No backend API routes are needed.
 *
 * Usage:
 * ```ts
 * import { VideoMotionBlurProcessor, DEFAULT_MOTION_BLUR_CONFIG } from '@/lib/video';
 *
 * const processor = new VideoMotionBlurProcessor();
 * const result = await processor.process(file, {
 *   blurAmount: 5,
 *   blurStrength: 0.8,
 *   quality: 'balanced',
 *   outputFormat: 'mp4',
 * }, (progress) => {
 *   console.log(`${progress.stage}: ${progress.percent.toFixed(1)}%`);
 * });
 *
 * // Download the result
 * const url = URL.createObjectURL(result.blob);
 * ```
 */

// Types
export type {
  MotionBlurConfig,
  VideoMetadata,
  ProcessingProgress,
  ProcessingResult,
  ProgressCallback,
  DemuxResult,
  SampleInfo,
  AudioTrackData,
  AudioSampleInfo,
} from './types';

export { DEFAULT_MOTION_BLUR_CONFIG } from './types';

// Codec detection
export {
  isWebCodecsSupported,
  findSupportedDecoderCodec,
  findSupportedEncoderCodec,
  getCodecPriority,
  getCodecDisplayName,
  getDecoderConfig,
  getEncoderConfig,
  getMuxerCodec,
} from './codec-detection';

// Bitrate calculation
export { calculateBitrate, formatBitrate } from './bitrate-calculator';

// Demuxer
export { MP4Demuxer } from './mp4-demuxer';

// Temporal blur processor
export { TemporalBlurProcessor, generateWeights } from './temporal-blur';

// Muxer
export { MP4MuxerWrapper } from './mp4-muxer-wrapper';

// Main processor
export { VideoMotionBlurProcessor } from './video-processor';
