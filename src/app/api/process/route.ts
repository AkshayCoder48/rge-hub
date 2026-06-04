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
  sourceClipId?: string;
  speedRamps: SpeedRampPoint[];
  trimStart: number;
  trimEnd: number;
  outputFormat: string;
}

async function ensureDir(dir: string) {
  try { await access(dir); } catch { await mkdir(dir, { recursive: true }); }
}

/**
 * Find a file by its ID prefix in a directory.
 * Files are stored as {uuid}.{ext}, so we match the id prefix.
 */
async function findFileById(dir: string, id: string): Promise<string | null> {
  try { await access(dir); } catch { return null; }
  const files = await readdir(dir);
  const match = files.find((f) => f.startsWith(id) && f.includes('.'));
  return match ? path.join(dir, match) : null;
}

/**
 * Build atempo filter chain for audio speed change.
 */
function buildAtempoFilter(speed: number): string {
  if (speed === 1) return '';
  const filters: string[] = [];
  let remaining = speed;
  while (remaining > 100) { filters.push('atempo=100.0'); remaining /= 100; }
  while (remaining < 0.5) { filters.push('atempo=0.5'); remaining /= 0.5; }
  filters.push(`atempo=${remaining.toFixed(6)}`);
  return filters.join(',');
}

/**
 * Interpolate speed at a given time from ramp points using smoothstep.
 */
function interpolateSpeed(ramps: SpeedRampPoint[], time: number): number {
  if (ramps.length === 0) return 1;
  if (ramps.length === 1) return ramps[0].speed;
  if (time <= ramps[0].time) return ramps[0].speed;
  if (time >= ramps[ramps.length - 1].time) return ramps[ramps.length - 1].speed;
  for (let i = 0; i < ramps.length - 1; i++) {
    if (time >= ramps[i].time && time <= ramps[i + 1].time) {
      const t = (time - ramps[i].time) / (ramps[i + 1].time - ramps[i].time);
      const smoothT = t * t * (3 - 2 * t); // smoothstep
      return ramps[i].speed + smoothT * (ramps[i + 1].speed - ramps[i].speed);
    }
  }
  return 1;
}

export async function POST(request: Request) {
  const startTime = Date.now();

  try {
    const body: ProcessRequest = await request.json();
    const { clipId, sourceClipId, speedRamps, trimStart = 0, trimEnd, outputFormat = 'mp4' } = body;

    if (!clipId) {
      return NextResponse.json({ error: 'clipId is required' }, { status: 400 });
    }

    // KEY FIX: Use sourceClipId to find the uploaded file
    // For reversed clips, sourceClipId points to the original clip's UUID
    // which matches the uploaded filename prefix
    const fileLookupId = sourceClipId || clipId;
    const inputPath = await findFileById(UPLOADS_DIR, fileLookupId);
    if (!inputPath) {
      return NextResponse.json(
        { error: `Source file not found for clip ID: ${clipId}, sourceClipId: ${sourceClipId || 'none'}` },
        { status: 404 }
      );
    }

    console.log(`Process: clipId=${clipId}, sourceClipId=${sourceClipId || 'none'}, inputFile=${inputPath}`);

    await ensureDir(PROCESSED_DIR);
    await ensureDir(TMP_DIR);

    const outputId = uuidv4();
    const outputExt = outputFormat === 'original'
      ? path.extname(inputPath)
      : `.${outputFormat}`;
    const outputFileName = `${outputId}${outputExt}`;
    const outputPath = path.join(PROCESSED_DIR, outputFileName);

    const effectiveTrimEnd = trimEnd > trimStart ? trimEnd : 9999;
    const trimDuration = effectiveTrimEnd - trimStart;

    if (!speedRamps || speedRamps.length < 2) {
      const speed = speedRamps?.[0]?.speed ?? 1;
      await processUniformSpeed(inputPath, outputPath, speed, trimStart, trimDuration, outputExt);
    } else if (speedRamps.length === 2 && Math.abs(speedRamps[0].speed - speedRamps[1].speed) < 0.01) {
      await processUniformSpeed(inputPath, outputPath, speedRamps[0].speed, trimStart, trimDuration, outputExt);
    } else {
      await processSegmentedSpeed(inputPath, outputPath, speedRamps, trimStart, effectiveTrimEnd, outputExt);
    }

    const outputStat = await stat(outputPath);
    const processingTime = Date.now() - startTime;

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

async function processUniformSpeed(
  inputPath: string,
  outputPath: string,
  speed: number,
  trimStart: number,
  trimDuration: number,
  outputExt: string
): Promise<void> {
  speed = Math.max(0.1, Math.min(speed, 50));

  await new Promise<void>((resolve, reject) => {
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

    command
      .on('start', (cmdLine) => console.log('FFmpeg started:', cmdLine))
      .on('end', () => { console.log('FFmpeg completed'); resolve(); })
      .on('error', (err, _stdout, stderr) => {
        console.error('FFmpeg error:', err.message, stderr);
        reject(new Error(`FFmpeg failed: ${err.message}`));
      })
      .run();
  });
}

async function processSegmentedSpeed(
  inputPath: string,
  outputPath: string,
  speedRamps: SpeedRampPoint[],
  trimStart: number,
  trimEnd: number,
  outputExt: string
): Promise<void> {
  const sorted = [...speedRamps].sort((a, b) => a.time - b.time);

  const effectiveStart = Math.max(trimStart, sorted[0].time);
  const effectiveEnd = Math.min(trimEnd, sorted[sorted.length - 1].time);
  const totalDuration = effectiveEnd - effectiveStart;

  if (totalDuration <= 0) {
    const avgSpeed = sorted.reduce((sum, r) => sum + r.speed, 0) / sorted.length;
    await processUniformSpeed(inputPath, outputPath, avgSpeed, trimStart, trimEnd - trimStart, outputExt);
    return;
  }

  const SEGMENT_DURATION = 0.3;
  const numSegments = Math.max(10, Math.min(60, Math.ceil(totalDuration / SEGMENT_DURATION)));
  const actualSegDuration = totalDuration / numSegments;

  console.log(`Speed ramping: ${numSegments} segments over ${totalDuration.toFixed(2)}s`);

  const segments: { startTime: number; endTime: number; speed: number }[] = [];

  for (let i = 0; i < numSegments; i++) {
    const segStart = effectiveStart + i * actualSegDuration;
    const segEnd = effectiveStart + (i + 1) * actualSegDuration;
    const midTime = (segStart + segEnd) / 2;
    const speed = interpolateSpeed(sorted, midTime);
    segments.push({ startTime: segStart, endTime: Math.min(segEnd, effectiveEnd), speed: Math.max(0.1, Math.min(speed, 50)) });
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

      await new Promise<void>((resolve, reject) => {
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

        command
          .on('start', (cmdLine) => console.log(`Segment ${i + 1}/${mergedSegments.length}:`, cmdLine))
          .on('end', () => resolve())
          .on('error', (err, _stdout, stderr) => {
            console.error(`Segment ${i + 1} error:`, err.message);
            reject(new Error(`Segment ${i + 1} failed: ${err.message}`));
          })
          .run();
      });
    }

    const concatListPath = path.join(TMP_DIR, `${jobId}_concat.txt`);
    const concatContent = segmentFiles.map((f) => `file '${f}'`).join('\n');
    await writeFile(concatListPath, concatContent);

    await new Promise<void>((resolve, reject) => {
      let command = ffmpeg(concatListPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .output(outputPath);

      if (outputExt === '.mp4' || outputExt === '.mov') {
        command = command.outputOptions(['-movflags', '+faststart', '-pix_fmt', 'yuv420p', '-c', 'copy']);
      } else {
        command = command.outputOptions(['-c', 'copy']);
      }

      command
        .on('start', (cmdLine) => console.log('Concat started:', cmdLine))
        .on('end', () => { console.log('Concat completed'); resolve(); })
        .on('error', (err) => {
          console.error('Concat error:', err.message);
          reject(new Error(`Concatenation failed: ${err.message}`));
        })
        .run();
    });
  } finally {
    for (const segFile of segmentFiles) {
      try { await unlink(segFile); } catch { /* ignore */ }
    }
    try { await unlink(path.join(TMP_DIR, `${jobId}_concat.txt`)); } catch { /* ignore */ }
  }
}
