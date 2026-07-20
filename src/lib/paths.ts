import path from 'path';
import { mkdirSync, existsSync } from 'fs';

/**
 * Centralized path configuration for file storage.
 * 
 * On Vercel (serverless), we use /tmp which is the only writable directory.
 * Locally, we use the project root subdirectories.
 * 
 * Vercel /tmp caveats:
 * - Max 512MB per serverless function
 * - Ephemeral — files lost between invocations
 * - Each function gets its own /tmp (no sharing between instances)
 */

const IS_VERCEL = !!process.env.VERCEL;

function getBaseDir(): string {
  if (IS_VERCEL) {
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
 * On Vercel, uses a static binary downloaded during build (bin/ffmpeg).
 * Locally, uses the system-installed ffmpeg.
 */
export function getFfmpegPath(): string {
  if (IS_VERCEL) {
    const staticPath = path.join(process.cwd(), 'bin', 'ffmpeg');
    if (existsSync(staticPath)) return staticPath;
    return process.env.FFMPEG_PATH || 'ffmpeg';
  }
  return '/usr/bin/ffmpeg';
}

/**
 * Get FFprobe binary path.
 * On Vercel, uses a static binary downloaded during build (bin/ffprobe).
 * Locally, uses the system-installed ffprobe.
 */
export function getFfprobePath(): string {
  if (IS_VERCEL) {
    const staticPath = path.join(process.cwd(), 'bin', 'ffprobe');
    if (existsSync(staticPath)) return staticPath;
    return process.env.FFPROBE_PATH || 'ffprobe';
  }
  return '/usr/bin/ffprobe';
}
