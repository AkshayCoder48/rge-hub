import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { spawn } from 'child_process';
import { mkdirSync, unlinkSync, writeFileSync, existsSync } from 'fs';
import { readFile, stat } from 'fs/promises';
import { UPLOADS_DIR, PROCESSED_DIR, TMP_DIR, getFfmpegPath, getFfprobePath } from '@/lib/paths';

// Speed ramp constants
const RAMP_START = 4.0;
const RAMP_MID = 0.6;
const RAMP_END = 4.0;

/**
 * Run an FFmpeg command and return a promise.
 * Uses direct spawn instead of fluent-ffmpeg for maximum reliability.
 */
function runFFmpeg(args: string[], timeoutMs = 600000): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpegPath = getFfmpegPath();
    const proc = spawn(ffmpegPath, args);

    let stderrOutput = '';
    proc.stderr.on('data', (data: Buffer) => {
      stderrOutput += data.toString();
    });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`FFmpeg timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        const stderrLines = stderrOutput.split('\n').filter((l) => l.trim());
        const lastErr = stderrLines.filter((l) => l.includes('Error') || l.includes('error')).pop();
        const detail = lastErr ? lastErr.trim() : `exited with code ${code}`;
        reject(new Error(`FFmpeg failed: ${detail}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`FFmpeg process error: ${err.message}`));
    });
  });
}

/**
 * Run ffprobe and return parsed JSON data.
 */
async function probeVideo(filePath: string): Promise<{
  hasAudio: boolean;
  duration: number;
  width: number;
  height: number;
  fps: number;
  pixFmt: string;
  codec: string;
}> {
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

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
    const codec = (videoStream?.codec_name as string) || 'h264';

    return { hasAudio, duration, width, height, fps, pixFmt, codec };
  } catch (err) {
    console.warn('ffprobe failed, using defaults:', err);
    return { hasAudio: true, duration: 0, width: 1920, height: 1080, fps: 30, pixFmt: 'yuv420p', codec: 'h264' };
  }
}

/**
 * Compute the output duration for a linear speed ramp.
 */
function computeRampOutputDuration(s0: number, s1: number, D: number): number {
  const deltaS = s1 - s0;
  if (Math.abs(deltaS) < 0.001) return D / s0;
  return (D / deltaS) * Math.log(1 + deltaS / s0);
}

/**
 * Build a continuous setpts expression for linear speed ramping.
 * Uses FFmpeg's expression evaluator syntax.
 */
function buildContinuousSetpts(s0: number, s1: number, D: number): string {
  const deltaS = s1 - s0;
  if (Math.abs(deltaS) < 0.001) return `PTS/${s0.toFixed(6)}`;
  const innerExpr = `1+${deltaS.toFixed(6)}*(PTS-STARTPTS)*TB/(${s0.toFixed(6)}*${D.toFixed(6)})`;
  const escapedInner = innerExpr.replace(/,/g, '\\,');
  return `(${D.toFixed(6)}/(${deltaS.toFixed(6)}*TB))*log(max(0.0001\\,${escapedInner}))`;
}

/**
 * Combined upload + process + return endpoint.
 * 
 * This is a SINGLE request that:
 * 1. Receives the video file and trimDuration
 * 2. Processes the speed ramp using FFmpeg
 * 3. Returns the processed video directly as a binary response
 * 
 * This architecture works on any platform (Vercel, Render, Railway, Fly.io)
 * because it doesn't rely on persistent storage between requests.
 */
export async function POST(request: Request) {
  const startTime = Date.now();

  try {
    // Ensure temp directories exist
    for (const dir of [UPLOADS_DIR, PROCESSED_DIR, TMP_DIR]) {
      mkdirSync(dir, { recursive: true });
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const trimDurationStr = formData.get('trimDuration');

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'No video file provided.' }, { status: 400 });
    }

    const trimDuration = parseFloat(String(trimDurationStr || '1.0'));
    if (isNaN(trimDuration) || trimDuration <= 0) {
      return NextResponse.json({ error: 'Invalid trimDuration.' }, { status: 400 });
    }

    const validVideoExtensions = ['.mp4', '.mov', '.avi', '.webm', '.mkv', '.flv', '.mpeg', '.3gp', '.m4v'];
    const fileExt = path.extname(file.name).toLowerCase();
    const isVideoType = file.type.startsWith('video/');
    const isOctetStream = file.type === 'application/octet-stream';
    const hasValidExt = validVideoExtensions.includes(fileExt);

    if (!isVideoType && !isOctetStream && !hasValidExt) {
      return NextResponse.json({ error: `Invalid file type: ${file.type}` }, { status: 400 });
    }

    const jobId = uuidv4();
    const ext = fileExt || '.mp4';
    const inputPath = path.join(TMP_DIR, `${jobId}_input${ext}`);

    // Save uploaded file to temp directory
    const buffer = Buffer.from(await file.arrayBuffer());
    writeFileSync(inputPath, buffer);

    // Probe the video for metadata
    const probe = await probeVideo(inputPath);
    console.log(`Video probe: hasAudio=${probe.hasAudio}, duration=${probe.duration.toFixed(2)}s, ${probe.width}x${probe.height}, ${probe.fps}fps, codec=${probe.codec}`);

    const effectiveTrimDuration = Math.max(0.1, Math.min(trimDuration, probe.duration || trimDuration));

    console.log(`Processing: trimDuration=${effectiveTrimDuration}s, ramp=${RAMP_START}x→${RAMP_MID}x→${RAMP_END}x`);

    // Define all intermediate file paths
    const trimmedFile = path.join(TMP_DIR, `${jobId}_trimmed.mp4`);
    const forwardFile = path.join(TMP_DIR, `${jobId}_forward.mp4`);
    const reversedRawFile = path.join(TMP_DIR, `${jobId}_reversed_raw.mp4`);
    const reversedFile = path.join(TMP_DIR, `${jobId}_reversed.mp4`);
    const concatListPath = path.join(TMP_DIR, `${jobId}_concat.txt`);
    const concatFile = path.join(TMP_DIR, `${jobId}_concat.mp4`);
    const outputFile = path.join(TMP_DIR, `${jobId}_output.mp4`);

    // Build setpts expressions
    const forwardSetpts = buildContinuousSetpts(RAMP_START, RAMP_MID, effectiveTrimDuration);
    const reverseSetpts = buildContinuousSetpts(RAMP_MID, RAMP_END, effectiveTrimDuration);

    // Audio speed for forward segment
    const forwardOutputDuration = computeRampOutputDuration(RAMP_START, RAMP_MID, effectiveTrimDuration);
    const forwardAudioSpeed = effectiveTrimDuration / forwardOutputDuration;

    // Audio speed for reversed segment
    const reverseOutputDuration = computeRampOutputDuration(RAMP_MID, RAMP_END, effectiveTrimDuration);
    const reverseAudioSpeed = effectiveTrimDuration / reverseOutputDuration;

    try {
      // Step 1: Trim input to specified duration
      console.log(`Step 1: Trimming to ${effectiveTrimDuration}s`);
      await runFFmpeg([
        '-y',
        '-ss', '0',
        '-i', inputPath,
        '-t', String(effectiveTrimDuration),
        '-movflags', '+faststart',
        '-pix_fmt', 'yuv420p',
        '-c:v', 'libx264',
        '-crf', '18',
        '-preset', 'fast',
        ...(probe.hasAudio ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an']),
        trimmedFile,
      ]);

      // Step 2: Forward segment - 4x → 0.6x speed ramp
      console.log('Step 2: Forward speed ramp (4x→0.6x)');
      const forwardAudioFilter = buildAtempoChain(forwardAudioSpeed);

      await runFFmpeg([
        '-y',
        '-i', trimmedFile,
        '-vf', `setpts=${forwardSetpts}`,
        ...(probe.hasAudio && forwardAudioFilter ? ['-af', forwardAudioFilter] : []),
        '-movflags', '+faststart',
        '-pix_fmt', 'yuv420p',
        '-r', '60',
        '-c:v', 'libx264',
        '-crf', '18',
        '-preset', 'fast',
        ...(probe.hasAudio ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an']),
        forwardFile,
      ]);

      // Step 3: Reverse the trimmed segment
      console.log('Step 3: Reversing trimmed segment');
      await runFFmpeg([
        '-y',
        '-i', trimmedFile,
        '-vf', 'reverse',
        ...(probe.hasAudio ? ['-af', 'areverse'] : []),
        '-movflags', '+faststart',
        '-pix_fmt', 'yuv420p',
        '-c:v', 'libx264',
        '-crf', '18',
        '-preset', 'fast',
        ...(probe.hasAudio ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an']),
        reversedRawFile,
      ]);

      // Step 4: Reversed segment - 0.6x → 4x speed ramp
      console.log('Step 4: Reversed speed ramp (0.6x→4x)');
      const reverseAudioFilter = buildAtempoChain(reverseAudioSpeed);

      await runFFmpeg([
        '-y',
        '-i', reversedRawFile,
        '-vf', `setpts=${reverseSetpts}`,
        ...(probe.hasAudio && reverseAudioFilter ? ['-af', reverseAudioFilter] : []),
        '-movflags', '+faststart',
        '-pix_fmt', 'yuv420p',
        '-r', '60',
        '-c:v', 'libx264',
        '-crf', '18',
        '-preset', 'fast',
        ...(probe.hasAudio ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an']),
        reversedFile,
      ]);

      // Step 5: Concatenate forward + reversed segments
      console.log('Step 5: Concatenating forward + reversed');
      const concatContent = `file '${forwardFile}'\nfile '${reversedFile}'`;
      writeFileSync(concatListPath, concatContent);

      await runFFmpeg([
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', concatListPath,
        '-movflags', '+faststart',
        '-pix_fmt', 'yuv420p',
        '-c', 'copy',
        concatFile,
      ]);

      // Copy concat result to final output (rename would be fine too)
      const concatData = await readFile(concatFile);
      writeFileSync(outputFile, concatData);

    } finally {
      // Clean up ALL intermediate files
      const filesToClean = [inputPath, trimmedFile, forwardFile, reversedRawFile, reversedFile, concatListPath, concatFile];
      for (const f of filesToClean) {
        try { unlinkSync(f); } catch { /* ignore */ }
      }
    }

    // Read the processed video as a buffer and return it directly
    // This avoids using createReadStream which doesn't exist in fs/promises
    // and also avoids stream compatibility issues with NextResponse
    const outputBuffer = await readFile(outputFile);
    const fileStats = await stat(outputFile);
    const originalName = file.name.replace(/\.[^/.]+$/, '');
    const processingTime = Date.now() - startTime;

    console.log(`Processing complete in ${processingTime}ms, output size: ${fileStats.size} bytes`);

    // Clean up the output file after reading it into memory
    try { unlinkSync(outputFile); } catch { /* ignore */ }

    return new NextResponse(outputBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="speedramp_${originalName}.mp4"`,
        'Content-Length': String(fileStats.size),
        'X-Processing-Time': String(processingTime),
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('Speed ramp process error:', error);
    const message = error instanceof Error ? error.message : 'Failed to process video';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Build atempo filter chain for audio speed change.
 * FFmpeg's atempo filter has range [0.5, 100], so we chain multiple
 * filters for speeds outside that range.
 */
function buildAtempoChain(speed: number): string {
  if (Math.abs(speed - 1) < 0.01) return '';
  speed = Math.max(0.01, Math.min(speed, 100));
  const filters: string[] = [];
  let remaining = speed;
  while (remaining > 100) { filters.push('atempo=100.0'); remaining /= 100; }
  while (remaining < 0.5) { filters.push('atempo=0.5'); remaining /= 0.5; }
  filters.push(`atempo=${remaining.toFixed(6)}`);
  return filters.join(',');
}
