import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { spawn } from 'child_process';
import { mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { readFile, stat } from 'fs/promises';
import { UPLOADS_DIR, PROCESSED_DIR, TMP_DIR, getFfmpegPath, getFfprobePath, hasFfprobe } from '@/lib/paths';

// ============================================
// SPEED RAMP API - Full Parameter Configuration
// ============================================
//
// POST /api/speedramp
// Accepts: FormData with "file" + "config" (JSON string)
//
// Works on ALL platforms:
// - Vercel: Uses ffmpeg-static npm package (no system ffmpeg needed)
// - Render/Docker: Uses system ffmpeg from Docker image
// - Local: Uses system ffmpeg or ffmpeg-static fallback
//
// Vercel-specific notes:
// - Hobby plan: 4.5MB body limit, 10s execution → may fail for larger videos
// - Pro plan: 50MB body limit, 60s execution → works for most clips
// - Recommended: Deploy on Render/Docker for video processing
//
// Config parameters:
//   mode:           "vramp" | "linear" | "custom"  (default: "vramp")
//   trimDuration:   number (seconds, default: full video)
//   trimStart:      number (seconds, default: 0)
//   startSpeed:     number (for linear/vramp, default: 4.0)
//   endSpeed:       number (for linear, default: 0.6)
//   rampMid:        number (for vramp mid-point, default: 0.6)
//   rampEnd:        number (for vramp end-point, default: 4.0)
//   speedPoints:    [{time, speed}] (for custom mode)
//   reverse:        boolean (add reversed+concat, default: true for vramp)
//   outputFps:      number (default: 30)
//   crf:            number (quality 0-51, default: 23)
//   preset:         "ultrafast"|"fast"|"medium"|"slow" (default: "ultrafast")
//   audioMode:      "auto"|"strip"|"adjust" (default: "auto")
//   outputFormat:   "mp4"|"mov"|"webm" (default: "mp4")
//   outputScale:    string e.g. "1280x720" or null (default: null = keep original)
//   codec:          "libx264"|"libx265"|"libvpx-vp9" (default: "libx264")
//
// GET /api/speedramp
// Returns: API documentation and parameter schema
// ============================================

// Next.js App Router: maxDuration for Vercel Pro/Enterprise
// - Hobby: 10s (hard limit, cannot override)
// - Pro: 60s (can override up to 300s)
// - Enterprise: up to 900s
// For Docker/Render: no limit
export const maxDuration = 60;

// ---- Config Types ----

interface SpeedPoint {
  time: number;  // Position in source video (seconds)
  speed: number; // Speed multiplier at this position
}

interface SpeedRampConfig {
  mode: 'vramp' | 'linear' | 'custom';
  trimDuration?: number;
  trimStart?: number;
  startSpeed?: number;
  endSpeed?: number;
  rampMid?: number;
  rampEnd?: number;
  speedPoints?: SpeedPoint[];
  reverse?: boolean;
  outputFps?: number;
  crf?: number;
  preset?: string;
  audioMode?: 'auto' | 'strip' | 'adjust';
  outputFormat?: string;
  outputScale?: string | null;
  codec?: string;
}

const DEFAULT_CONFIG: Required<SpeedRampConfig> = {
  mode: 'vramp',
  trimDuration: 1.0,
  trimStart: 0,
  startSpeed: 4.0,
  endSpeed: 0.6,
  rampMid: 0.6,
  rampEnd: 4.0,
  speedPoints: [],
  reverse: true,
  outputFps: 30,
  crf: 23,
  preset: 'ultrafast',
  audioMode: 'auto',
  outputFormat: 'mp4',
  outputScale: null,
  codec: 'libx264',
};

const VALID_PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'];
const VALID_FORMATS = ['mp4', 'mov', 'webm'];
const VALID_CODECS = ['libx264', 'libx265', 'libvpx-vp9'];
const VALID_MODES = ['vramp', 'linear', 'custom'];
const VALID_AUDIO_MODES = ['auto', 'strip', 'adjust'];

// ---- FFmpeg Helpers ----

function runFFmpeg(args: string[], timeoutMs = 120000): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpegPath = getFfmpegPath();
    console.log(`FFmpeg: ffmpeg ${args.join(' ')}`);
    const proc = spawn(ffmpegPath, args);

    let stderrOutput = '';
    proc.stderr.on('data', (data: Buffer) => { stderrOutput += data.toString(); });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`FFmpeg timed out after ${timeoutMs / 1000}s. Video may be too large or complex.`));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else {
        const lines = stderrOutput.split('\n').filter((l) => l.trim());
        const lastErr = lines.filter((l) => l.includes('Error') || l.includes('error')).pop();
        reject(new Error(`FFmpeg failed: ${lastErr ? lastErr.trim() : `exited with code ${code}`}`));
      }
    });

    proc.on('error', (err) => { clearTimeout(timer); reject(new Error(`FFmpeg process error: ${err.message}`)); });
  });
}

async function probeVideo(filePath: string) {
  // Try ffprobe first (available on Docker/Render/local)
  if (hasFfprobe()) {
    try {
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);
      const ffprobePath = getFfprobePath()!;

      const { stdout } = await execFileAsync(ffprobePath, [
        '-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', filePath,
      ]);

      const info = JSON.parse(stdout);
      const streams = info.streams || [];
      const hasAudio = streams.some((s: Record<string, unknown>) => s.codec_type === 'audio');
      const vs = streams.find((s: Record<string, unknown>) => s.codec_type === 'video');

      let duration = 0;
      if (info.format?.duration) duration = parseFloat(info.format.duration);
      else if (vs?.duration) duration = parseFloat(vs.duration as string);

      const width = vs?.width || 1920;
      const height = vs?.height || 1080;
      let fps = 30;
      if (vs?.r_frame_rate) {
        const parts = (vs.r_frame_rate as string).split('/');
        if (parts.length === 2 && parseInt(parts[1]) > 0) fps = Math.round(parseInt(parts[0]) / parseInt(parts[1]));
      }
      const pixFmt = (vs?.pix_fmt as string) || 'yuv420p';
      const codec = (vs?.codec_name as string) || 'h264';

      return { hasAudio, duration, width, height, fps, pixFmt, codec };
    } catch (err) {
      console.warn('ffprobe failed, trying ffmpeg probe:', err);
    }
  }

  // Fallback: Use ffmpeg itself to probe (works on Vercel where ffprobe is unavailable)
  // ffmpeg -i <file> -hide_banner outputs stream info to stderr and exits with code 1
  try {
    const ffmpegPath = getFfmpegPath();
    const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const proc = spawn(ffmpegPath, ['-i', filePath, '-hide_banner']);
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      // ffmpeg -i exits with code 1 (no output specified), but stderr contains all info
      proc.on('close', (code) => {
        // Code 1 is expected when no output file is specified
        resolve({ stdout, stderr });
      });
      proc.on('error', (err) => reject(err));
    });

    // Parse ffmpeg stderr output to extract video info
    const stderr = result.stderr;
    let duration = 0;
    let width = 1920, height = 1080;
    let fps = 30;
    let pixFmt = 'yuv420p';
    let codec = 'h264';
    let hasAudio = false;

    // Duration: "Duration: 00:00:03.00, start: ..."
    const durMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
    if (durMatch) {
      duration = parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 + parseFloat(durMatch[3]);
    }

    // Video stream: "Stream #0:0(und): Video: h264, yuv420p, 320x240 ..."
    const videoMatch = stderr.match(/Stream\s*#\d+:\d+[\w()]*:\s*Video:\s*(\w+),\s*(\w+),\s*(\d+)x(\d+)/);
    if (videoMatch) {
      codec = videoMatch[1];
      pixFmt = videoMatch[2];
      width = parseInt(videoMatch[3]);
      height = parseInt(videoMatch[4]);
    }

    // FPS: "24 fps", "30 tbr", "60 tbr", "r_frame_rate=30/1"
    const fpsMatch = stderr.match(/(\d+)\s*(fps|tbr)\b/);
    if (fpsMatch) fps = parseInt(fpsMatch[1]);
    const rFrameMatch = stderr.match(/r_frame_rate\s*=\s*(\d+)\/(\d+)/);
    if (rFrameMatch && parseInt(rFrameMatch[2]) > 0) fps = Math.round(parseInt(rFrameMatch[1]) / parseInt(rFrameMatch[2]));

    // Audio stream detection
    hasAudio = /Stream\s*#\d+:\d+[\w()]*:\s*Audio:/i.test(stderr);

    return { hasAudio, duration, width, height, fps, pixFmt, codec };
  } catch (err) {
    console.warn('FFmpeg probe also failed, using defaults:', err);
    return { hasAudio: true, duration: 0, width: 1920, height: 1080, fps: 30, pixFmt: 'yuv420p', codec: 'h264' };
  }
}

function computeRampOutputDuration(s0: number, s1: number, D: number): number {
  const deltaS = s1 - s0;
  if (Math.abs(deltaS) < 0.001) return D / s0;
  return (D / deltaS) * Math.log(1 + deltaS / s0);
}

function buildContinuousSetpts(s0: number, s1: number, D: number): string {
  const deltaS = s1 - s0;
  if (Math.abs(deltaS) < 0.001) return `PTS/${s0.toFixed(6)}`;
  const innerExpr = `1+${deltaS.toFixed(6)}*(PTS-STARTPTS)*TB/(${s0.toFixed(6)}*${D.toFixed(6)})`;
  const escapedInner = innerExpr.replace(/,/g, '\\,');
  return `(${D.toFixed(6)}/(${deltaS.toFixed(6)}*TB))*log(max(0.0001\\,${escapedInner}))`;
}

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

function parseConfig(raw: string | null): Required<SpeedRampConfig> {
  if (!raw) return DEFAULT_CONFIG;
  try {
    const parsed = JSON.parse(raw) as SpeedRampConfig;
    return {
      mode: VALID_MODES.includes(parsed.mode || '') ? parsed.mode! : DEFAULT_CONFIG.mode,
      trimDuration: Math.max(0.1, parsed.trimDuration ?? DEFAULT_CONFIG.trimDuration),
      trimStart: Math.max(0, parsed.trimStart ?? DEFAULT_CONFIG.trimStart),
      startSpeed: Math.max(0.1, Math.min(50, parsed.startSpeed ?? DEFAULT_CONFIG.startSpeed)),
      endSpeed: Math.max(0.1, Math.min(50, parsed.endSpeed ?? DEFAULT_CONFIG.endSpeed)),
      rampMid: Math.max(0.1, Math.min(50, parsed.rampMid ?? DEFAULT_CONFIG.rampMid)),
      rampEnd: Math.max(0.1, Math.min(50, parsed.rampEnd ?? DEFAULT_CONFIG.rampEnd)),
      speedPoints: parsed.speedPoints && parsed.speedPoints.length >= 2 ? parsed.speedPoints : DEFAULT_CONFIG.speedPoints,
      reverse: parsed.reverse ?? DEFAULT_CONFIG.reverse,
      outputFps: Math.max(1, Math.min(120, parsed.outputFps ?? DEFAULT_CONFIG.outputFps)),
      crf: Math.max(0, Math.min(51, parsed.crf ?? DEFAULT_CONFIG.crf)),
      preset: VALID_PRESETS.includes(parsed.preset || '') ? parsed.preset! : DEFAULT_CONFIG.preset,
      audioMode: VALID_AUDIO_MODES.includes(parsed.audioMode || '') ? parsed.audioMode! : DEFAULT_CONFIG.audioMode,
      outputFormat: VALID_FORMATS.includes(parsed.outputFormat || '') ? parsed.outputFormat! : DEFAULT_CONFIG.outputFormat,
      outputScale: parsed.outputScale ?? DEFAULT_CONFIG.outputScale,
      codec: VALID_CODECS.includes(parsed.codec || '') ? parsed.codec! : DEFAULT_CONFIG.codec,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function getOutputMimeType(format: string): string {
  switch (format) {
    case 'mov': return 'video/quicktime';
    case 'webm': return 'video/webm';
    default: return 'video/mp4';
  }
}

// ============================================
// OPTIMIZED PROCESSING LOGIC
// ============================================
// Key optimizations:
// 1. Combine trim + speed ramp in a SINGLE FFmpeg call (instead of separate trim + ramp)
// 2. Use -ss before input for fast seeking (no full decode)
// 3. Combine reverse + speed ramp in single call where possible
// 4. Use ultrafast preset + 30fps as defaults for speed
// 5. Avoid redundant re-encoding steps

async function processSpeedRamp(
  inputPath: string,
  config: Required<SpeedRampConfig>,
  probe: { hasAudio: boolean; duration: number; width: number; height: number; fps: number; pixFmt: string; codec: string },
  jobId: string,
): Promise<string> {
  const effectiveTrimDuration = Math.max(0.1, Math.min(
    config.trimDuration,
    probe.duration || config.trimDuration
  ));
  const trimStart = config.trimStart;
  const shouldHandleAudio = config.audioMode !== 'strip' && probe.hasAudio;

  const outputExt = config.outputFormat === 'mp4' ? '.mp4'
    : config.outputFormat === 'mov' ? '.mov' : '.webm';
  const outputFile = path.join(TMP_DIR, `${jobId}_output${outputExt}`);

  // Common video filter suffix
  const vfSuffix: string[] = [];
  if (config.outputScale) vfSuffix.push(`scale=${config.outputScale}`);
  vfSuffix.push('format=yuv420p');

  // Common output args
  function buildOutputArgs(audioFilter?: string): string[] {
    const args = [
      '-movflags', '+faststart',
      '-r', String(config.outputFps),
      '-c:v', config.codec,
      '-crf', String(config.crf),
      '-preset', config.preset,
    ];
    if (config.codec === 'libx265') args.push('-tag:v', 'hvc1');
    if (shouldHandleAudio && audioFilter) {
      args.push('-af', audioFilter, '-c:a', 'aac', '-b:a', '128k');
    } else if (shouldHandleAudio) {
      args.push('-c:a', 'aac', '-b:a', '128k');
    } else {
      args.push('-an');
    }
    return args;
  }

  // ---- Input seeking args (fast seek) ----
  const seekArgs = trimStart > 0 ? ['-ss', String(trimStart)] : [];
  const trimArgs = ['-t', String(effectiveTrimDuration)];

  if (config.mode === 'vramp') {
    // ---- V-RAMP MODE (OPTIMIZED: 2-3 FFmpeg calls instead of 5) ----
    // 
    // OLD pipeline (5 calls):
    //   1. Trim (re-encode) → 2. Forward ramp (re-encode) → 3. Reverse (re-encode) → 4. Reverse ramp (re-encode) → 5. Concat (copy)
    //
    // NEW pipeline (2-3 calls):
    //   1. Trim + Forward ramp in ONE call (seek + filter) 
    //   2. If reverse: Trim + Reverse in ONE call (seek + reverse filter)
    //   3. If reverse: Apply reversed speed ramp on the reversed segment
    //   4. If reverse: Concat (copy)

    const forwardSetpts = buildContinuousSetpts(config.startSpeed, config.rampMid, effectiveTrimDuration);
    const forwardOutputDur = computeRampOutputDuration(config.startSpeed, config.rampMid, effectiveTrimDuration);
    const forwardAudioSpeed = effectiveTrimDuration / forwardOutputDur;
    const forwardAudioFilter = buildAtempoChain(forwardAudioSpeed);

    console.log(`V-Ramp forward: ${config.startSpeed}x → ${config.rampMid}x over ${effectiveTrimDuration}s`);

    // Step 1: Trim + Forward ramp combined (single FFmpeg call)
    const forwardFile = path.join(TMP_DIR, `${jobId}_forward${outputExt}`);
    const forwardVf = [`setpts=${forwardSetpts}`, ...vfSuffix].join(',');

    await runFFmpeg([
      '-y', ...seekArgs, '-i', inputPath, ...trimArgs,
      '-vf', forwardVf,
      ...buildOutputArgs(forwardAudioFilter),
      forwardFile,
    ]);

    if (config.reverse) {
      // Step 2: Trim + Reverse combined (single FFmpeg call)
      console.log('Reversing segment');
      const reversedRawFile = path.join(TMP_DIR, `${jobId}_reversed_raw${outputExt}`);

      const reverseVf = ['reverse', ...vfSuffix].join(',');
      const reverseAf = shouldHandleAudio ? 'areverse' : undefined;

      await runFFmpeg([
        '-y', ...seekArgs, '-i', inputPath, ...trimArgs,
        '-vf', reverseVf,
        ...(reverseAf ? ['-af', reverseAf] : []),
        ...buildOutputArgs(),
        reversedRawFile,
      ]);

      // Step 3: Apply speed ramp to reversed segment
      const reverseSetpts = buildContinuousSetpts(config.rampMid, config.rampEnd, effectiveTrimDuration);
      const reverseOutputDur = computeRampOutputDuration(config.rampMid, config.rampEnd, effectiveTrimDuration);
      const reverseAudioSpeed = effectiveTrimDuration / reverseOutputDur;
      const reverseAudioFilter = buildAtempoChain(reverseAudioSpeed);

      console.log(`V-Ramp reversed: ${config.rampMid}x → ${config.rampEnd}x`);

      const reversedFile = path.join(TMP_DIR, `${jobId}_reversed${outputExt}`);
      const reversedVf = [`setpts=${reverseSetpts}`, ...vfSuffix].join(',');

      await runFFmpeg([
        '-y', '-i', reversedRawFile,
        '-vf', reversedVf,
        ...buildOutputArgs(reverseAudioFilter),
        reversedFile,
      ]);

      // Step 4: Concatenate forward + reversed
      console.log('Concatenating forward + reversed');
      const concatListPath = path.join(TMP_DIR, `${jobId}_concat.txt`);
      writeFileSync(concatListPath, `file '${forwardFile}'\nfile '${reversedFile}'`);

      await runFFmpeg([
        '-y', '-f', 'concat', '-safe', '0', '-i', concatListPath,
        '-movflags', '+faststart', '-c', 'copy',
        outputFile,
      ]);

      // Cleanup intermediates
      for (const f of [forwardFile, reversedRawFile, reversedFile, concatListPath]) {
        try { unlinkSync(f); } catch { /* */ }
      }
      return outputFile;
    } else {
      // No reverse — just copy forward file to output
      const data = await readFile(forwardFile);
      writeFileSync(outputFile, data);
      try { unlinkSync(forwardFile); } catch { /* */ }
      return outputFile;
    }

  } else if (config.mode === 'linear') {
    // ---- LINEAR MODE (OPTIMIZED: 1-3 FFmpeg calls instead of 4) ----

    const setptsExpr = buildContinuousSetpts(config.startSpeed, config.endSpeed, effectiveTrimDuration);
    const outputDur = computeRampOutputDuration(config.startSpeed, config.endSpeed, effectiveTrimDuration);
    const audioSpeed = effectiveTrimDuration / outputDur;
    const audioFilter = shouldHandleAudio ? buildAtempoChain(audioSpeed) : undefined;

    console.log(`Linear ramp: ${config.startSpeed}x → ${config.endSpeed}x over ${effectiveTrimDuration}s`);

    const rampedVf = [`setpts=${setptsExpr}`, ...vfSuffix].join(',');

    if (config.reverse) {
      // With reverse: 3 calls (ramp, reverse, concat)
      const rampedFile = path.join(TMP_DIR, `${jobId}_ramped${outputExt}`);
      const reversedFile = path.join(TMP_DIR, `${jobId}_reversed${outputExt}`);
      const concatListPath = path.join(TMP_DIR, `${jobId}_concat.txt`);

      // Step 1: Trim + speed ramp combined
      await runFFmpeg([
        '-y', ...seekArgs, '-i', inputPath, ...trimArgs,
        '-vf', rampedVf,
        ...buildOutputArgs(audioFilter),
        rampedFile,
      ]);

      // Step 2: Reverse the ramped video
      const reverseVf = ['reverse', ...vfSuffix].join(',');
      const reverseAf = shouldHandleAudio ? 'areverse' : undefined;

      await runFFmpeg([
        '-y', '-i', rampedFile,
        '-vf', reverseVf,
        ...(reverseAf ? ['-af', reverseAf] : []),
        ...buildOutputArgs(),
        reversedFile,
      ]);

      // Step 3: Concatenate ramped + reversed
      writeFileSync(concatListPath, `file '${rampedFile}'\nfile '${reversedFile}'`);

      await runFFmpeg([
        '-y', '-f', 'concat', '-safe', '0', '-i', concatListPath,
        '-movflags', '+faststart', '-c', 'copy',
        outputFile,
      ]);

      for (const f of [rampedFile, reversedFile, concatListPath]) {
        try { unlinkSync(f); } catch { /* */ }
      }
      return outputFile;
    } else {
      // No reverse — single FFmpeg call (trim + ramp combined)
      await runFFmpeg([
        '-y', ...seekArgs, '-i', inputPath, ...trimArgs,
        '-vf', rampedVf,
        ...buildOutputArgs(audioFilter),
        outputFile,
      ]);
      return outputFile;
    }

  } else if (config.mode === 'custom') {
    // ---- CUSTOM MODE ----

    const points = config.speedPoints;
    if (!points || points.length < 2) {
      throw new Error('Custom mode requires at least 2 speedPoints');
    }

    const sorted = [...points].sort((a, b) => a.time - b.time);
    const segmentFiles: string[] = [];
    const segmentListPath = path.join(TMP_DIR, `${jobId}_segments.txt`);

    for (let i = 0; i < sorted.length - 1; i++) {
      const p0 = sorted[i];
      const p1 = sorted[i + 1];
      const segDuration = p1.time - p0.time;
      if (segDuration <= 0) continue;

      const segFile = path.join(TMP_DIR, `${jobId}_seg${i}${outputExt}`);
      const setptsExpr = buildContinuousSetpts(p0.speed, p1.speed, segDuration);
      const outputDur = computeRampOutputDuration(p0.speed, p1.speed, segDuration);
      const audioSpeed = segDuration / outputDur;
      const audioFilter = shouldHandleAudio ? buildAtempoChain(audioSpeed) : undefined;

      const segVf = [`setpts=${setptsExpr}`, ...vfSuffix].join(',');

      console.log(`Custom segment ${i}: ${p0.speed}x → ${p1.speed}x over ${segDuration.toFixed(2)}s`);

      // Combine trim + segment ramp in one call
      await runFFmpeg([
        '-y',
        '-ss', String(trimStart + p0.time), '-i', inputPath,
        '-t', String(segDuration),
        '-vf', segVf,
        ...buildOutputArgs(audioFilter),
        segFile,
      ]);

      segmentFiles.push(segFile);
    }

    // Concatenate all segments
    if (segmentFiles.length === 1) {
      const data = await readFile(segmentFiles[0]);
      writeFileSync(outputFile, data);
      try { unlinkSync(segmentFiles[0]); } catch { /* */ }
    } else {
      writeFileSync(segmentListPath, segmentFiles.map((f) => `file '${f}'`).join('\n'));
      await runFFmpeg([
        '-y', '-f', 'concat', '-safe', '0', '-i', segmentListPath,
        '-movflags', '+faststart', '-c', 'copy',
        outputFile,
      ]);
      for (const f of [...segmentFiles, segmentListPath]) {
        try { unlinkSync(f); } catch { /* */ }
      }
    }

    // Optionally reverse and concatenate
    if (config.reverse) {
      const reversedFile = path.join(TMP_DIR, `${jobId}_custom_reversed${outputExt}`);
      const finalConcatList = path.join(TMP_DIR, `${jobId}_final_concat.txt`);

      const reverseVf = ['reverse', ...vfSuffix].join(',');
      const reverseAf = shouldHandleAudio ? 'areverse' : undefined;

      await runFFmpeg([
        '-y', '-i', outputFile,
        '-vf', reverseVf,
        ...(reverseAf ? ['-af', reverseAf] : []),
        ...buildOutputArgs(),
        reversedFile,
      ]);

      writeFileSync(finalConcatList, `file '${outputFile}'\nfile '${reversedFile}'`);

      const finalOutputFile = path.join(TMP_DIR, `${jobId}_final${outputExt}`);
      await runFFmpeg([
        '-y', '-f', 'concat', '-safe', '0', '-i', finalConcatList,
        '-movflags', '+faststart', '-c', 'copy',
        finalOutputFile,
      ]);

      // Overwrite outputFile with concatenated result
      const data = await readFile(finalOutputFile);
      writeFileSync(outputFile, data);

      for (const f of [reversedFile, finalConcatList, finalOutputFile]) {
        try { unlinkSync(f); } catch { /* */ }
      }
    }

    return outputFile;
  }

  throw new Error(`Unknown mode: ${config.mode}`);
}

// ============================================
// POST HANDLER
// ============================================

export async function POST(request: Request) {
  const startTime = Date.now();

  try {
    // Ensure directories exist
    for (const dir of [UPLOADS_DIR, PROCESSED_DIR, TMP_DIR]) {
      mkdirSync(dir, { recursive: true });
    }

    // Check FFmpeg availability BEFORE processing
    const ffmpegPath = getFfmpegPath();
    console.log(`[SpeedRamp] Using ffmpeg at: ${ffmpegPath}`);

    const formData = await request.formData();
    const file = formData.get('file');
    const configRaw = formData.get('config') as string | null;
    const trimDurationStr = formData.get('trimDuration') as string | null;

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'No video file provided.' }, { status: 400 });
    }

    const config = parseConfig(configRaw);
    if (trimDurationStr) {
      const td = parseFloat(trimDurationStr);
      if (!isNaN(td) && td > 0) config.trimDuration = td;
    }

    // Validate file type
    const validVideoExtensions = ['.mp4', '.mov', '.avi', '.webm', '.mkv', '.flv', '.mpeg', '.3gp', '.m4v'];
    const fileExt = path.extname(file.name).toLowerCase();
    const isVideoType = file.type.startsWith('video/');
    const isOctetStream = file.type === 'application/octet-stream';
    const hasValidExt = validVideoExtensions.includes(fileExt);

    if (!isVideoType && !isOctetStream && !hasValidExt) {
      return NextResponse.json({ error: `Invalid file type: ${file.type}` }, { status: 400 });
    }

    // File size limit with Vercel-specific messaging
    // Vercel Hobby: 4.5MB limit, Pro: 50MB
    const isVercel = !!process.env.VERCEL;
    const maxFileSize = isVercel ? 50 * 1024 * 1024 : 500 * 1024 * 1024; // 50MB on Vercel, 500MB elsewhere
    const fileSizeMB = Math.round(file.size / 1024 / 1024);

    if (file.size > maxFileSize) {
      if (isVercel) {
        return NextResponse.json({
          error: `File too large (${fileSizeMB}MB). Vercel serverless has a request body size limit. Maximum on Pro plan is 50MB. For larger videos, deploy on Render or Docker.`,
          hint: 'Deploy on Render (free tier) or Docker for unlimited video processing.',
        }, { status: 400 });
      }
      return NextResponse.json({ error: `File too large (${fileSizeMB}MB). Maximum is 500MB.` }, { status: 400 });
    }

    const jobId = uuidv4();
    const ext = fileExt || '.mp4';
    const inputPath = path.join(TMP_DIR, `${jobId}_input${ext}`);

    // Save uploaded file
    const buffer = Buffer.from(await file.arrayBuffer());
    writeFileSync(inputPath, buffer);

    // Probe video
    const probe = await probeVideo(inputPath);
    console.log(`[SpeedRamp] mode=${config.mode}, trim=${config.trimDuration}s, speeds=${config.startSpeed}x→${config.rampMid}x→${config.rampEnd}x, reverse=${config.reverse}, fps=${config.outputFps}, crf=${config.crf}, preset=${config.preset}, audio=${config.audioMode}, format=${config.outputFormat}, input=${probe.width}x${probe.height}@${probe.fps}fps, ${probe.duration}s`);

    // Process video
    const outputFile = await processSpeedRamp(inputPath, config, probe, jobId);

    // Clean up input file
    try { unlinkSync(inputPath); } catch { /* */ }

    // Read output as buffer and return
    const outputBuffer = await readFile(outputFile);
    const fileStats = await stat(outputFile);
    const processingTime = Date.now() - startTime;
    const originalName = file.name.replace(/\.[^/.]+$/, '');

    console.log(`[SpeedRamp] Complete in ${processingTime}ms, output: ${fileStats.size} bytes`);

    // Clean up output file after reading
    try { unlinkSync(outputFile); } catch { /* */ }

    const mimeType = getOutputMimeType(config.outputFormat);
    const outputFilename = `speedramp_${originalName}.${config.outputFormat}`;

    return new NextResponse(outputBuffer, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${outputFilename}"`,
        'Content-Length': String(fileStats.size),
        'X-Processing-Time': String(processingTime),
        'X-Config-Mode': config.mode,
        'X-Config-Reverse': String(config.reverse),
        'X-Config-Fps': String(config.outputFps),
        'X-Config-Crf': String(config.crf),
        'X-Config-Preset': config.preset,
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('[SpeedRamp] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to process video';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ============================================
// GET HANDLER - API Documentation
// ============================================

export async function GET() {
  const apiDocs = {
    endpoint: '/api/speedramp',
    method: 'POST',
    description: 'Process a video with configurable speed ramping. Upload a video file + configuration, receive the processed video as a binary response.',
    contentType: 'multipart/form-data',
    maxFileSize: '500MB',
    maxProcessingTime: '5 minutes',
    parameters: {
      file: {
        type: 'File',
        required: true,
        description: 'Video file to process. Supported formats: MP4, MOV, AVI, WEBM, MKV, FLV, MPEG, 3GP, M4V',
      },
      config: {
        type: 'JSON string',
        required: false,
        description: 'Configuration object as JSON string. See config fields below. If omitted, defaults to V-ramp mode.',
        fields: {
          mode: {
            type: 'string',
            values: VALID_MODES,
            default: DEFAULT_CONFIG.mode,
            description: 'Processing mode. "vramp" = V-shaped reverse speed ramp. "linear" = simple A→B speed ramp. "custom" = user-defined speed curve.',
          },
          trimDuration: {
            type: 'number',
            default: DEFAULT_CONFIG.trimDuration,
            description: 'Duration in seconds of source video to use.',
          },
          trimStart: {
            type: 'number',
            default: DEFAULT_CONFIG.trimStart,
            description: 'Start offset in seconds for trimming.',
          },
          startSpeed: {
            type: 'number',
            default: DEFAULT_CONFIG.startSpeed,
            range: '0.1 - 50',
            description: 'Starting speed multiplier. For "vramp" and "linear" modes.',
          },
          endSpeed: {
            type: 'number',
            default: DEFAULT_CONFIG.endSpeed,
            range: '0.1 - 50',
            description: 'Ending speed multiplier. For "linear" mode.',
          },
          rampMid: {
            type: 'number',
            default: DEFAULT_CONFIG.rampMid,
            range: '0.1 - 50',
            description: 'Mid-point speed for V-ramp mode (bottom of the V).',
          },
          rampEnd: {
            type: 'number',
            default: DEFAULT_CONFIG.rampEnd,
            range: '0.1 - 50',
            description: 'End speed for V-ramp reversed segment.',
          },
          speedPoints: {
            type: 'array of {time, speed}',
            default: '[]',
            description: 'Custom speed curve control points. At least 2 required.',
            example: [
              { time: 0, speed: 4.0 },
              { time: 0.5, speed: 1.0 },
              { time: 1.0, speed: 0.6 },
            ],
          },
          reverse: {
            type: 'boolean',
            default: DEFAULT_CONFIG.reverse,
            description: 'Whether to reverse and concatenate. Creates V-ramp effect.',
          },
          outputFps: {
            type: 'number',
            default: DEFAULT_CONFIG.outputFps,
            range: '1 - 120',
            description: 'Output frame rate. Lower = faster processing.',
          },
          crf: {
            type: 'number',
            default: DEFAULT_CONFIG.crf,
            range: '0 - 51',
            description: 'Quality (CRF). 0=lossless, 18=visually lossless, 23=good, 28=acceptable.',
          },
          preset: {
            type: 'string',
            values: VALID_PRESETS,
            default: DEFAULT_CONFIG.preset,
            description: 'Encoding preset. "ultrafast" = fastest, "veryslow" = best compression.',
          },
          audioMode: {
            type: 'string',
            values: VALID_AUDIO_MODES,
            default: DEFAULT_CONFIG.audioMode,
            description: '"auto" = preserve+adjust, "strip" = remove, "adjust" = match speed.',
          },
          outputFormat: {
            type: 'string',
            values: VALID_FORMATS,
            default: DEFAULT_CONFIG.outputFormat,
            description: 'Output container format.',
          },
          outputScale: {
            type: 'string | null',
            default: DEFAULT_CONFIG.outputScale,
            description: 'Scale resolution. E.g. "1280x720". null = keep original.',
          },
          codec: {
            type: 'string',
            values: VALID_CODECS,
            default: DEFAULT_CONFIG.codec,
            description: 'Video encoder.',
          },
        },
      },
      trimDuration: {
        type: 'string (number)',
        required: false,
        description: 'Shorthand for config.trimDuration.',
      },
    },
    response: {
      success: {
        type: 'binary video file',
        headers: {
          'Content-Type': 'video/mp4 (or video/quicktime, video/webm)',
          'Content-Disposition': 'attachment; filename="speedramp_*.mp4"',
          'X-Processing-Time': 'milliseconds',
        },
      },
      error: {
        type: 'JSON',
        example: { error: 'Error message' },
      },
    },
    examples: {
      vramp: {
        description: 'Default V-ramp: 4x→0.6x→4x',
        curl: `curl -X POST /api/speedramp -F "file=@video.mp4" -F "config={\\"mode\\":\\"vramp\\",\\"trimDuration\\":1.0}"`,
      },
      linear: {
        description: 'Linear 2x→0.5x',
        curl: `curl -X POST /api/speedramp -F "file=@video.mp4" -F "config={\\"mode\\":\\"linear\\",\\"startSpeed\\":2.0,\\"endSpeed\\":0.5}"`,
      },
      custom: {
        description: 'Custom speed curve',
        curl: `curl -X POST /api/speedramp -F "file=@video.mp4" -F "config={\\"mode\\":\\"custom\\",\\"speedPoints\\":[{\\"time\\":0,\\"speed\\":4},{\\"time\\":0.5,\\"speed\\":1},{\\"time\\":1,\\"speed\\":0.6}]}"`,
      },
      simple: {
        description: 'Simplest call',
        curl: `curl -X POST /api/speedramp -F "file=@video.mp4" -F "trimDuration=1.0"`,
      },
      fastProcessing: {
        description: 'Fastest processing (ultrafast + 30fps)',
        curl: `curl -X POST /api/speedramp -F "file=@video.mp4" -F "config={\\"preset\\":\\"ultrafast\\",\\"outputFps\\":30,\\"crf\\":23}"`,
      },
      highQuality: {
        description: 'High quality (CRF 15, medium preset, 60fps)',
        curl: `curl -X POST /api/speedramp -F "file=@video.mp4" -F "config={\\"crf\\":15,\\"preset\\":\\"medium\\",\\"outputFps\\":60}"`,
      },
    },
    processingTips: {
      speed: 'Use "ultrafast" preset, 30fps, and CRF 23 for fastest processing. Avoid "slow"/"veryslow" presets for long videos.',
      quality: 'Use CRF 18, "medium" preset, 60fps for high quality output. Processing will be slower.',
      largeFiles: 'For videos >30 seconds, consider using "ultrafast" preset and lower FPS. The reverse option doubles processing time.',
    },
  };

  return NextResponse.json(apiDocs, {
    status: 200,
    headers: { 'Cache-Control': 'public, max-age=3600' },
  });
}
