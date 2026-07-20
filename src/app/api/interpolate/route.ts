import { NextResponse } from 'next/server';
import { ffmpeg } from '@/lib/ffmpeg-config';
import { readdir, stat, access, unlink } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { UPLOADS_DIR, PROCESSED_DIR, TMP_DIR, ensureDirs, getFfprobePath } from '@/lib/paths';

const execFileAsync = promisify(execFile);

interface MotionBlurSettings {
  enabled: boolean;
  frames: number;
  mode: 'average' | 'light' | 'heavy';
}

type InterpolationMode = 'mci' | 'blend' | 'framerate';

interface InterpolateRequest {
  clipId: string;
  targetFps: number; // 24-240
  interpolationMode: InterpolationMode; // 'mci' | 'blend' | 'framerate'
  motionBlur?: MotionBlurSettings;
}

async function findFileById(dir: string, id: string): Promise<string | null> {
  try { await access(dir); } catch { return null; }
  const files = await readdir(dir);
  const match = files.find((f) => f.startsWith(id) && f.includes('.'));
  return match ? path.join(dir, match) : null;
}

/**
 * Probe video file for streams and properties using ffprobe.
 */
async function probeVideo(filePath: string): Promise<{ hasAudio: boolean; duration: number; width: number; height: number; fps: number; pixFmt: string }> {
  try {
    const { stdout } = await execFileAsync(getFfprobePath(), [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      filePath,
    ]);

    const info = JSON.parse(stdout);
    const streams = info.streams || [];
    const hasAudio = streams.some((s: Record<string, unknown>) => s.codec_type === 'audio');
    const videoStream = streams.find((s: Record<string, unknown>) => s.codec_type === 'video');

    let duration = 0;
    if (info.format?.duration) {
      duration = parseFloat(info.format.duration);
    } else if (videoStream?.duration) {
      duration = parseFloat(videoStream.duration as string);
    }

    const width = videoStream?.width || 1920;
    const height = videoStream?.height || 1080;

    let fps = 30;
    if (videoStream?.r_frame_rate) {
      const parts = (videoStream.r_frame_rate as string).split('/');
      if (parts.length === 2 && parseInt(parts[1]) > 0) {
        fps = Math.round(parseInt(parts[0]) / parseInt(parts[1]));
      }
    }

    const pixFmt = (videoStream?.pix_fmt as string) || 'yuv420p';

    return { hasAudio, duration, width, height, fps, pixFmt };
  } catch (err) {
    console.warn('ffprobe failed, using defaults:', err);
    return { hasAudio: true, duration: 0, width: 1920, height: 1080, fps: 30, pixFmt: 'yuv420p' };
  }
}

function runFFmpeg(command: ReturnType<typeof ffmpeg>, timeoutMs = 600000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`FFmpeg timed out after ${timeoutMs / 1000}s — video may be too long for this interpolation mode`));
    }, timeoutMs);

    command
      .on('start', (cmdLine: string) => console.log('FFmpeg:', cmdLine))
      .on('end', () => { clearTimeout(timer); resolve(); })
      .on('error', (err: Error, _stdout: string, stderr: string) => {
        clearTimeout(timer);
        console.error('FFmpeg error:', err.message, stderr);
        const stderrLines = stderr.split('\n').filter((l: string) => l.trim());
        const lastErr = stderrLines.filter((l: string) => l.includes('Error') || l.includes('error')).pop();
        const detail = lastErr ? lastErr.trim() : err.message;
        reject(new Error(`FFmpeg failed: ${detail}`));
      })
      .run();
  });
}

/**
 * Build the primary interpolation filter based on the selected mode.
 */
function buildInterpolationFilter(mode: InterpolationMode, targetFps: number): string {
  switch (mode) {
    case 'mci':
      return `minterpolate=fps=${targetFps}:mi_mode=mci:mc_mode=aobmc:vsbmc=1:me_mode=bidir:scd=fdiff`;
    case 'blend':
      return `minterpolate=fps=${targetFps}:mi_mode=blend`;
    case 'framerate':
      return `framerate=fps=${targetFps}`;
    default:
      return `fps=${targetFps}`;
  }
}

/**
 * Build motion blur filter chain using tblend (temporal blend).
 */
function buildMotionBlurFilters(settings: MotionBlurSettings): string[] {
  if (!settings.enabled) return [];

  const filters: string[] = [];
  const passes = settings.mode === 'light' ? 1 : settings.mode === 'average' ? 2 : 3;
  const prevWeight = Math.min(settings.frames / (settings.frames + 1), 0.85);
  const currWeight = 1 - prevWeight;

  for (let i = 0; i < passes; i++) {
    if (settings.frames <= 2) {
      filters.push(`tblend=all_expr='A/2+B/2'`);
    } else {
      filters.push(`tblend=all_expr='A*${currWeight.toFixed(3)}+B*${prevWeight.toFixed(3)}'`);
    }
  }

  return filters;
}

function getModeLabel(mode: InterpolationMode): string {
  switch (mode) {
    case 'mci': return 'Motion Compensated Interpolation (MCI)';
    case 'blend': return 'Frame Blending';
    case 'framerate': return 'Lightweight Framerate';
    default: return 'Unknown';
  }
}

/**
 * Frame Interpolation API
 */
export async function POST(request: Request) {
  const startTime = Date.now();

  try {
    ensureDirs();
    const body: InterpolateRequest = await request.json();
    const { clipId, targetFps = 120, interpolationMode = 'mci', motionBlur } = body;

    if (!clipId) {
      return NextResponse.json({ error: 'clipId is required' }, { status: 400 });
    }

    const validModes: InterpolationMode[] = ['mci', 'blend', 'framerate'];
    const mode: InterpolationMode = validModes.includes(interpolationMode) ? interpolationMode : 'mci';
    const clampedFps = Math.max(24, Math.min(Math.round(targetFps), 240));

    const inputPath = await findFileById(UPLOADS_DIR, clipId);
    if (!inputPath) {
      return NextResponse.json(
        { error: `Source file not found for clip ID: ${clipId}` },
        { status: 404 }
      );
    }

    const enableMotionBlur = motionBlur?.enabled === true;

    console.log(`Interpolate: clipId=${clipId}, targetFps=${clampedFps}, mode=${mode} (${getModeLabel(mode)}), motionBlur=${enableMotionBlur ? `${motionBlur.mode}(${motionBlur.frames}f)` : 'off'}`);

    // Probe the video
    const probe = await probeVideo(inputPath);
    console.log(`Video probe: hasAudio=${probe.hasAudio}, duration=${probe.duration.toFixed(2)}s, ${probe.width}x${probe.height}, ${probe.fps}fps, pix_fmt=${probe.pixFmt}`);

    const outputId = uuidv4();
    const outputFileName = `${outputId}.mp4`;
    const outputPath = path.join(PROCESSED_DIR, outputFileName);

    // Build video filter chain:
    // 1. Format conversion for compatibility
    // 2. Primary interpolation filter (based on mode)
    const interpolationFilter = buildInterpolationFilter(mode, clampedFps);
    const videoFilters: string[] = [interpolationFilter];

    // 3. Motion blur filters (if enabled) - applied after interpolation
    if (enableMotionBlur && motionBlur) {
      const blurFilters = buildMotionBlurFilters(motionBlur);
      videoFilters.push(...blurFilters);
    }

    console.log(`Applying filters: ${videoFilters.join(', ')}`);

    // Scale timeout based on video duration and interpolation mode
    // MCI is extremely slow: ~10x realtime for short clips, worse for longer
    // Blend is moderate: ~1x realtime
    // Framerate is fast: ~0.5x realtime
    let timeoutMs: number;
    if (mode === 'mci') {
      // MCI: very slow, especially for long videos
      // Empirical: ~3-5 minutes per second of video for MCI at 60fps
      timeoutMs = Math.max(600000, Math.min(probe.duration * 300 * 1000, 3600000)); // max 60 min
    } else if (mode === 'blend') {
      timeoutMs = Math.max(600000, Math.min(probe.duration * 30 * 1000, 1800000)); // max 30 min
    } else {
      timeoutMs = Math.max(600000, Math.min(probe.duration * 15 * 1000, 1800000)); // max 30 min
    }

    console.log(`Timeout: ${(timeoutMs / 1000).toFixed(0)}s for ${probe.duration.toFixed(1)}s video (${mode} mode)`);

    const command = ffmpeg(inputPath)
      .videoFilters(videoFilters)
      .output(outputPath)
      .outputOptions([
        '-c:v', 'libx264',
        '-crf', '18',
        '-preset', 'fast',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
      ]);

    // Handle audio: encode to AAC if present, skip if not
    if (probe.hasAudio) {
      command.outputOptions(['-c:a', 'aac', '-b:a', '128k']);
    } else {
      command.outputOptions(['-an']);
    }

    // Add -err_detect ignore_err for robustness
    command.outputOptions(['-err_detect', 'ignore_err']);

    await runFFmpeg(command, timeoutMs);

    // Verify output
    let outputStat;
    try {
      outputStat = await stat(outputPath);
    } catch {
      return NextResponse.json(
        { error: 'Interpolation processing completed but output file is missing. The video may be corrupted or incompatible.' },
        { status: 500 }
      );
    }

    if (outputStat.size < 1000) {
      try { await unlink(outputPath); } catch { /* ignore */ }
      return NextResponse.json(
        { error: 'Interpolation produced an invalid output (file too small). The video format may not be compatible.' },
        { status: 500 }
      );
    }

    const processingTime = Date.now() - startTime;

    console.log(`Interpolation complete in ${processingTime}ms, output: ${outputStat.size} bytes (mode: ${mode}, motion blur: ${enableMotionBlur ? 'on' : 'off'})`);

    return NextResponse.json({
      id: outputId,
      outputUrl: `/api/download?id=${outputId}`,
      outputSize: outputStat.size,
      processingTime,
      outputFormat: 'mp4',
      interpolationMode: mode,
      interpolationModeLabel: getModeLabel(mode),
      motionBlurApplied: enableMotionBlur,
    }, { status: 200 });
  } catch (error) {
    console.error('Interpolate error:', error);
    const message = error instanceof Error ? error.message : 'Failed to interpolate video';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
