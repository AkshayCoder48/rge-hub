import path from 'path';
import { existsSync } from 'fs';

/**
 * Centralized path configuration for file storage.
 *
 * Works on ALL deployment platforms:
 * - Vercel (serverless): Uses /tmp + ffmpeg-static npm package for binary
 * - Render / Railway / Fly.io: Uses /tmp + system ffmpeg via Docker
 * - Local development: Uses project root + system ffmpeg
 */

// ---- Platform Detection ----

const IS_VERCEL = !!process.env.VERCEL;
const IS_SERVERLESS = IS_VERCEL || !!process.env.RENDER;

function getBaseDir(): string {
  if (IS_SERVERLESS) return '/tmp/speedramper';
  return process.cwd();
}

const baseDir = getBaseDir();

export const UPLOADS_DIR = path.join(baseDir, 'uploads');
export const PROCESSED_DIR = path.join(baseDir, 'processed');
export const TMP_DIR = path.join(baseDir, 'tmp');

export function ensureDirs(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- need synchronous mkdir
  const { mkdirSync } = require('fs');
  for (const dir of [UPLOADS_DIR, PROCESSED_DIR, TMP_DIR]) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Get FFmpeg binary path.
 *
 * Strategy:
 * 1. On Vercel: Use ffmpeg-static npm package (bundled static binary)
 * 2. Environment variable FFMPEG_PATH
 * 3. Local bin/ffmpeg directory
 * 4. System ffmpeg (available on Render/Railway/Fly.io/Docker)
 */
export function getFfmpegPath(): string {
  // On Vercel, ffmpeg-static is the only reliable option
  if (IS_VERCEL) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ffmpegStatic = require('ffmpeg-static');
      if (ffmpegStatic && typeof ffmpegStatic === 'string' && existsSync(ffmpegStatic)) {
        return ffmpegStatic;
      }
      // ffmpeg-static might return a URL in some environments, try resolving it
      if (ffmpegStatic) {
        const resolvedPath = path.resolve(ffmpegStatic);
        if (existsSync(resolvedPath)) return resolvedPath;
      }
    } catch {
      console.warn('[paths] ffmpeg-static not available on Vercel — video processing will fail');
    }
  }

  // Check env variable
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }

  // Check local bin directory
  const staticPath = path.join(process.cwd(), 'bin', 'ffmpeg');
  if (existsSync(staticPath)) return staticPath;

  // Try ffmpeg-static as fallback on any platform
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic && typeof ffmpegStatic === 'string') {
      const resolvedPath = path.resolve(ffmpegStatic);
      if (existsSync(resolvedPath)) return resolvedPath;
    }
  } catch { /* not available */ }

  // Fall back to system ffmpeg (available on Docker/Render/Railway)
  return 'ffmpeg';
}

/**
 * Get FFprobe binary path.
 *
 * ffprobe-static is not well-maintained, so on Vercel we use
 * ffmpeg itself for probing (ffmpeg -i outputs stream info).
 * On Docker/Render, system ffprobe is available.
 */
export function getFfprobePath(): string | null {
  // On Vercel, ffprobe is NOT available separately.
  // We use ffmpeg for probing instead (probeWithFfmpeg function).
  if (IS_VERCEL) return null;

  // Check env variable
  if (process.env.FFPROBE_PATH && existsSync(process.env.FFPROBE_PATH)) {
    return process.env.FFPROBE_PATH;
  }

  // Check local bin directory
  const staticPath = path.join(process.cwd(), 'bin', 'ffprobe');
  if (existsSync(staticPath)) return staticPath;

  // Fall back to system ffprobe
  return 'ffprobe';
}

/**
 * Check if ffprobe is available on this platform.
 */
export function hasFfprobe(): boolean {
  return getFfprobePath() !== null;
}
