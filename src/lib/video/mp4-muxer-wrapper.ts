/**
 * MP4 muxer wrapper using the mp4-muxer npm package.
 * Handles creating an MP4 file from encoded video chunks.
 *
 * Usage:
 *   const muxer = new MP4MuxerWrapper(width, height, codec, framerate);
 *   // ... encode frames ...
 *   muxer.addVideoChunk(chunk, meta);
 *   const blob = muxer.finalize();
 */

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import type { MotionBlurConfig } from './types';

/**
 * Map a WebCodecs codec string to an mp4-muxer VideoOptions codec.
 * mp4-muxer expects: 'avc' | 'hevc' | 'vp9' | 'av1'
 */
function toMuxerCodec(webCodecsCodec: string): 'avc' | 'hevc' | 'vp9' | 'av1' {
  if (webCodecsCodec.startsWith('avc1')) return 'avc';
  if (webCodecsCodec.startsWith('hvc1') || webCodecsCodec.startsWith('hev1')) return 'hevc';
  if (webCodecsCodec.startsWith('vp09')) return 'vp9';
  if (webCodecsCodec.startsWith('av01')) return 'av1';
  // Default to avc for H.264
  return 'avc';
}

/**
 * MP4MuxerWrapper encapsulates the mp4-muxer library for creating MP4 files.
 *
 * It handles:
 * - Video track configuration
 * - Adding encoded video chunks (from VideoEncoder output)
 * - Finalizing the muxed file as a Blob
 */
export class MP4MuxerWrapper {
  private target: ArrayBufferTarget;
  private muxer: Muxer<ArrayBufferTarget>;
  private outputFormat: MotionBlurConfig['outputFormat'];

  /**
   * @param width - Video width in pixels
   * @param height - Video height in pixels
   * @param codec - WebCodecs codec string (e.g., 'avc1.640028')
   * @param framerate - Video framerate in fps
   * @param outputFormat - Output format ('mp4' or 'webm')
   * @param expectedChunks - Estimated number of video chunks for fastStart reservation
   */
  constructor(
    width: number,
    height: number,
    codec: string,
    framerate: number,
    outputFormat: MotionBlurConfig['outputFormat'] = 'mp4',
    expectedChunks?: number
  ) {
    this.outputFormat = outputFormat;
    this.target = new ArrayBufferTarget();

    const muxerCodec = toMuxerCodec(codec);

    this.muxer = new Muxer({
      target: this.target,
      video: {
        codec: muxerCodec,
        width,
        height,
        frameRate: framerate,
      },
      // Use 'in-memory' fastStart for best compatibility (moov atom before mdat)
      // This keeps all chunks in memory until finalize, then reorders for fast start
      fastStart: expectedChunks
        ? { expectedVideoChunks: expectedChunks }
        : 'in-memory',
      // Offset timestamps so first chunk starts at 0
      firstTimestampBehavior: 'offset',
    });
  }

  /**
   * Add an encoded video chunk to the muxer.
   *
   * @param chunk - EncodedVideoChunk from VideoEncoder
   * @param meta - EncodedVideoChunkMetadata from VideoEncoder (needed for proper muxing)
   */
  addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void {
    if (meta) {
      this.muxer.addVideoChunk(chunk, meta);
    } else {
      this.muxer.addVideoChunk(chunk);
    }
  }

  /**
   * Add a raw video chunk (when you have raw data instead of EncodedVideoChunk).
   *
   * @param data - Raw encoded data
   * @param type - 'key' for keyframe, 'delta' for inter frame
   * @param timestamp - Presentation timestamp in microseconds
   * @param duration - Frame duration in microseconds
   * @param meta - Optional encoder metadata
   */
  addVideoChunkRaw(
    data: Uint8Array,
    type: 'key' | 'delta',
    timestamp: number,
    duration: number,
    meta?: EncodedVideoChunkMetadata
  ): void {
    this.muxer.addVideoChunkRaw(data, type, timestamp, duration, meta);
  }

  /**
   * Finalize the muxer and return the result as a Blob.
   *
   * MUST be called after all chunks have been added.
   * After calling this, the muxer cannot accept more chunks.
   *
   * @returns Blob containing the final MP4 file data
   */
  finalize(): Blob {
    this.muxer.finalize();

    const mimeType = this.outputFormat === 'webm' ? 'video/webm' : 'video/mp4';
    return new Blob([this.target.buffer], { type: mimeType });
  }

  /**
   * Get the raw ArrayBuffer after finalization.
   * Only call this after finalize().
   */
  getBuffer(): ArrayBuffer {
    return this.target.buffer;
  }
}
