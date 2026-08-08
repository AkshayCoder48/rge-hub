/**
 * Temporal blur processor using Canvas 2D frame blending.
 * Implements a rolling frame buffer with configurable blur amount and strength.
 *
 * The processor accumulates VideoFrames in a bounded buffer, then blends them
 * with weighted alpha compositing onto an OffscreenCanvas. The blended result
 * is captured as a new VideoFrame for encoding.
 *
 * CRITICAL: Every VideoFrame added to the buffer is tracked and eventually
 * closed to prevent memory leaks. The caller must also close the returned
 * blended frame when done with it.
 */

import type { MotionBlurConfig } from './types';

/**
 * Generate normalized blending weights for the given blur amount.
 *
 * For blurAmount=5 with default linear weights: [0.1, 0.15, 0.2, 0.25, 0.3]
 * The most recent frame gets the highest weight.
 * Weights are normalized so they sum to 1.0.
 *
 * @param blurAmount - Number of frames to blend (1-10)
 * @returns Array of weights, one per frame in the buffer (oldest first)
 */
export function generateWeights(blurAmount: number): number[] {
  if (blurAmount <= 1) return [1.0];

  // Linear weighting: each successive frame (newer) gets more weight
  // Frame 0 (oldest) = 1, frame 1 = 2, ..., frame N-1 (newest) = N
  const rawWeights: number[] = [];
  for (let i = 0; i < blurAmount; i++) {
    rawWeights.push(i + 1);
  }

  // Normalize to sum = 1
  const sum = rawWeights.reduce((a, b) => a + b, 0);
  return rawWeights.map((w) => w / sum);
}

/**
 * TemporalBlurProcessor performs motion blur by blending consecutive video frames.
 *
 * How it works:
 * 1. Frames are added to a rolling buffer (max size = blurAmount)
 * 2. When the buffer is full, the oldest frame is dropped
 * 3. To blend, frames are composited onto OffscreenCanvas with weighted alpha
 * 4. blurStrength controls interpolation between original frame and fully blended frame
 *    - strength=0: return the current (newest) frame unchanged (no blur)
 *    - strength=1: return the fully blended frame (maximum blur)
 *    - strength=0.5: 50/50 mix of original and blended
 *
 * Memory management:
 * - Every VideoFrame in the buffer is tracked
 * - When the buffer overflows, the oldest frame is closed
 * - reset() closes all buffered frames
 * - dispose() closes all frames and releases the canvas
 */
export class TemporalBlurProcessor {
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  /** Temporary canvas for strength interpolation compositing */
  private tempCanvas: OffscreenCanvas;
  private tempCtx: OffscreenCanvasRenderingContext2D;
  private frameBuffer: VideoFrame[] = [];
  private config: MotionBlurConfig;
  private weights: number[];

  /**
   * @param width - Video frame width in pixels
   * @param height - Video frame height in pixels
   * @param config - Motion blur configuration
   */
  constructor(width: number, height: number, config: MotionBlurConfig) {
    this.canvas = new OffscreenCanvas(width, height);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context from OffscreenCanvas');
    }
    this.ctx = ctx;

    this.tempCanvas = new OffscreenCanvas(width, height);
    const tempCtx = this.tempCanvas.getContext('2d');
    if (!tempCtx) {
      throw new Error('Failed to get 2D context from temporary OffscreenCanvas');
    }
    this.tempCtx = tempCtx;

    this.config = config;
    this.weights = generateWeights(config.blurAmount);
  }

  /**
   * Add a new frame to the rolling buffer.
   * If the buffer exceeds blurAmount, the oldest frame is closed and removed.
   *
   * IMPORTANT: The caller should NOT close this frame — the processor takes
   * ownership and will close it when it's evicted from the buffer or on reset/dispose.
   */
  addFrame(frame: VideoFrame): void {
    this.frameBuffer.push(frame);

    // Evict oldest frames if buffer exceeds max size
    while (this.frameBuffer.length > this.config.blurAmount) {
      const oldest = this.frameBuffer.shift();
      oldest?.close();
    }

    // Regenerate weights if buffer size changed (e.g., first few frames)
    if (this.frameBuffer.length !== this.weights.length) {
      this.weights = generateWeights(this.frameBuffer.length);
    }
  }

  /**
   * Blend all frames in the buffer and return the result as a new VideoFrame.
   *
   * The blending uses weighted alpha compositing:
   * - Clear the canvas
   * - For each frame (oldest to newest), draw it with its weighted alpha
   * - If blurStrength < 1, interpolate between the newest frame and the blend
   * - Capture the canvas as a new VideoFrame
   *
   * CRITICAL: The returned VideoFrame must be closed by the caller when done.
   *
   * @returns A new VideoFrame containing the blended result
   */
  getBlendedFrame(): VideoFrame {
    if (this.frameBuffer.length === 0) {
      throw new Error('No frames in buffer to blend');
    }

    const width = this.canvas.width;
    const height = this.canvas.height;
    const currentFrame = this.frameBuffer[this.frameBuffer.length - 1];

    // If only one frame or blur disabled, just capture the current frame
    if (this.frameBuffer.length === 1 || this.config.blurStrength <= 0) {
      return new VideoFrame(currentFrame);
    }

    // --- Step 1: Weighted alpha compositing of all frames ---
    // Draw each frame from oldest to newest with its respective weight as globalAlpha
    // Since weights sum to 1.0, this produces a properly weighted blend
    this.ctx.clearRect(0, 0, width, height);

    for (let i = 0; i < this.frameBuffer.length; i++) {
      this.ctx.globalAlpha = this.weights[i];
      this.ctx.drawImage(this.frameBuffer[i], 0, 0, width, height);
    }
    this.ctx.globalAlpha = 1.0;

    // --- Step 2: Apply blur strength interpolation ---
    // blurStrength controls how much the blend replaces the original:
    //   result = original * (1 - strength) + blended * strength
    // When strength=1, we use the full blend (maximum blur)
    // When strength=0, we use the original frame (no blur)
    if (this.config.blurStrength < 1) {
      // Copy the blended result to temp canvas
      this.tempCtx.clearRect(0, 0, width, height);
      this.tempCtx.drawImage(this.canvas, 0, 0);

      // Draw the current (unblurred) frame as the base
      this.ctx.clearRect(0, 0, width, height);
      this.ctx.globalAlpha = 1.0;
      this.ctx.drawImage(currentFrame, 0, 0, width, height);

      // Overlay the blended result at blurStrength opacity
      this.ctx.globalAlpha = this.config.blurStrength;
      this.ctx.drawImage(this.tempCanvas, 0, 0, width, height);
      this.ctx.globalAlpha = 1.0;
    }

    // Capture the final result as a new VideoFrame
    return new VideoFrame(this.canvas, 0, 0, width, height);
  }

  /**
   * Get the current number of frames in the buffer.
   */
  get bufferSize(): number {
    return this.frameBuffer.length;
  }

  /**
   * Check if the buffer has enough frames to produce a full blend.
   */
  get isBufferFull(): boolean {
    return this.frameBuffer.length >= this.config.blurAmount;
  }

  /**
   * Reset the processor, closing all buffered frames.
   * Keeps the canvas and context for reuse.
   */
  reset(): void {
    for (const frame of this.frameBuffer) {
      try {
        frame.close();
      } catch {
        // Frame may already be closed
      }
    }
    this.frameBuffer = [];
    this.weights = generateWeights(this.config.blurAmount);
  }

  /**
   * Dispose of all resources. Closes all frames and clears canvases.
   */
  dispose(): void {
    this.reset();
    try {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);
    } catch {
      // Ignore if canvas is already disposed
    }
  }
}
