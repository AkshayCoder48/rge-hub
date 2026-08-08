/**
 * Codec detection and support checking for WebCodecs API.
 * Determines what codecs are available for encoding/decoding
 * and provides a fallback chain for browser compatibility.
 */

/** Codec priority chain: H.264 → VP9 → VP8 */
const CODEC_PRIORITY = [
  'avc1.640028', // H.264 High Profile, Level 4.0
  'vp9',         // VP9
  'vp8',         // VP8
] as const;

/** Map from codec string to WebCodecs codec name for encoding */
const CODEC_NAME_MAP: Record<string, string> = {
  'avc1.640028': 'avc1.640028',
  'vp9': 'vp09.00.10.08',
  'vp8': 'vp8',
};

/** Map from codec to common name for display */
const CODEC_DISPLAY_NAME: Record<string, string> = {
  'avc1.640028': 'H.264',
  'vp9': 'VP9',
  'vp8': 'VP8',
};

/**
 * Check if the WebCodecs API is available in this browser.
 * WebCodecs requires both VideoDecoder and VideoEncoder constructors.
 */
export function isWebCodecsSupported(): boolean {
  return (
    typeof VideoDecoder !== 'undefined' &&
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined' &&
    typeof EncodedVideoChunk !== 'undefined'
  );
}

/**
 * Get the ordered list of codec strings to try, from most to least preferred.
 */
export function getCodecPriority(): string[] {
  return [...CODEC_PRIORITY];
}

/**
 * Get the display name for a codec string.
 */
export function getCodecDisplayName(codec: string): string {
  return CODEC_DISPLAY_NAME[codec] ?? codec;
}

/**
 * Find a supported decoder codec for the given track description.
 * Tries the codec priority chain and returns the first that's supported.
 *
 * @param description - The codec description bytes (e.g., AVCC config for H.264)
 * @returns The supported codec string, or null if none are supported
 */
export async function findSupportedDecoderCodec(
  description: string
): Promise<string | null> {
  if (!isWebCodecsSupported()) {
    return null;
  }

  // Try the provided codec first if it looks like a valid codec string
  if (description) {
    try {
      const support = await VideoDecoder.isConfigSupported({
        codec: description,
      });
      if (support.supported) {
        return description;
      }
    } catch {
      // Not a valid codec string, try the priority chain
    }
  }

  // Try each codec in the priority chain
  for (const codec of CODEC_PRIORITY) {
    try {
      const support = await VideoDecoder.isConfigSupported({
        codec,
        description: description ? new Uint8Array(0) : undefined,
      });
      if (support.supported) {
        return codec;
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Find a supported encoder codec for the given video parameters.
 * Tries the codec priority chain and verifies each with isConfigSupported.
 *
 * @param width - Video width in pixels
 * @param height - Video height in pixels
 * @param framerate - Video framerate in fps
 * @returns The supported codec string for encoding, or null if none are supported
 */
export async function findSupportedEncoderCodec(
  width: number,
  height: number,
  framerate: number
): Promise<string | null> {
  if (!isWebCodecsSupported()) {
    return null;
  }

  for (const codec of CODEC_PRIORITY) {
    const encoderCodec = CODEC_NAME_MAP[codec];
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec: encoderCodec,
        width,
        height,
        framerate,
      });
      if (support.supported) {
        return encoderCodec;
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Determine the decoder config for a given codec.
 * Maps codec strings to the correct WebCodecs decoder configuration.
 * For H.264 (avc1), the description field is REQUIRED — it contains
 * the AVCC configuration box bytes (SPS+PPS).
 */
export function getDecoderConfig(
  codec: string,
  width: number,
  height: number,
  description?: Uint8Array
): VideoDecoderConfig {
  // Normalize codec string for WebCodecs
  // mp4box.js may return "avc1.64001f" or similar, which is valid for WebCodecs
  // But ensure we have a proper codec string
  let normalizedCodec = codec;
  if (codec.startsWith('avc') && !codec.startsWith('avc1.')) {
    // Convert "avc3.X" to "avc1.X" for WebCodecs compatibility
    normalizedCodec = 'avc1.' + codec.substring(4);
  }

  const config: VideoDecoderConfig = {
    codec: normalizedCodec,
    codedWidth: width,
    codedHeight: height,
  };

  // For H.264, the description field is REQUIRED
  // It must contain the AVCC (AVCDecoderConfigurationRecord) bytes
  if (normalizedCodec.startsWith('avc1') && description) {
    config.description = description;
  }

  return config;
}

/**
 * Determine the encoder config for a given codec.
 * Maps codec strings to the correct WebCodecs encoder configuration.
 * For H.264 with mp4-muxer, format='avc' is required to produce
 * AVCC-formatted output (length-prefixed NALUs).
 */
export function getEncoderConfig(
  codec: string,
  width: number,
  height: number,
  framerate: number,
  bitrate: number
): VideoEncoderConfig {
  const isAvc = codec.startsWith('avc1');
  const isVp9 = codec.startsWith('vp09');
  const isVp8 = codec === 'vp8';

  const config: VideoEncoderConfig = {
    codec,
    width,
    height,
    framerate,
    bitrate,
  };

  // For H.264, specify 'avc' format (AVCC length-prefixed NALUs)
  // This is required for mp4-muxer to properly handle the output
  if (isAvc) {
    (config as Record<string, unknown>).format = 'avc';
  }

  return config;
}

/**
 * Map an encoder codec string to the muxer codec string.
 * Muxer codecs have a specific format expected by mp4-muxer.
 */
export function getMuxerCodec(encoderCodec: string): string {
  if (encoderCodec.startsWith('avc1')) {
    return 'avc1.640028'; // H.264 High Profile Level 4.0
  }
  if (encoderCodec.startsWith('vp09')) {
    return 'vp09.00.10.08'; // VP9 Profile 0, Level 1
  }
  if (encoderCodec === 'vp8') {
    return 'vp8';
  }
  return encoderCodec;
}
