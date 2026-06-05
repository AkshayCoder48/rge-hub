import { NextResponse } from 'next/server';
import { ffmpeg } from '@/lib/ffmpeg-config';
import { mkdir, readdir, stat, unlink, writeFile, access } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

const UPLOADS_DIR = '/home/z/my-project/uploads';
const PROCESSED_DIR = '/home/z/my-project/processed';
const TMP_DIR = '/home/z/my-project/tmp';

interface SpeedRampPoint {
  time: number;
  speed: number;
}

interface ProcessRequest {
  clipId: string;
  trimDuration: number;
  speedRamps: SpeedRampPoint[];
  outputFormat: string;
}

async function ensureDir(dir: string) {
  try { await access(dir); } catch { await mkdir(dir, { recursive: true }); }
}

async function findFileById(dir: string, id: string): Promise<string | null> {
  try { await access(dir); } catch { return null; }
  const files = await readdir(dir);
  const match = files.find((f) => f.startsWith(id) && f.includes('.'));
  return match ? path.join(dir, match) : null;
}

function buildAtempoFilter(speed: number): string {
  if (Math.abs(speed - 1) < 0.01) return '';
  speed = Math.max(0.01, Math.min(speed, 100));
  const filters: string[] = [];
  let remaining = speed;
  while (remaining > 100) { filters.push('atempo=100.0'); remaining /= 100; }
  while (remaining < 0.5) { filters.push('atempo=0.5'); remaining /= 0.5; }
  filters.push(`atempo=${remaining.toFixed(6)}`);
  return filters.join(',');
}

function runFFmpeg(command: ReturnType<typeof ffmpeg>): Promise<void> {
  return new Promise((resolve, reject) => {
    command
      .on('start', (cmdLine: string) => console.log('FFmpeg:', cmdLine))
      .on('end', () => resolve())
      .on('error', (err: Error, _stdout: string, stderr: string) => {
        console.error('FFmpeg error:', err.message, stderr);
        reject(new Error(`FFmpeg failed: ${err.message}`));
      })
      .run();
  });
}

/**
 * Compute the output duration for a linear speed ramp.
 * For speed s₀→s₁ over input duration D:
 *   out(D) = (D/(s₁-s₀)) * ln(1 + (s₁-s₀)/s₀)  when s₁≠s₀
 *   out(D) = D/s₀                                   when s₁≈s₀
 */
export function computeRampOutputDuration(s0: number, s1: number, D: number): number {
  const deltaS = s1 - s0;
  if (Math.abs(deltaS) < 0.001) return D / s0;
  return (D / deltaS) * Math.log(1 + deltaS / s0);
}

/**
 * Build a continuous setpts expression for linear speed ramping.
 *
 * For a linear speed ramp from s₀ to s₁ over D seconds of input:
 *   speed(t) = s₀ + (s₁-s₀)*t/D
 *   output_time(t) = (D/(s₁-s₀)) * ln(1 + (s₁-s₀)*t/(s₀*D))
 *   new_PTS = output_time(PTS*TB) / TB
 *
 * This produces butter-smooth speed transitions without discrete steps.
 * Commas inside the expression are escaped with backslashes for FFmpeg filter syntax.
 */
function buildContinuousSetpts(s0: number, s1: number, D: number): string {
  const deltaS = s1 - s0;
  if (Math.abs(deltaS) < 0.001) return `PTS/${s0.toFixed(6)}`;

  // inner = 1 + deltaS*(PTS-STARTPTS)*TB / (s0*D)
  // We clamp inner > 0.0001 to avoid log(0) or log(negative)
  const innerExpr = `1+${deltaS.toFixed(6)}*(PTS-STARTPTS)*TB/(${s0.toFixed(6)}*${D.toFixed(6)})`;
  // Escape commas for FFmpeg filter syntax (commas separate filters)
  const escapedInner = innerExpr.replace(/,/g, '\\,');
  return `(${D.toFixed(6)}/(${deltaS.toFixed(6)}*TB))*log(max(0.0001\\,${escapedInner}))`;
}

/**
 * Process a video with smooth continuous speed ramping.
 *
 * Uses a mathematically continuous setpts expression for smooth speed transitions
 * instead of the old segmented approach with discrete speed jumps.
 *
 * The output is forced to 60fps which duplicates frames in slow sections
 * and drops frames in fast sections, ensuring consistent playback.
 */
async function processContinuousSpeedRamp(
  inputPath: string,
  outputPath: string,
  startSpeed: number,
  endSpeed: number,
  inputDuration: number,
  outputExt: string
): Promise<void> {
  const s0 = Math.max(0.1, Math.min(startSpeed, 50));
  const s1 = Math.max(0.1, Math.min(endSpeed, 50));

  const setptsExpr = buildContinuousSetpts(s0, s1, inputDuration);
  const videoOutputDuration = computeRampOutputDuration(s0, s1, inputDuration);
  const audioSpeed = Math.max(0.1, Math.min(inputDuration / videoOutputDuration, 50));

  console.log(`Smooth ramp: ${s0}x → ${s1}x over ${inputDuration}s, output ~${videoOutputDuration.toFixed(3)}s, audioSpeed=${audioSpeed.toFixed(3)}x`);

  let command = ffmpeg(inputPath);

  // Video: continuous speed ramp using mathematical expression
  command = command.videoFilters([`setpts=${setptsExpr}`]);

  // Audio: match the video output duration
  const atempo = buildAtempoFilter(audioSpeed);
  if (atempo) command = command.audioFilters([atempo]);

  command = command
    .output(outputPath)
    .outputOptions([
      '-movflags', '+faststart',
      '-pix_fmt', 'yuv420p',
      '-r', '60',            // Force 60fps output for smooth playback
      '-crf', '18',          // High quality encoding
      '-preset', 'fast',     // Reasonable encoding speed
    ]);

  await runFFmpeg(command);
}

/**
 * Fallback: segmented speed ramping with much finer segments (0.02s)
 * Used only if continuous setpts fails.
 */
async function processFineSegmentedSpeed(
  inputPath: string,
  outputPath: string,
  startSpeed: number,
  endSpeed: number,
  inputDuration: number,
  outputExt: string
): Promise<void> {
  const s0 = Math.max(0.1, Math.min(startSpeed, 50));
  const s1 = Math.max(0.1, Math.min(endSpeed, 50));

  // Use very fine segments for smooth transitions
  const SEGMENT_DURATION = 0.02; // 20ms per segment = 50 segments per second
  const numSegments = Math.max(20, Math.ceil(inputDuration / SEGMENT_DURATION));
  const actualSegDuration = inputDuration / numSegments;

  console.log(`Fine segmented ramp: ${s0}x → ${s1}x, ${numSegments} segments over ${inputDuration}s`);

  const segments: { startTime: number; endTime: number; speed: number }[] = [];
  for (let i = 0; i < numSegments; i++) {
    const segStart = i * actualSegDuration;
    const segEnd = (i + 1) * actualSegDuration;
    const midTime = (segStart + segEnd) / 2;
    const t = midTime / inputDuration;
    const speed = s0 + (s1 - s0) * t;
    segments.push({ startTime: segStart, endTime: Math.min(segEnd, inputDuration), speed: Math.max(0.1, speed) });
  }

  const segmentFiles: string[] = [];
  const jobId = uuidv4();

  try {
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const segFile = path.join(TMP_DIR, `${jobId}_seg${i}.mp4`);
      segmentFiles.push(segFile);

      let command = ffmpeg(inputPath);
      command = command.seekInput(seg.startTime);
      command = command.duration(seg.endTime - seg.startTime);

      const videoFilters: string[] = [];
      const audioFilters: string[] = [];

      if (Math.abs(seg.speed - 1) > 0.01) {
        videoFilters.push(`setpts=PTS/${seg.speed.toFixed(6)}`);
        const atempo = buildAtempoFilter(seg.speed);
        if (atempo) audioFilters.push(atempo);
      }

      if (videoFilters.length > 0) command = command.videoFilters(videoFilters);
      if (audioFilters.length > 0) command = command.audioFilters(audioFilters);

      command = command
        .output(segFile)
        .outputOptions(['-movflags', '+faststart', '-pix_fmt', 'yuv420p', '-r', '60', '-crf', '18', '-preset', 'fast']);

      await runFFmpeg(command);
    }

    const concatListPath = path.join(TMP_DIR, `${jobId}_concat.txt`);
    const concatContent = segmentFiles.map((f) => `file '${f}'`).join('\n');
    await writeFile(concatListPath, concatContent);

    const concatCmd = ffmpeg(concatListPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .output(outputPath)
      .outputOptions(['-movflags', '+faststart', '-pix_fmt', 'yuv420p', '-c', 'copy']);

    await runFFmpeg(concatCmd);
  } finally {
    for (const segFile of segmentFiles) {
      try { await unlink(segFile); } catch { /* ignore */ }
    }
    try { await unlink(path.join(TMP_DIR, `${jobId}_concat.txt`)); } catch { /* ignore */ }
  }
}

export async function POST(request: Request) {
  const startTime = Date.now();

  try {
    const body: ProcessRequest = await request.json();
    const { clipId, trimDuration = 1.0, speedRamps, outputFormat = 'mp4' } = body;

    if (!clipId) {
      return NextResponse.json({ error: 'clipId is required' }, { status: 400 });
    }

    const inputPath = await findFileById(UPLOADS_DIR, clipId);
    if (!inputPath) {
      return NextResponse.json(
        { error: `Source file not found for clip ID: ${clipId}` },
        { status: 404 }
      );
    }

    const effectiveTrimDuration = Math.max(0.1, trimDuration);

    console.log(`Process: clipId=${clipId}, trimDuration=${effectiveTrimDuration}s, inputFile=${inputPath}`);

    await ensureDir(PROCESSED_DIR);
    await ensureDir(TMP_DIR);

    const outputId = uuidv4();
    const outputExt = outputFormat === 'original'
      ? path.extname(inputPath)
      : `.${outputFormat}`;
    const outputFileName = `${outputId}${outputExt}`;
    const outputPath = path.join(PROCESSED_DIR, outputFileName);

    const jobId = uuidv4();

    // ============================================
    // SMOOTH REVERSE SPEED RAMP PROCESSING
    // ============================================
    // Step 1: Extract the first N seconds of the input video
    // Step 2: Apply continuous 4x→0.6x speed ramp (smooth mathematical curve)
    // Step 3: Reverse the trimmed segment, then apply continuous 0.6x→4x speed ramp
    // Step 4: Concatenate forward + reversed segments into final output
    // ============================================

    const trimmedFile = path.join(TMP_DIR, `${jobId}_trimmed.mp4`);
    const forwardFile = path.join(TMP_DIR, `${jobId}_forward.mp4`);
    const reversedRawFile = path.join(TMP_DIR, `${jobId}_reversed_raw.mp4`);
    const reversedFile = path.join(TMP_DIR, `${jobId}_reversed.mp4`);

    try {
      // Step 1: Trim the input video to the specified duration
      console.log(`Step 1: Trimming to ${effectiveTrimDuration}s`);
      await runFFmpeg(
        ffmpeg(inputPath)
          .seekInput(0)
          .duration(effectiveTrimDuration)
          .output(trimmedFile)
          .outputOptions(['-movflags', '+faststart', '-pix_fmt', 'yuv420p'])
      );

      // Step 2: Forward segment with continuous 4x→0.6x speed ramp
      console.log('Step 2: Processing smooth forward segment (4x→0.6x)');
      try {
        await processContinuousSpeedRamp(
          trimmedFile, forwardFile,
          4.0, 0.6, effectiveTrimDuration, outputExt
        );
      } catch (continuousErr) {
        console.warn('Continuous setpts failed, falling back to fine-segmented:', continuousErr);
        await processFineSegmentedSpeed(
          trimmedFile, forwardFile,
          4.0, 0.6, effectiveTrimDuration, outputExt
        );
      }

      // Step 3: Reverse the trimmed segment
      console.log('Step 3a: Reversing the trimmed segment');
      await runFFmpeg(
        ffmpeg(trimmedFile)
          .videoFilters('reverse')
          .audioFilters('areverse')
          .output(reversedRawFile)
          .outputOptions(['-movflags', '+faststart', '-pix_fmt', 'yuv420p'])
      );

      // Step 4: Reversed segment with continuous 0.6x→4x speed ramp
      console.log('Step 3b: Processing smooth reversed segment (0.6x→4x)');
      try {
        await processContinuousSpeedRamp(
          reversedRawFile, reversedFile,
          0.6, 4.0, effectiveTrimDuration, outputExt
        );
      } catch (continuousErr) {
        console.warn('Continuous setpts failed for reversed, falling back to fine-segmented:', continuousErr);
        await processFineSegmentedSpeed(
          reversedRawFile, reversedFile,
          0.6, 4.0, effectiveTrimDuration, outputExt
        );
      }

      // Step 5: Concatenate forward + reversed segments
      console.log('Step 4: Concatenating forward + reversed segments');
      const concatListPath = path.join(TMP_DIR, `${jobId}_final_concat.txt`);
      const concatContent = [
        `file '${forwardFile}'`,
        `file '${reversedFile}'`,
      ].join('\n');
      await writeFile(concatListPath, concatContent);

      let concatCmd = ffmpeg(concatListPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .output(outputPath);

      if (outputExt === '.mp4' || outputExt === '.mov') {
        concatCmd = concatCmd.outputOptions(['-movflags', '+faststart', '-pix_fmt', 'yuv420p', '-c', 'copy']);
      } else {
        concatCmd = concatCmd.outputOptions(['-c', 'copy']);
      }

      await runFFmpeg(concatCmd);

      await unlink(concatListPath);
    } finally {
      for (const f of [trimmedFile, forwardFile, reversedRawFile, reversedFile]) {
        try { await unlink(f); } catch { /* ignore */ }
      }
    }

    const outputStat = await stat(outputPath);
    const processingTime = Date.now() - startTime;

    console.log(`Processing complete in ${processingTime}ms`);

    return NextResponse.json({
      id: outputId,
      outputUrl: `/api/download?id=${outputId}`,
      outputSize: outputStat.size,
      processingTime,
      outputFormat: outputExt.replace('.', ''),
    }, { status: 200 });
  } catch (error) {
    console.error('Process error:', error);
    const message = error instanceof Error ? error.message : 'Failed to process video';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
