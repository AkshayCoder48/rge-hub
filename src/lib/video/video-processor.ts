/**
 * Main video motion blur processor orchestrator.
 *
 * Coordinates the full pipeline:
 *   demux → decode → blur → encode → mux
 *
 * All processing happens CLIENT-SIDE using WebCodecs API.
 * No backend API routes are needed.
 *
 * Usage:
 *   const processor = new VideoMotionBlurProcessor();
 *   const result = await processor.process(file, config, onProgress);
 *   // result.blob contains the processed video
 *   // URL.createObjectURL(result.blob) to play/download
 */

import type {
  MotionBlurConfig,
  ProcessingProgress,
  ProcessingResult,
  ProgressCallback,
} from './types';
import { DEFAULT_MOTION_BLUR_CONFIG } from './types';
import { isWebCodecsSupported, findSupportedEncoderCodec, getDecoderConfig, getEncoderConfig } from './codec-detection';
import { calculateBitrate } from './bitrate-calculator';
import { MP4Demuxer } from './mp4-demuxer';
import { TemporalBlurProcessor } from './temporal-blur';
import { MP4MuxerWrapper } from './mp4-muxer-wrapper';

/**
 * VideoMotionBlurProcessor orchestrates the entire motion blur pipeline.
 *
 * Pipeline stages:
 * 1. demuxing   — Parse MP4 file, extract track info and encoded samples
 * 2. decoding   — Decode each sample to raw VideoFrame using WebCodecs
 * 3. blurring   — Blend consecutive frames for motion blur effect
 * 4. encoding   — Encode blurred frames back to compressed video
 * 5. muxing     — Combine encoded chunks into output MP4 file
 *
 * The processor supports cancellation via AbortController and ensures
 * proper memory cleanup in finally blocks.
 */
export class VideoMotionBlurProcessor {
  private abortController: AbortController = new AbortController();
  private isProcessing = false;

  /**
   * Process a video file with motion blur effect.
   *
   * @param file - Input video file (MP4 format)
   * @param config - Motion blur configuration
   * @param onProgress - Callback for progress updates
   * @returns ProcessingResult with output blob and metadata
   * @throws Error if WebCodecs not supported, no codec available, or cancelled
   */
  async process(
    file: File,
    config: MotionBlurConfig = DEFAULT_MOTION_BLUR_CONFIG,
    onProgress: ProgressCallback = () => {}
  ): Promise<ProcessingResult> {
    if (this.isProcessing) {
      throw new Error('Processor is already running. Cancel the current operation first.');
    }

    if (!isWebCodecsSupported()) {
      throw new Error(
        'WebCodecs API is not supported in this browser. ' +
        'Please use Chrome 94+ or Edge 94+.'
      );
    }

    this.isProcessing = true;
    this.abortController = new AbortController();
    const startTime = performance.now();

    // Track all resources for cleanup
    let decoder: VideoDecoder | null = null;
    let encoder: VideoEncoder | null = null;
    let blurProcessor: TemporalBlurProcessor | null = null;
    let muxer: MP4MuxerWrapper | null = null;
    let demuxer: MP4Demuxer | null = null;

    // Decoded frame queue for coordinating decoder → blur → encoder
    let pendingDecodeCount = 0;
    let decodeResolve: (() => void) | null = null;
    const decodeQueue: VideoFrame[] = [];

    // Encoded chunk queue for coordinating encoder → muxer
    let pendingEncodeCount = 0;
    let encodeResolve: (() => void) | null = null;

    const signal = this.abortController.signal;

    const checkCancelled = () => {
      if (signal.aborted) {
        throw new DOMException('Processing was cancelled', 'AbortError');
      }
    };

    const emitProgress = (
      stage: ProcessingProgress['stage'],
      percent: number,
      framesProcessed: number,
      totalFrames: number
    ) => {
      const elapsed = performance.now() - startTime;
      const estimatedRemaining = percent > 0
        ? (elapsed / percent) * (100 - percent)
        : 0;

      onProgress({
        stage,
        percent: Math.min(100, Math.max(0, percent)),
        framesProcessed,
        totalFrames,
        elapsed: Math.round(elapsed),
        estimatedRemaining: Math.round(estimatedRemaining),
      });
    };

    try {
      // === STAGE 1: Demuxing ===
      emitProgress('demuxing', 0, 0, 0);

      demuxer = new MP4Demuxer();
      const demuxResult = await demuxer.demux(file);
      const { trackInfo, samples } = demuxResult;

      checkCancelled();

      const {
        codec: sourceCodec,
        width,
        height,
        framerate,
        duration: durationUs,
        totalFrames,
        description,
      } = trackInfo;

      const duration = durationUs / 1_000_000; // Convert to seconds
      const fps = Math.round(framerate) || 30;

      emitProgress('demuxing', 100, 0, totalFrames);

      // === STAGE 2: Find encoder codec ===
      const encoderCodec = await findSupportedEncoderCodec(width, height, fps);
      if (!encoderCodec) {
        throw new Error(
          'No supported video encoder codec found. ' +
          'Try using Chrome 94+ or Edge 94+ for H.264/VP9 support.'
        );
      }

      checkCancelled();

      // === Calculate bitrate ===
      const bitrate = calculateBitrate(width, height, fps, config.quality);

      // === STAGE 3: Set up decoder ===
      const decoderConfig = getDecoderConfig(sourceCodec, width, height, description);

      // Verify decoder config is supported
      const decoderSupport = await VideoDecoder.isConfigSupported(decoderConfig);
      if (!decoderSupport.supported) {
        throw new Error(
          `Decoder config not supported for codec "${sourceCodec}". ` +
          'The video codec may not be supported by your browser.'
        );
      }

      // === STAGE 4: Set up encoder ===
      const encoderConfig = getEncoderConfig(encoderCodec, width, height, fps, bitrate);

      // Verify encoder config is supported
      const encoderSupport = await VideoEncoder.isConfigSupported(encoderConfig);
      if (!encoderSupport.supported) {
        throw new Error(
          `Encoder config not supported for codec "${encoderCodec}".`
        );
      }

      checkCancelled();

      // === Create processing components ===
      blurProcessor = new TemporalBlurProcessor(width, height, config);
      muxer = new MP4MuxerWrapper(width, height, encoderCodec, fps, config.outputFormat, totalFrames);

      // === Create decoder ===
      let decoderKeyframeReceived = false;

      decoder = new VideoDecoder({
        output: (frame: VideoFrame) => {
          // Add decoded frame to the blur processor
          blurProcessor!.addFrame(frame);

          // Get the blended frame
          const blendedFrame = blurProcessor!.getBlendedFrame();

          // Queue the blended frame for encoding
          decodeQueue.push(blendedFrame);

          // If we're waiting for a frame, resolve
          pendingDecodeCount--;
          if (decodeResolve && pendingDecodeCount <= 0) {
            decodeResolve();
            decodeResolve = null;
          }
        },
        error: (e: DOMException) => {
          console.error('Decoder error:', e);
        },
      });

      decoder.configure(decoderConfig);

      // === Create encoder ===
      let frameCounter = 0;
      const encodedChunks: { chunk: EncodedVideoChunk; meta?: EncodedVideoChunkMetadata }[] = [];

      encoder = new VideoEncoder({
        output: (
          chunk: EncodedVideoChunk,
          meta?: EncodedVideoChunkMetadata
        ) => {
          // Add encoded chunk to muxer
          muxer!.addVideoChunk(chunk, meta);
          encodedChunks.push({ chunk, meta });

          pendingEncodeCount--;
          if (encodeResolve && pendingEncodeCount <= 0) {
            encodeResolve();
            encodeResolve = null;
          }
        },
        error: (e: DOMException) => {
          console.error('Encoder error:', e);
        },
      });

      encoder.configure(encoderConfig);

      // === STAGE 5: Process samples ===
      // For each encoded sample: decode → blur → encode

      for (let i = 0; i < samples.length; i++) {
        checkCancelled();

        const sample = samples[i];
        const chunk = MP4Demuxer.sampleToChunk(sample);

        // Track progress (split across stages)
        const overallPercent = (i / samples.length) * 90; // 90% for processing, 10% for finalization
        const stagePercent = (i / samples.length) * 100;

        // Alternate progress between decoding and encoding for smooth display
        if (i % 2 === 0) {
          emitProgress('decoding', overallPercent, i, totalFrames);
        } else {
          emitProgress('blurring', overallPercent, i, totalFrames);
        }

        // For the first keyframe, we need to ensure the decoder is ready
        if (sample.isKeyFrame && !decoderKeyframeReceived) {
          decoderKeyframeReceived = true;
        }

        // Decode the sample
        pendingDecodeCount++;
        decoder.decode(chunk);

        // Wait for the decoded frame to be processed
        if (pendingDecodeCount > 0) {
          await new Promise<void>((resolve) => {
            decodeResolve = resolve;
          });
        }

        // Encode the blended frame(s) from the queue
        while (decodeQueue.length > 0) {
          const blendedFrame = decodeQueue.shift()!;

          // For the first frame, force a keyframe
          const isKeyFrame = frameCounter === 0;

          pendingEncodeCount++;
          encoder.encode(blendedFrame, { keyFrame: isKeyFrame });

          // Close the blended frame — it's been encoded
          blendedFrame.close();

          frameCounter++;

          // Periodically emit encoding progress
          if (frameCounter % 10 === 0) {
            emitProgress('encoding', overallPercent + 2, i, totalFrames);
          }
        }

        // Wait for encoding to complete periodically (every 30 frames)
        // to prevent backpressure issues
        if (i % 30 === 0 && encoder.state === 'configured') {
          // Small yield to let the event loop process
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }

      // === STAGE 6: Flush decoder ===
      if (decoder.state === 'configured') {
        await decoder.flush();
      }

      // Process any remaining decoded frames
      while (decodeQueue.length > 0) {
        const blendedFrame = decodeQueue.shift()!;
        pendingEncodeCount++;
        encoder.encode(blendedFrame, { keyFrame: false });
        blendedFrame.close();
        frameCounter++;
      }

      // === STAGE 7: Flush encoder ===
      emitProgress('encoding', 92, totalFrames, totalFrames);

      if (encoder.state === 'configured') {
        await encoder.flush();
      }

      // Wait for any remaining encode promises
      if (pendingEncodeCount > 0) {
        await new Promise<void>((resolve) => {
          encodeResolve = resolve;
        });
      }

      // === STAGE 8: Finalize muxer ===
      emitProgress('muxing', 95, totalFrames, totalFrames);

      const blob = muxer.finalize();

      // === Done ===
      emitProgress('done', 100, totalFrames, totalFrames);

      // Generate output filename
      const originalName = file.name.replace(/\.[^/.]+$/, '');
      const ext = config.outputFormat === 'webm' ? '.webm' : '.mp4';
      const outputFilename = `${originalName}_motionblur${ext}`;

      return {
        blob,
        filename: outputFilename,
        duration,
        width,
        height,
        fps,
        codec: encoderCodec,
      };
    } finally {
      // === Cleanup all resources ===
      this.isProcessing = false;

      // Close decoder
      if (decoder) {
        try {
          if (decoder.state !== 'closed') {
            decoder.close();
          }
        } catch {
          // Ignore cleanup errors
        }
      }

      // Close encoder
      if (encoder) {
        try {
          if (encoder.state !== 'closed') {
            encoder.close();
          }
        } catch {
          // Ignore cleanup errors
        }
      }

      // Dispose blur processor
      if (blurProcessor) {
        try {
          blurProcessor.dispose();
        } catch {
          // Ignore cleanup errors
        }
      }

      // Dispose demuxer
      if (demuxer) {
        try {
          demuxer.dispose();
        } catch {
          // Ignore cleanup errors
        }
      }

      // Muxer doesn't need explicit cleanup after finalize
      muxer = null;
    }
  }

  /**
   * Cancel the current processing operation.
   * The process() promise will reject with an AbortError.
   */
  cancel(): void {
    if (this.abortController && !this.abortController.signal.aborted) {
      this.abortController.abort();
    }
  }

  /**
   * Check if the processor is currently running.
   */
  get running(): boolean {
    return this.isProcessing;
  }
}
