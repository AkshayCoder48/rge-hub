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
  if (speed === 1) return '';
  const filters: string[] = [];
  let remaining = speed;
  while (remaining > 100) { filters.push('atempo=100.0'); remaining /= 100; }
  while (remaining < 0.5) { filters.push('atempo=0.5'); remaining /= 0.5; }
  filters.push(`atempo=${remaining.toFixed(6)}`);
  return filters.join(',');
}

function interpolateSpeed(ramps: SpeedRampPoint[], time: number): number {
  if (ramps.length === 0) return 1;
  if (ramps.length === 1) return ramps[0].speed;
  if (time <= ramps[0].time) return ramps[0].speed;
  if (time >= ramps[ramps.length - 1].time) return ramps[ramps.length - 1].speed;
  for (let i = 0; i < ramps.length - 1; i++) {
    if (time >= ramps[i].time && time <= ramps[i + 1].time) {
      const t = (time - ramps[i].time) / (ramps[i + 1].time - ramps[i].time);
      const smoothT = t * t * (3 - 2 * t);
      return ramps[i].speed + smoothT * (ramps[i + 1].speed - ramps[i].speed);
    }
  }
  return 1;
}

/**
 * Run FFmpeg and return a promise.
 */
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
 * Process a video segment with segmented speed ramping.
 * Divides the input into small segments, applies different speeds, then concats.
 */
async function processSegmentedSpeed(
  inputPath: string,
  outputPath: string,
  speedRamps: SpeedRampPoint[],
  inputDuration: number,
  outputExt: string
): Promise<void> {
  const sorted = [...speedRamps].sort((a, b) => a.time - b.time);
  const startTime = sorted[0].time;
  const endTime = sorted[sorted.length - 1].time;
  const totalDuration = endTime - startTime;

  if (totalDuration <= 0) {
    const avgSpeed = sorted.reduce((sum, r) => sum + r.speed, 0) / sorted.length;
    await processUniformSpeed(inputPath, outputPath, avgSpeed, 0, inputDuration, outputExt);
    return;
  }

  const SEGMENT_DURATION = 0.3;
  const numSegments = Math.max(10, Math.min(60, Math.ceil(totalDuration / SEGMENT_DURATION)));
  const actualSegDuration = totalDuration / numSegments;

  console.log(`Speed ramping: ${numSegments} segments over ${totalDuration.toFixed(2)}s`);

  const segments: { startTime: number; endTime: number; speed: number }[] = [];
  for (let i = 0; i < numSegments; i++) {
    const segStart = startTime + i * actualSegDuration;
    const segEnd = startTime + (i + 1) * actualSegDuration;
    const midTime = (segStart + segEnd) / 2;
    const speed = interpolateSpeed(sorted, midTime);
    segments.push({ startTime: segStart, endTime: Math.min(segEnd, endTime), speed: Math.max(0.1, Math.min(speed, 50)) });
  }

  // Merge similar segments
  const MERGE_TOLERANCE = 0.05;
  const mergedSegments: { startTime: number; endTime: number; speed: number }[] = [];
  for (const seg of segments) {
    const last = mergedSegments[mergedSegments.length - 1];
    if (last && Math.abs(last.speed - seg.speed) / Math.max(last.speed, seg.speed) < MERGE_TOLERANCE) {
      last.endTime = seg.endTime;
    } else {
      mergedSegments.push({ ...seg });
    }
  }

  console.log(`After merging: ${mergedSegments.length} segments`);

  if (mergedSegments.length === 1) {
    const seg = mergedSegments[0];
    await processUniformSpeed(inputPath, outputPath, seg.speed, seg.startTime, seg.endTime - seg.startTime, outputExt);
    return;
  }

  const segmentFiles: string[] = [];
  const jobId = uuidv4();

  try {
    for (let i = 0; i < mergedSegments.length; i++) {
      const seg = mergedSegments[i];
      const segFile = path.join(TMP_DIR, `${jobId}_seg${i}.mp4`);
      segmentFiles.push(segFile);

      let command = ffmpeg(inputPath);
      command = command.seekInput(seg.startTime);
      command = command.duration(seg.endTime - seg.startTime);

      const videoFilters: string[] = [];
      const audioFilters: string[] = [];

      if (seg.speed !== 1) {
        videoFilters.push(`setpts=PTS/${seg.speed.toFixed(6)}`);
        const atempo = buildAtempoFilter(seg.speed);
        if (atempo) audioFilters.push(atempo);
      }

      if (videoFilters.length > 0) command = command.videoFilters(videoFilters);
      if (audioFilters.length > 0) command = command.audioFilters(audioFilters);

      command = command
        .output(segFile)
        .outputOptions(['-movflags', '+faststart', '-pix_fmt', 'yuv420p']);

      await runFFmpeg(command);
    }

    const concatListPath = path.join(TMP_DIR, `${jobId}_concat.txt`);
    const concatContent = segmentFiles.map((f) => `file '${f}'`).join('\n');
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
  } finally {
    for (const segFile of segmentFiles) {
      try { await unlink(segFile); } catch { /* ignore */ }
    }
    try { await unlink(path.join(TMP_DIR, `${jobId}_concat.txt`)); } catch { /* ignore */ }
  }
}

async function processUniformSpeed(
  inputPath: string,
  outputPath: string,
  speed: number,
  trimStart: number,
  trimDuration: number,
  outputExt: string
): Promise<void> {
  speed = Math.max(0.1, Math.min(speed, 50));

  let command = ffmpeg(inputPath);
  if (trimStart > 0) command = command.seekInput(trimStart);
  if (trimDuration > 0 && trimDuration < 9999) command = command.duration(trimDuration);

  const videoFilters: string[] = [];
  const audioFilters: string[] = [];

  if (speed !== 1) {
    videoFilters.push(`setpts=PTS/${speed.toFixed(6)}`);
    const atempo = buildAtempoFilter(speed);
    if (atempo) audioFilters.push(atempo);
  }

  if (videoFilters.length > 0) command = command.videoFilters(videoFilters);
  if (audioFilters.length > 0) command = command.audioFilters(audioFilters);

  command = command.output(outputPath);

  if (outputExt === '.mp4' || outputExt === '.mov') {
    command = command.outputOptions(['-movflags', '+faststart', '-pix_fmt', 'yuv420p']);
  } else if (outputExt === '.webm') {
    command = command.outputOptions(['-c:v', 'libvpx-vp9', '-c:a', 'libopus']);
  }

  await runFFmpeg(command);
}

export async function POST(request: Request) {
  const startTime = Date.now();

  try {
    const body: ProcessRequest = await request.json();
    const { clipId, trimDuration = 1.0, speedRamps, outputFormat = 'mp4' } = body;

    if (!clipId) {
      return NextResponse.json({ error: 'clipId is required' }, { status: 400 });
    }

    // Find the uploaded file
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
    // REVERSE SPEED RAMP PROCESSING
    // ============================================
    // Step 1: Extract the first N seconds of the input video
    // Step 2: Apply 4x→0.6x speed ramp to the forward segment
    // Step 3: Reverse the trimmed segment, then apply 0.6x→4x speed ramp
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

      // Step 2: Process forward segment with 4x→0.6x speed ramp
      console.log('Step 2: Processing forward segment (4x→0.6x)');
      const forwardRamps: SpeedRampPoint[] = [
        { time: 0, speed: 4.0 },
        { time: effectiveTrimDuration, speed: 0.6 },
      ];
      await processSegmentedSpeed(trimmedFile, forwardFile, forwardRamps, effectiveTrimDuration, outputExt);

      // Step 3: Reverse the trimmed segment, then apply 0.6x→4x speed ramp
      console.log('Step 3a: Reversing the trimmed segment');
      await runFFmpeg(
        ffmpeg(trimmedFile)
          .videoFilters('reverse')
          .audioFilters('areverse')
          .output(reversedRawFile)
          .outputOptions(['-movflags', '+faststart', '-pix_fmt', 'yuv420p'])
      );

      console.log('Step 3b: Processing reversed segment (0.6x→4x)');
      const reversedRamps: SpeedRampPoint[] = [
        { time: 0, speed: 0.6 },
        { time: effectiveTrimDuration, speed: 4.0 },
      ];
      await processSegmentedSpeed(reversedRawFile, reversedFile, reversedRamps, effectiveTrimDuration, outputExt);

      // Step 4: Concatenate forward + reversed segments
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
      // Cleanup temp files
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
