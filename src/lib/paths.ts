import path from 'path';
import { mkdirSync } from 'fs';

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
 * On Vercel, use the @ffmpeg-installer/ffmpeg package.
 * Locally, use the system-installed ffmpeg.
 */
let _ffmpegPath: string | null = null;
export function getFfmpegPath(): string {
  if (_ffmpegPath !== null) return _ffmpegPath;
  if (IS_VERCEL) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('@ffmpeg-installer/ffmpeg');
      _ffmpegPath = mod.path || mod.FFmpegPath || 'ffmpeg';
    } catch {
      _ffmpegPath = 'ffmpeg';
    }
  } else {
    _ffmpegPath = '/usr/bin/ffmpeg';
  }
  return _ffmpegPath;
}

let _ffprobePath: string | null = null;
export function getFfprobePath(): string {
  if (_ffprobePath !== null) return _ffprobePath;
  if (IS_VERCEL) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('@ffprobe-installer/ffprobe');
      _ffprobePath = mod.path || mod.FFprobePath || 'ffprobe';
    } catch {
      _ffprobePath = 'ffprobe';
    }
  } else {
    _ffprobePath = '/usr/bin/ffprobe';
  }
  return _ffprobePath;
}
