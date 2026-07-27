import path from 'path';
import { mkdirSync, existsSync } from 'fs';

/**
 * Centralized path configuration for file storage.
 * 
 * Works on ANY deployment platform:
 * - Vercel (serverless): Uses /tmp which is the only writable directory
 * - Render / Railway / Fly.io: Uses /tmp for temp files, cwd for persistent storage
 * - Local development: Uses the project root subdirectories
 * 
 * The speedramp endpoint now receives+processes+returns the video in a 
 * single request, so persistent storage is NOT needed between requests.
 */

const IS_SERVERLESS = !!process.env.VERCEL || !!process.env.RENDER;

function getBaseDir(): string {
  // On serverless platforms, use /tmp (ephemeral but writable)
  // On persistent platforms, use project root for persistent storage
  if (IS_SERVERLESS) {
    return '/tmp/speedramper';
  }
  return process.cwd();
}

const baseDir = getBaseDir();

export const UPLOADS_DIR = path.join(baseDir, 'uploads');
export const PROCESSED_DIR = path.join(baseDir, 'processed');
export const TMP_DIR = path.join(baseDir, 'tmp');

/**
 * Ensure all required directories exist.
 * Safe to call multiple times.
 */
export function ensureDirs(): void {
  for (const dir of [UPLOADS_DIR, PROCESSED_DIR, TMP_DIR]) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Get FFmpeg binary path.
 * Checks several locations:
 * 1. Environment variable (FFMPEG_PATH)
 * 2. Local bin directory (for Vercel static binary)
 * 3. System-installed ffmpeg (most common on Render/Railway/Fly.io)
 */
export function getFfmpegPath(): string {
  // Check env variable first
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }
  // Check local bin directory (for Vercel deployment)
  const staticPath = path.join(process.cwd(), 'bin', 'ffmpeg');
  if (existsSync(staticPath)) return staticPath;
  // Fall back to system ffmpeg (available on Render/Railway/Fly.io/Linux)
  return 'ffmpeg';
}

/**
 * Get FFprobe binary path.
 * Same strategy as ffmpeg path.
 */
export function getFfprobePath(): string {
  // Check env variable first
  if (process.env.FFPROBE_PATH && existsSync(process.env.FFPROBE_PATH)) {
    return process.env.FFPROBE_PATH;
  }
  // Check local bin directory (for Vercel deployment)
  const staticPath = path.join(process.cwd(), 'bin', 'ffprobe');
  if (existsSync(staticPath)) return staticPath;
  // Fall back to system ffprobe
  return 'ffprobe';
}
