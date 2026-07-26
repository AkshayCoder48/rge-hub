import { NextResponse } from 'next/server';
import { ffmpeg } from '@/lib/ffmpeg-config';
import { readdir, stat, unlink, writeFile, access, copyFile, createReadStream } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { UPLOADS_DIR, PROCESSED_DIR, TMP_DIR, ensureDirs, getFfprobePath } from '@/lib/paths';

const execFileAsync = promisify(execFile);

// Maximum trim duration in seconds — longer clips require chunked processing
const MAX_DIRECT_REVERSE_DURATION = 10;

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

function runFFmpeg(command: ReturnType<typeof ffmpeg>, timeoutMs = 600000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`FFmpeg timed out after ${timeoutMs / 1000}s`));
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
 * Compute the output duration for a linear speed ramp.
 */
export function computeRampOutputDuration(s0: number, s1: number, D: number): number {
  const deltaS = s1 - s0;
  if (Math.abs(deltaS) < 0.001) return D / s0;
  return (D / deltaS) * Math.log(1 + deltaS / s0);
}

/**
 * Build a continuous setpts expression for linear speed ramping.
 */
function buildContinuousSetpts(s0: number, s1: number, D: number): string {
  const deltaS = s1 - s0;
  if (Math.abs(deltaS) < 0.001) return `PTS/${s0.toFixed(6)}`;
  const innerExpr = `1+${deltaS.toFixed(6)}*(PTS-STARTPTS)*TB/(${s0.toFixed(6)}*${D.toFixed(6)})`;
  const escapedInner = innerExpr.replace(/,/g, '\\,');
  return `(${D.toFixed(6)}/(${deltaS.toFixed(6)}*TB))*log(max(0.0001\\,${escapedInner}))`;
}

/**
 * Process a video with smooth continuous speed ramping.
 */
async function processContinuousSpeedRamp(
  inputPath: string,
  outputPath: string,
  startSpeed: number,
  endSpeed: number,
  inputDuration: number,
  outputExt: string,
  hasAudio: boolean = true
): Promise<void> {
  const s0 = Math.max(0.1, Math.min(startSpeed, 50));
  const s1 = Math.max(0.1, Math.min(endSpeed, 50));

  const setptsExpr = buildContinuousSetpts(s0, s1, inputDuration);
  const videoOutputDuration = computeRampOutputDuration(s0, s1, inputDuration);
  const audioSpeed = Math.max(0.1, Math.min(inputDuration / videoOutputDuration, 50));

  console.log(`Smooth ramp: ${s0}x → ${s1}x over ${inputDuration}s, output ~${videoOutputDuration.toFixed(3)}s, audioSpeed=${audioSpeed.toFixed(3)}x, hasAudio=${hasAudio}`);

  let command = ffmpeg(inputPath);
  command = command.videoFilters([`setpts=${setptsExpr}`]);

  if (hasAudio) {
    const atempo = buildAtempoFilter(audioSpeed);
    if (atempo) command = command.audioFilters([atempo]);
  }

  const outputOpts = [
    '-movflags', '+faststart',
    '-pix_fmt', 'yuv420p',
    '-r', '60',
    '-crf', '18',
    '-preset', 'fast',
  ];

  if (hasAudio) {
    outputOpts.push('-c:a', 'aac', '-b:a', '128k');
  } else {
    outputOpts.push('-an');
  }

  command = command.output(outputPath).outputOptions(outputOpts);

  await runFFmpeg(command);
}

/**
 * Reverse a video using the simple in-memory `reverse` filter.
 * Only suitable for short clips (< MAX_DIRECT_REVERSE_DURATION seconds).
 */
async function reverseVideoDirect(inputPath: string, outputPath: string, hasAudio: boolean = true): Promise<void> {
  const command = ffmpeg(inputPath)
    .videoFilters('reverse');

  if (hasAudio) {
    command.audioFilters('areverse');
  }

  const outputOpts = ['-movflags', '+faststart', '-pix_fmt', 'yuv420p'];
  if (hasAudio) {
    outputOpts.push('-c:a', 'aac', '-b:a', '128k');
  } else {
    outputOpts.push('-an');
  }

  command.output(outputPath).outputOptions(outputOpts);
  await runFFmpeg(command);
}

/**
 * Reverse a video using chunked processing to avoid OOM on long clips.
 */
async function reverseVideoChunked(inputPath: string, outputPath: string, duration: number, hasAudio: boolean = true): Promise<void> {
  const CHUNK_DURATION = 5;
  const numChunks = Math.ceil(duration / CHUNK_DURATION);
  const jobId = uuidv4();

  console.log(`Chunked reverse: ${duration.toFixed(2)}s → ${numChunks} chunks of ${CHUNK_DURATION}s, hasAudio=${hasAudio}`);

  const chunkFiles: string[] = [];
  const reversedChunkFiles: string[] = [];

  try {
    for (let i = 0; i < numChunks; i++) {
      const startTime = i * CHUNK_DURATION;
      const chunkDur = Math.min(CHUNK_DURATION, duration - startTime);
      const chunkFile = path.join(TMP_DIR, `${jobId}_chunk_${i}.mp4`);
      chunkFiles.push(chunkFile);

      await runFFmpeg(
        ffmpeg(inputPath)
          .seekInput(startTime)
          .duration(chunkDur)
          .output(chunkFile)
          .outputOptions([
            '-movflags', '+faststart',
            '-pix_fmt', 'yuv420p',
            '-c:v', 'libx264',
            '-crf', '18',
            '-preset', 'fast',
            '-r', '30',
          ])
      );
    }

    for (let i = 0; i < numChunks; i++) {
      const reversedChunkFile = path.join(TMP_DIR, `${jobId}_rchunk_${i}.mp4`);
      reversedChunkFiles.unshift(reversedChunkFile);

      const chunkCmd = ffmpeg(chunkFiles[i]).videoFilters('reverse');
      if (hasAudio) {
        chunkCmd.audioFilters('areverse');
      }

      const outputOpts = ['-movflags', '+faststart', '-pix_fmt', 'yuv420p'];
      if (hasAudio) {
        outputOpts.push('-c:a', 'aac', '-b:a', '128k');
      } else {
        outputOpts.push('-an');
      }

      chunkCmd.output(reversedChunkFile).outputOptions(outputOpts);
      await runFFmpeg(chunkCmd);
    }

    const concatListPath = path.join(TMP_DIR, `${jobId}_reverse_concat.txt`);
    const concatContent = reversedChunkFiles.map((f) => `file '${f}'`).join('\n');
    await writeFile(concatListPath, concatContent);

    await runFFmpeg(
      ffmpeg(concatListPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .output(outputPath)
        .outputOptions(['-movflags', '+faststart', '-pix_fmt', 'yuv420p', '-c', 'copy'])
    );

    await unlink(concatListPath);
  } finally {
    for (const f of [...chunkFiles, ...reversedChunkFiles]) {
      try { await unlink(f); } catch { /* ignore */ }
    }
  }
}

/**
 * Fallback: segmented speed ramping with much finer segments (0.02s)
 */
async function processFineSegmentedSpeed(
  inputPath: string,
  outputPath: string,
  startSpeed: number,
  endSpeed: number,
  inputDuration: number,
  outputExt: string,
  hasAudio: boolean = true
): Promise<void> {
  const s0 = Math.max(0.1, Math.min(startSpeed, 50));
  const s1 = Math.max(0.1, Math.min(endSpeed, 50));

  const SEGMENT_DURATION = 0.02;
  const numSegments = Math.max(20, Math.ceil(inputDuration / SEGMENT_DURATION));
  const actualSegDuration = inputDuration / numSegments;

  console.log(`Fine segmented ramp: ${s0}x → ${s1}x, ${numSegments} segments over ${inputDuration}s, hasAudio=${hasAudio}`);

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
        if (hasAudio) {
          const atempo = buildAtempoFilter(seg.speed);
          if (atempo) audioFilters.push(atempo);
        }
      }

      if (videoFilters.length > 0) command = command.videoFilters(videoFilters);
      if (audioFilters.length > 0) command = command.audioFilters(audioFilters);

      const outputOpts = ['-movflags', '+faststart', '-pix_fmt', 'yuv420p', '-r', '60', '-crf', '18', '-preset', 'fast'];
      if (!hasAudio) {
        outputOpts.push('-an');
      }

      command = command
        .output(segFile)
        .outputOptions(outputOpts);

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

/**
 * Combined upload + process endpoint for Vercel serverless compatibility.
 * Receives the video file and trimDuration in one request,
 * processes the speed ramp, and returns the processed video directly.
 */
export async function POST(request: Request) {
  const startTime = Date.now();

  try {
    ensureDirs();

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

    // Save uploaded file to /tmp
    const jobId = uuidv4();
    const ext = path.extname(file.name) || '.mp4';
    const inputPath = path.join(TMP_DIR, `${jobId}_input${ext}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(inputPath, buffer);

    // Probe the video
    const probe = await probeVideo(inputPath);
    console.log(`Video probe: hasAudio=${probe.hasAudio}, duration=${probe.duration.toFixed(2)}s, ${probe.width}x${probe.height}, ${probe.fps}fps, pix_fmt=${probe.pixFmt}`);

    const effectiveTrimDuration = Math.max(0.1, trimDuration);

    console.log(`Process: trimDuration=${effectiveTrimDuration}s`);

    // Process the speed ramp
    const trimmedFile = path.join(TMP_DIR, `${jobId}_trimmed.mp4`);
    const forwardFile = path.join(TMP_DIR, `${jobId}_forward.mp4`);
    const reversedRawFile = path.join(TMP_DIR, `${jobId}_reversed_raw.mp4`);
    const reversedFile = path.join(TMP_DIR, `${jobId}_reversed.mp4`);
    const concatFile = path.join(TMP_DIR, `${jobId}_concat.mp4`);
    const outputFile = path.join(TMP_DIR, `${jobId}_output.mp4`);

    const outputExt = '.mp4';

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
          4.0, 0.6, effectiveTrimDuration, outputExt,
          probe.hasAudio
        );
      } catch (continuousErr) {
        console.warn('Continuous setpts failed, falling back to fine-segmented:', continuousErr);
        await processFineSegmentedSpeed(
          trimmedFile, forwardFile,
          4.0, 0.6, effectiveTrimDuration, outputExt,
          probe.hasAudio
        );
      }

      // Step 3: Reverse the trimmed segment
      if (effectiveTrimDuration > MAX_DIRECT_REVERSE_DURATION) {
        console.log(`Step 3a: Chunked reverse (${effectiveTrimDuration.toFixed(1)}s > ${MAX_DIRECT_REVERSE_DURATION}s threshold)`);
        await reverseVideoChunked(trimmedFile, reversedRawFile, effectiveTrimDuration, probe.hasAudio);
      } else {
        console.log('Step 3a: Direct reverse (short clip)');
        await reverseVideoDirect(trimmedFile, reversedRawFile, probe.hasAudio);
      }

      // Step 4: Reversed segment with continuous 0.6x→4x speed ramp
      console.log('Step 3b: Processing smooth reversed segment (0.6x→4x)');
      try {
        await processContinuousSpeedRamp(
          reversedRawFile, reversedFile,
          0.6, 4.0, effectiveTrimDuration, outputExt,
          probe.hasAudio
        );
      } catch (continuousErr) {
        console.warn('Continuous setpts failed for reversed, falling back to fine-segmented:', continuousErr);
        await processFineSegmentedSpeed(
          reversedRawFile, reversedFile,
          0.6, 4.0, effectiveTrimDuration, outputExt,
          probe.hasAudio
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
        .output(concatFile);

      concatCmd = concatCmd.outputOptions(['-movflags', '+faststart', '-pix_fmt', 'yuv420p', '-c', 'copy']);

      await runFFmpeg(concatCmd);
      await unlink(concatListPath);

      // Copy concat result to output
      await copyFile(concatFile, outputFile);
    } finally {
      // Clean up intermediate files
      for (const f of [inputPath, trimmedFile, forwardFile, reversedRawFile, reversedFile, concatFile]) {
        try { await unlink(f); } catch { /* ignore */ }
      }
    }

    // Return the processed video file directly in the response
    const fileStats = await stat(outputFile);
    const originalName = file.name.replace(/\.[^/.]+$/, '');
    const processingTime = Date.now() - startTime;

    console.log(`Processing complete in ${processingTime}ms, output size: ${fileStats.size} bytes`);

    const fileStream = createReadStream(outputFile);

    // Clean up the output file after streaming
    // We need to delete it after the stream ends
    fileStream.on('end', () => {
      unlink(outputFile).catch(() => { /* ignore */ });
    });
    fileStream.on('error', () => {
      unlink(outputFile).catch(() => { /* ignore */ });
    });

    return new NextResponse(fileStream as any, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="speedramp_${originalName}.mp4"`,
        'Content-Length': String(fileStats.size),
        'X-Processing-Time': String(processingTime),
      },
    });
  } catch (error) {
    console.error('Process error:', error);
    const message = error instanceof Error ? error.message : 'Failed to process video';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
