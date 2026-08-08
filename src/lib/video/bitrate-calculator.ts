/**
 * Bitrate calculator for video encoding.
 * Calculates appropriate bitrate based on resolution, fps, and quality setting.
 * NO hardcoded 5Mbps — uses sensible ranges per resolution tier.
 */

import type { MotionBlurConfig } from './types';

/** Resolution tier thresholds */
const RESOLUTION_TIERS = {
  /** 480p: up to 854×480 */
  p480: { maxWidth: 854, maxHeight: 480, minBitrate: 2_000_000, maxBitrate: 4_000_000 },
  /** 720p: up to 1280×720 */
  p720: { maxWidth: 1280, maxHeight: 720, minBitrate: 4_000_000, maxBitrate: 8_000_000 },
  /** 1080p: up to 1920×1080 */
  p1080: { maxWidth: 1920, maxHeight: 1080, minBitrate: 8_000_000, maxBitrate: 15_000_000 },
  /** 4K: up to 3840×2160 */
  p4k: { maxWidth: 3840, maxHeight: 2160, minBitrate: 20_000_000, maxBitrate: 40_000_000 },
} as const;

/** Quality multiplier: affects where in the min-max range we land */
const QUALITY_MULTIPLIER: Record<MotionBlurConfig['quality'], number> = {
  performance: 0.6,
  balanced: 1.0,
  quality: 1.5,
};

/**
 * Determine the resolution tier for a given width/height.
 * Returns the tier key matching the video resolution.
 */
function getResolutionTier(
  width: number,
  height: number
): keyof typeof RESOLUTION_TIERS {
  // Check from highest to lowest
  if (width <= RESOLUTION_TIERS.p4k.maxWidth && height <= RESOLUTION_TIERS.p4k.maxHeight) {
    if (width > RESOLUTION_TIERS.p1080.maxWidth || height > RESOLUTION_TIERS.p1080.maxHeight) {
      return 'p4k';
    }
    if (width > RESOLUTION_TIERS.p720.maxWidth || height > RESOLUTION_TIERS.p720.maxHeight) {
      return 'p1080';
    }
    if (width > RESOLUTION_TIERS.p480.maxWidth || height > RESOLUTION_TIERS.p480.maxHeight) {
      return 'p720';
    }
    return 'p480';
  }
  // Above 4K, use 4K tier
  return 'p4k';
}

/**
 * Calculate the bitrate for video encoding based on resolution, fps, and quality.
 *
 * The calculation works as follows:
 * 1. Determine the resolution tier (480p, 720p, 1080p, 4K)
 * 2. Get the min/max bitrate range for that tier
 * 3. Use fps scaling factor: higher fps = higher bitrate (normalized to 30fps baseline)
 * 4. Apply quality multiplier to scale within the range
 *
 * @param width - Video width in pixels
 * @param height - Video height in pixels
 * @param fps - Video framerate in fps
 * @param quality - Quality preset
 * @returns Bitrate in bits per second
 */
export function calculateBitrate(
  width: number,
  height: number,
  fps: number,
  quality: MotionBlurConfig['quality']
): number {
  const tier = getResolutionTier(width, height);
  const tierConfig = RESOLUTION_TIERS[tier];

  // Base bitrate: midpoint of the tier range
  const baseBitrate = (tierConfig.minBitrate + tierConfig.maxBitrate) / 2;

  // FPS scaling: normalize to 30fps baseline
  // At 60fps we need ~1.5x bitrate, at 24fps we need ~0.85x
  const fpsScale = Math.pow(fps / 30, 0.7);

  // Quality multiplier
  const qualityMult = QUALITY_MULTIPLIER[quality];

  // Calculate final bitrate
  let bitrate = baseBitrate * fpsScale * qualityMult;

  // Clamp to tier range (adjusted for quality)
  const adjustedMin = tierConfig.minBitrate * qualityMult;
  const adjustedMax = tierConfig.maxBitrate * qualityMult;
  bitrate = Math.max(adjustedMin, Math.min(adjustedMax, bitrate));

  // Round to nearest 100kbps for cleaner values
  return Math.round(bitrate / 100_000) * 100_000;
}

/**
 * Format a bitrate value as a human-readable string.
 * E.g., 5000000 → "5.0 Mbps"
 */
export function formatBitrate(bitrate: number): string {
  const mbps = bitrate / 1_000_000;
  return `${mbps.toFixed(1)} Mbps`;
}
