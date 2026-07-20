import { NextResponse } from 'next/server';
import { ffmpeg } from '@/lib/ffmpeg-config';
import { readdir, stat, access, unlink } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { UPLOADS_DIR, PROCESSED_DIR, TMP_DIR, ensureDirs, getFfprobePath } from '@/lib/paths';

const execFileAsync = promisify(execFile);

interface MotionBlurRequest {
  clipId: string;
  filterType: 'tblend' | 'tmix'; // Which FFmpeg filter to use
  frames: number; // 2-16, number of frames to blend
  intensity: 'light' | 'average' | 'heavy'; // Filter passes
}

async function findFileById(dir: string, id: string): Promise<string | null> {
  try { await access(dir); } catch { return null; }
  const files = await readdir(dir);
  const match = files.find((f) => f.startsWith(id) && f.includes('.'));
  return match ? path.join(dir, match) : null;
}

/**
 * Probe video file for streams and properties using ffprobe.
 * Returns whether the file has audio and the video duration.
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
      reject(new Error(`FFmpeg timed out after ${timeoutMs / 1000}s — video may be too long for this filter`));
    }, timeoutMs);

    command
      .on('start', (cmdLine: string) => console.log('FFmpeg:', cmdLine))
      .on('end', () => { clearTimeout(timer); resolve(); })
      .on('error', (err: Error, _stdout: string, stderr: string) => {
        clearTimeout(timer);
        console.error('FFmpeg error:', err.message, stderr);
        // Extract more useful error from stderr
        const stderrLines = stderr.split('\n').filter((l: string) => l.trim());
        const lastErr = stderrLines.filter((l: string) => l.includes('Error') || l.includes('error')).pop();
        const detail = lastErr ? lastErr.trim() : err.message;
        reject(new Error(`FFmpeg failed: ${detail}`));
      })
      .run();
  });
}

/**
 * Build video filter chain for tblend (temporal blend) motion blur.
 *
 * tblend blends each frame with the previous one using a weighted expression.
 * Multiple passes create stronger blur trails.
 *
 * - light: 1 pass of tblend
 * - average: 2 passes of tblend
 * - heavy: 3 passes of tblend
 *
 * The `frames` parameter controls the blend weight:
 *   prevWeight = min(frames/(frames+1), 0.85)
 *   currWeight = 1 - prevWeight
 *
 * Expression: tblend=all_expr='A*currWeight+B*prevWeight'
 * where A is the current frame and B is the previous frame.
 */
function buildTblendFilters(frames: number, intensity: 'light' | 'average' | 'heavy'): string[] {
  const filters: string[] = [];
  const passes = intensity === 'light' ? 1 : intensity === 'average' ? 2 : 3;

  const prevWeight = Math.min(frames / (frames + 1), 0.85);
  const currWeight = 1 - prevWeight;

  for (let i = 0; i < passes; i++) {
    if (frames <= 2) {
      filters.push(`tblend=all_expr='A/2+B/2'`);
    } else {
      filters.push(`tblend=all_expr='A*${currWeight.toFixed(3)}+B*${prevWeight.toFixed(3)}'`);
    }
  }

  return filters;
}

/**
 * Generate symmetric weight pattern for tmix filter based on intensity.
 *
 * - light: all weights = 1 (uniform blending)
 * - average: center ~50% of frames get weight 2, edges get weight 1
 * - heavy: center ~33% of frames get weight 2, rest get weight 1
 */
function generateTmixWeights(n: number, intensity: 'light' | 'average' | 'heavy'): string {
  if (intensity === 'light') {
    return Array(n).fill(1).join(' ');
  }

  const weights: number[] = Array(n).fill(1);

  if (intensity === 'average') {
    const centerStart = Math.floor(n / 4);
    const centerEnd = n - Math.floor(n / 4);
    for (let i = centerStart; i < centerEnd; i++) weights[i] = 2;
  } else {
    const centerStart = Math.floor(n / 3);
    const centerEnd = n - Math.floor(n / 3);
    for (let i = centerStart; i < centerEnd; i++) weights[i] = 2;
  }

  return weights.join(' ');
}

/**
 * Build video filter chain for tmix (temporal mix) motion blur.
 *
 * tmix mixes N consecutive frames together using specified weights.
 */
function buildTmixFilters(frames: number, intensity: 'light' | 'average' | 'heavy'): string[] {
  const baseFrames = intensity === 'light' ? 2 : intensity === 'average' ? 4 : 6;
  const tmixFrames = Math.min(baseFrames + (frames - 2), 16);
  const weights = generateTmixWeights(tmixFrames, intensity);
  return [`tmix=frames=${tmixFrames}:weights='${weights}'`];
}

/**
 * Motion Blur API
 *
 * Accepts a video clip and applies motion blur using either:
 * - tblend: temporal blend (blends current frame with previous)
 * - tmix: temporal mix (mixes N consecutive frames)
 *
 * Robustness features:
 * - Probes video for audio stream detection (avoids -c:a copy on no-audio videos)
 * - Adds format=yuv420p for pixel format compatibility
 * - Scales timeout based on video duration
 * - Uses two-pass approach for long videos: filters → temp → encode with audio
 */
export async function POST(request: Request) {
  const startTime = Date.now();

  try {
    ensureDirs();
    const body: MotionBlurRequest = await request.json();
    const { clipId, filterType = 'tblend', frames = 2, intensity = 'average' } = body;

    // Validate required fields
    if (!clipId) {
      return NextResponse.json({ error: 'clipId is required' }, { status: 400 });
    }

    if (!['tblend', 'tmix'].includes(filterType)) {
      return NextResponse.json(
        { error: `Invalid filterType: ${filterType}. Must be 'tblend' or 'tmix'` },
        { status: 400 }
      );
    }

    if (!['light', 'average', 'heavy'].includes(intensity)) {
      return NextResponse.json(
        { error: `Invalid intensity: ${intensity}. Must be 'light', 'average', or 'heavy'` },
        { status: 400 }
      );
    }

    // Clamp frames to valid range (2-16)
    const clampedFrames = Math.max(2, Math.min(Math.round(frames), 16));
    if (clampedFrames !== frames) {
      console.log(`Motion blur: frames ${frames} clamped to ${clampedFrames}`);
    }

    // Find the input file
    const inputPath = await findFileById(UPLOADS_DIR, clipId);
    if (!inputPath) {
      return NextResponse.json(
        { error: `Source file not found for clip ID: ${clipId}` },
        { status: 404 }
      );
    }

    console.log(`Motion blur: clipId=${clipId}, filterType=${filterType}, frames=${clampedFrames}, intensity=${intensity}, file=${inputPath}`);

    // Probe the video to detect audio streams and properties
    const probe = await probeVideo(inputPath);
    console.log(`Video probe: hasAudio=${probe.hasAudio}, duration=${probe.duration.toFixed(2)}s, ${probe.width}x${probe.height}, ${probe.fps}fps, pix_fmt=${probe.pixFmt}`);

    const outputId = uuidv4();
    const outputFileName = `${outputId}.mp4`;
    const outputPath = path.join(PROCESSED_DIR, outputFileName);

    // Build video filter chain based on filter type
    // Always start with format=yuv420p for pixel format compatibility
    const videoFilters: string[] = ['format=yuv420p'];

    const blurFilters = filterType === 'tblend'
      ? buildTblendFilters(clampedFrames, intensity)
      : buildTmixFilters(clampedFrames, intensity);

    videoFilters.push(...blurFilters);

    console.log(`Applying motion blur filters: ${videoFilters.join(', ')}`);

    // Scale timeout based on video duration and filter complexity
    // Base: 60s per minute of video for tblend, more for tmix
    const passes = intensity === 'light' ? 1 : intensity === 'average' ? 2 : 3;
    const baseMultiplier = filterType === 'tmix' ? 120 : 60; // seconds per minute of video
    const timeoutMs = Math.max(300000, Math.min(
      (probe.duration / 60) * baseMultiplier * passes * 1000,
      1800000 // max 30 minutes
    ));

    console.log(`Timeout: ${(timeoutMs / 1000).toFixed(0)}s for ${probe.duration.toFixed(1)}s video`);

    // Build FFmpeg command with conditional audio handling
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

    // Handle audio: copy if present, skip if not
    if (probe.hasAudio) {
      command.outputOptions(['-c:a', 'aac', '-b:a', '128k']);
    } else {
      command.outputOptions(['-an']);
    }

    // Add -err_detect ignore_err for robustness with potentially corrupt frames
    command.outputOptions(['-err_detect', 'ignore_err']);

    await runFFmpeg(command, timeoutMs);

    // Verify output file exists and has reasonable size
    let outputStat;
    try {
      outputStat = await stat(outputPath);
    } catch {
      return NextResponse.json(
        { error: 'Motion blur processing completed but output file is missing. The video may be corrupted or incompatible.' },
        { status: 500 }
      );
    }

    if (outputStat.size < 1000) {
      // Output is suspiciously small — likely an error
      try { await unlink(outputPath); } catch { /* ignore */ }
      return NextResponse.json(
        { error: 'Motion blur produced an invalid output (file too small). The video format may not be compatible with the selected filter.' },
        { status: 500 }
      );
    }

    const processingTime = Date.now() - startTime;
    console.log(`Motion blur complete in ${processingTime}ms, output: ${outputStat.size} bytes (${filterType}, ${intensity}, ${clampedFrames} frames)`);

    return NextResponse.json({
      id: outputId,
      outputUrl: `/api/download?id=${outputId}`,
      outputSize: outputStat.size,
      processingTime,
      motionBlurApplied: true,
    }, { status: 200 });
  } catch (error) {
    console.error('Motion blur error:', error);
    const message = error instanceof Error ? error.message : 'Failed to apply motion blur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
