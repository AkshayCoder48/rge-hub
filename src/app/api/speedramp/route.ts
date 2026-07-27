import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { spawn } from 'child_process';
import { mkdirSync, unlinkSync, writeFileSync, existsSync } from 'fs';
import { readFile, stat } from 'fs/promises';
import { UPLOADS_DIR, PROCESSED_DIR, TMP_DIR, getFfmpegPath, getFfprobePath } from '@/lib/paths';

// ============================================
// SPEED RAMP API - Full Parameter Configuration
// ============================================
//
// POST /api/speedramp
// Accepts: FormData with "file" + "config" (JSON string)
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
//   outputFps:      number (default: 60)
//   crf:            number (quality 0-51, default: 18)
//   preset:         "ultrafast"|"fast"|"medium"|"slow" (default: "fast")
//   audioMode:      "auto"|"strip"|"adjust" (default: "auto")
//   outputFormat:   "mp4"|"mov"|"webm" (default: "mp4")
//   outputScale:    string e.g. "1280x720" or null (default: null = keep original)
//   codec:          "libx264"|"libx265"|"libvpx-vp9" (default: "libx264")
//
// GET /api/speedramp
// Returns: API documentation and parameter schema
// ============================================

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
  outputFps: 60,
  crf: 18,
  preset: 'fast',
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

function runFFmpeg(args: string[], timeoutMs = 600000): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpegPath = getFfmpegPath();
    const proc = spawn(ffmpegPath, args);

    let stderrOutput = '';
    proc.stderr.on('data', (data: Buffer) => { stderrOutput += data.toString(); });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`FFmpeg timed out after ${timeoutMs / 1000}s`));
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
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    const { stdout } = await execFileAsync(getFfprobePath(), [
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
    console.warn('ffprobe failed, using defaults:', err);
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
  if (Math.abs(deltaS < 0.001)) return `PTS/${s0.toFixed(6)}`;
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
    // Merge with defaults, validate each field
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
// MAIN PROCESSING LOGIC
// ============================================

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

  // Determine if audio should be handled
  const shouldHandleAudio = config.audioMode !== 'strip' && probe.hasAudio;

  // Build video filter chain
  function buildVideoFilters(setptsExpr: string, scale?: string | null): string[] {
    const vf: string[] = [`setpts=${setptsExpr}`];
    if (scale) {
      vf.push(`scale=${scale}`);
    }
    vf.push('format=yuv420p');
    return vf;
  }

  // Build common output args
  function buildOutputArgs(hasAudio: boolean, audioFilter?: string): string[] {
    const args = [
      '-movflags', '+faststart',
      '-r', String(config.outputFps),
      '-c:v', config.codec,
      '-crf', String(config.crf),
      '-preset', config.preset,
    ];

    if (config.codec === 'libx265') {
      args.push('-tag:v', 'hvc1');
    }

    if (hasAudio && audioFilter) {
      args.push('-af', audioFilter, '-c:a', 'aac', '-b:a', '128k');
    } else if (hasAudio) {
      args.push('-c:a', 'aac', '-b:a', '128k');
    } else {
      args.push('-an');
    }

    return args;
  }

  // Trim the input video
  const trimmedFile = path.join(TMP_DIR, `${jobId}_trimmed.mp4`);
  console.log(`Trimming: ${trimStart}s → ${trimStart + effectiveTrimDuration}s`);

  await runFFmpeg([
    '-y',
    '-ss', String(trimStart),
    '-i', inputPath,
    '-t', String(effectiveTrimDuration),
    '-movflags', '+faststart',
    '-pix_fmt', 'yuv420p',
    '-c:v', config.codec,
    '-crf', String(config.crf),
    '-preset', config.preset,
    ...(shouldHandleAudio ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an']),
    trimmedFile,
  ]);

  const outputExt = config.outputFormat === 'mp4' ? '.mp4'
    : config.outputFormat === 'mov' ? '.mov' : '.webm';

  if (config.mode === 'vramp') {
    // ---- V-RAMP MODE ----
    // Forward: startSpeed → rampMid (decelerate)
    // Reversed: rampMid → rampEnd (accelerate)
    // Concatenated into a V-shaped speed ramp

    const forwardFile = path.join(TMP_DIR, `${jobId}_forward${outputExt}`);
    const reversedRawFile = path.join(TMP_DIR, `${jobId}_reversed_raw${outputExt}`);
    const reversedFile = path.join(TMP_DIR, `${jobId}_reversed${outputExt}`);
    const concatListPath = path.join(TMP_DIR, `${jobId}_concat.txt`);
    const concatFile = path.join(TMP_DIR, `${jobId}_concat${outputExt}`);
    const outputFile = path.join(TMP_DIR, `${jobId}_output${outputExt}`);

    // Forward setpts: startSpeed → rampMid
    const forwardSetpts = buildContinuousSetpts(config.startSpeed, config.rampMid, effectiveTrimDuration);
    const forwardOutputDur = computeRampOutputDuration(config.startSpeed, config.rampMid, effectiveTrimDuration);
    const forwardAudioSpeed = effectiveTrimDuration / forwardOutputDur;
    const forwardAudioFilter = buildAtempoChain(forwardAudioSpeed);

    console.log(`V-Ramp forward: ${config.startSpeed}x → ${config.rampMid}x over ${effectiveTrimDuration}s`);

    // Step 1: Forward ramp
    await runFFmpeg([
      '-y', '-i', trimmedFile,
      '-vf', buildVideoFilters(forwardSetpts, config.outputScale).join(','),
      ...buildOutputArgs(shouldHandleAudio, forwardAudioFilter),
      forwardFile,
    ]);

    if (config.reverse) {
      // Step 2: Reverse trimmed segment
      console.log('Reversing trimmed segment');
      await runFFmpeg([
        '-y', '-i', trimmedFile,
        '-vf', 'reverse,format=yuv420p',
        ...(shouldHandleAudio ? ['-af', 'areverse'] : []),
        '-movflags', '+faststart',
        '-c:v', config.codec,
        '-crf', String(config.crf),
        '-preset', config.preset,
        ...(shouldHandleAudio ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an']),
        reversedRawFile,
      ]);

      // Step 3: Reversed ramp: rampMid → rampEnd
      const reverseSetpts = buildContinuousSetpts(config.rampMid, config.rampEnd, effectiveTrimDuration);
      const reverseOutputDur = computeRampOutputDuration(config.rampMid, config.rampEnd, effectiveTrimDuration);
      const reverseAudioSpeed = effectiveTrimDuration / reverseOutputDur;
      const reverseAudioFilter = buildAtempoChain(reverseAudioSpeed);

      console.log(`V-Ramp reversed: ${config.rampMid}x → ${config.rampEnd}x`);

      await runFFmpeg([
        '-y', '-i', reversedRawFile,
        '-vf', buildVideoFilters(reverseSetpts, config.outputScale).join(','),
        ...buildOutputArgs(shouldHandleAudio, reverseAudioFilter),
        reversedFile,
      ]);

      // Step 4: Concatenate forward + reversed
      console.log('Concatenating forward + reversed');
      writeFileSync(concatListPath, `file '${forwardFile}'\nfile '${reversedFile}'`);

      await runFFmpeg([
        '-y',
        '-f', 'concat', '-safe', '0',
        '-i', concatListPath,
        '-movflags', '+faststart',
        '-pix_fmt', 'yuv420p',
        '-c', 'copy',
        concatFile,
      ]);

      // Copy to final output
      const concatData = await readFile(concatFile);
      writeFileSync(outputFile, concatData);

      // Cleanup intermediates
      for (const f of [trimmedFile, forwardFile, reversedRawFile, reversedFile, concatListPath, concatFile]) {
        try { unlinkSync(f); } catch { /* */ }
      }

      return outputFile;
    } else {
      // No reverse — just return forward ramp
      const outputData = await readFile(forwardFile);
      writeFileSync(outputFile, outputData);
      for (const f of [trimmedFile, forwardFile]) {
        try { unlinkSync(f); } catch { /* */ }
      }
      return outputFile;
    }

  } else if (config.mode === 'linear') {
    // ---- LINEAR MODE ----
    // Simple A→B speed ramp over the trimmed duration

    const setptsExpr = buildContinuousSetpts(config.startSpeed, config.endSpeed, effectiveTrimDuration);
    const outputDur = computeRampOutputDuration(config.startSpeed, config.endSpeed, effectiveTrimDuration);
    const audioSpeed = effectiveTrimDuration / outputDur;
    const audioFilter = shouldHandleAudio ? buildAtempoChain(audioSpeed) : undefined;

    console.log(`Linear ramp: ${config.startSpeed}x → ${config.endSpeed}x over ${effectiveTrimDuration}s`);

    const outputFile = path.join(TMP_DIR, `${jobId}_output${outputExt}`);

    if (config.reverse) {
      // With reverse: apply speed ramp, then reverse the output, then concatenate both
      const rampedFile = path.join(TMP_DIR, `${jobId}_ramped${outputExt}`);
      const reversedFile = path.join(TMP_DIR, `${jobId}_reversed${outputExt}`);
      const concatListPath = path.join(TMP_DIR, `${jobId}_concat.txt`);
      const concatFile = path.join(TMP_DIR, `${jobId}_concat${outputExt}`);

      // Step 1: Apply speed ramp to trimmed video
      await runFFmpeg([
        '-y', '-i', trimmedFile,
        '-vf', buildVideoFilters(setptsExpr, config.outputScale).join(','),
        ...buildOutputArgs(shouldHandleAudio, audioFilter),
        rampedFile,
      ]);

      // Step 2: Reverse the ramped video
      await runFFmpeg([
        '-y', '-i', rampedFile,
        '-vf', 'reverse,format=yuv420p',
        ...(shouldHandleAudio ? ['-af', 'areverse'] : []),
        '-movflags', '+faststart',
        '-c:v', config.codec,
        '-crf', String(config.crf),
        '-preset', config.preset,
        ...(shouldHandleAudio ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an']),
        reversedFile,
      ]);

      // Step 3: Concatenate ramped + reversed
      writeFileSync(concatListPath, `file '${rampedFile}'\nfile '${reversedFile}'`);

      await runFFmpeg([
        '-y', '-f', 'concat', '-safe', '0', '-i', concatListPath,
        '-movflags', '+faststart', '-c', 'copy',
        concatFile,
      ]);

      const data = await readFile(concatFile);
      writeFileSync(outputFile, data);

      for (const f of [trimmedFile, rampedFile, reversedFile, concatListPath, concatFile]) {
        try { unlinkSync(f); } catch { /* */ }
      }
      return outputFile;
    } else {
      // No reverse — just the speed ramp
      await runFFmpeg([
        '-y', '-i', trimmedFile,
        '-vf', buildVideoFilters(setptsExpr, config.outputScale).join(','),
        ...buildOutputArgs(shouldHandleAudio, audioFilter),
        outputFile,
      ]);

      try { unlinkSync(trimmedFile); } catch { /* */ }
      return outputFile;
    }

  } else if (config.mode === 'custom') {
    // ---- CUSTOM MODE ----
    // User provides an array of {time, speed} control points.
    // Each segment between consecutive points gets a linear speed ramp.

    const points = config.speedPoints;
    if (!points || points.length < 2) {
      throw new Error('Custom mode requires at least 2 speedPoints');
    }

    // Sort points by time
    const sorted = [...points].sort((a, b) => a.time - b.time);

    // Process each segment between consecutive control points
    const segmentFiles: string[] = [];
    const segmentListPath = path.join(TMP_DIR, `${jobId}_segments.txt`);
    const outputFile = path.join(TMP_DIR, `${jobId}_output${outputExt}`);

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

      console.log(`Custom segment ${i}: ${p0.speed}x → ${p1.speed}x over ${segDuration.toFixed(2)}s`);

      // Extract segment from trimmed video
      await runFFmpeg([
        '-y',
        '-ss', String(p0.time),
        '-i', trimmedFile,
        '-t', String(segDuration),
        '-vf', buildVideoFilters(setptsExpr, config.outputScale).join(','),
        ...buildOutputArgs(shouldHandleAudio, audioFilter),
        segFile,
      ]);

      segmentFiles.push(segFile);
    }

    // Concatenate all segments
    if (segmentFiles.length === 1) {
      // Only one segment — just rename
      const data = await readFile(segmentFiles[0]);
      writeFileSync(outputFile, data);
      try { unlinkSync(segmentFiles[0]); } catch { /* */ }
    } else {
      writeFileSync(segmentListPath, segmentFiles.map((f) => `file '${f}'`).join('\n'));

      const concatFile = path.join(TMP_DIR, `${jobId}_concat${outputExt}`);
      await runFFmpeg([
        '-y', '-f', 'concat', '-safe', '0', '-i', segmentListPath,
        '-movflags', '+faststart', '-c', 'copy',
        concatFile,
      ]);

      const data = await readFile(concatFile);
      writeFileSync(outputFile, data);

      for (const f of [...segmentFiles, segmentListPath, concatFile]) {
        try { unlinkSync(f); } catch { /* */ }
      }
    }

    // Optionally reverse the whole custom output and concatenate
    if (config.reverse) {
      const reversedFile = path.join(TMP_DIR, `${jobId}_custom_reversed${outputExt}`);
      const finalConcatList = path.join(TMP_DIR, `${jobId}_final_concat.txt`);
      const finalFile = path.join(TMP_DIR, `${jobId}_final${outputExt}`);

      await runFFmpeg([
        '-y', '-i', outputFile,
        '-vf', 'reverse,format=yuv420p',
        ...(shouldHandleAudio ? ['-af', 'areverse'] : []),
        '-movflags', '+faststart',
        '-c:v', config.codec,
        '-crf', String(config.crf),
        '-preset', config.preset,
        ...(shouldHandleAudio ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an']),
        reversedFile,
      ]);

      writeFileSync(finalConcatList, `file '${outputFile}'\nfile '${reversedFile}'`);

      const finalConcatFile = path.join(TMP_DIR, `${jobId}_final_concat${outputExt}`);
      await runFFmpeg([
        '-y', '-f', 'concat', '-safe', '0', '-i', finalConcatList,
        '-movflags', '+faststart', '-c', 'copy',
        finalConcatFile,
      ]);

      // Overwrite outputFile with the concatenated result
      const data = await readFile(finalConcatFile);
      writeFileSync(outputFile, data);

      for (const f of [reversedFile, finalConcatList, finalConcatFile]) {
        try { unlinkSync(f); } catch { /* */ }
      }
    }

    try { unlinkSync(trimmedFile); } catch { /* */ }
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
    for (const dir of [UPLOADS_DIR, PROCESSED_DIR, TMP_DIR]) {
      mkdirSync(dir, { recursive: true });
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const configRaw = formData.get('config') as string | null;
    // Also support individual fields for simple usage
    const trimDurationStr = formData.get('trimDuration') as string | null;

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'No video file provided.' }, { status: 400 });
    }

    // Parse config - supports both JSON config object AND individual fields
    const config = parseConfig(configRaw);
    // If trimDuration was sent as individual field, use it
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

    const jobId = uuidv4();
    const ext = fileExt || '.mp4';
    const inputPath = path.join(TMP_DIR, `${jobId}_input${ext}`);

    // Save uploaded file
    const buffer = Buffer.from(await file.arrayBuffer());
    writeFileSync(inputPath, buffer);

    // Probe video
    const probe = await probeVideo(inputPath);
    console.log(`[SpeedRamp] mode=${config.mode}, trim=${config.trimDuration}s, speeds=${config.startSpeed}x→${config.rampMid}x→${config.rampEnd}x, reverse=${config.reverse}, fps=${config.outputFps}, crf=${config.crf}, preset=${config.preset}, audio=${config.audioMode}, format=${config.outputFormat}`);

    // Process
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
            description: 'Processing mode. "vramp" = V-shaped reverse speed ramp (forward decelerate + reversed accelerate). "linear" = simple A→B speed ramp. "custom" = user-defined speed curve with control points.',
          },
          trimDuration: {
            type: 'number',
            default: DEFAULT_CONFIG.trimDuration,
            description: 'Duration in seconds of source video to use. Clamped to video length.',
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
            description: 'Mid-point speed for V-ramp mode. The bottom of the V.',
          },
          rampEnd: {
            type: 'number',
            default: DEFAULT_CONFIG.rampEnd,
            range: '0.1 - 50',
            description: 'End speed for V-ramp reversed segment. The right peak of the V.',
          },
          speedPoints: {
            type: 'array of {time, speed}',
            default: '[]',
            description: 'Custom speed curve control points. At least 2 points required. Each point has "time" (seconds) and "speed" (multiplier). Used in "custom" mode only.',
            example: [
              { time: 0, speed: 4.0 },
              { time: 0.5, speed: 1.0 },
              { time: 1.0, speed: 0.6 },
              { time: 2.0, speed: 2.0 },
            ],
          },
          reverse: {
            type: 'boolean',
            default: DEFAULT_CONFIG.reverse,
            description: 'Whether to reverse the processed video and concatenate it. Creates the V-ramp effect when true.',
          },
          outputFps: {
            type: 'number',
            default: DEFAULT_CONFIG.outputFps,
            range: '1 - 120',
            description: 'Output video frame rate. Higher values = smoother but larger files.',
          },
          crf: {
            type: 'number',
            default: DEFAULT_CONFIG.crf,
            range: '0 - 51',
            description: 'Constant Rate Factor (quality). Lower = better quality. 0 = lossless, 18 = visually lossless, 28 = acceptable, 51 = worst.',
          },
          preset: {
            type: 'string',
            values: VALID_PRESETS,
            default: DEFAULT_CONFIG.preset,
            description: 'Encoding speed preset. "ultrafast" = fastest encode, worst compression. "veryslow" = slowest encode, best compression.',
          },
          audioMode: {
            type: 'string',
            values: VALID_AUDIO_MODES,
            default: DEFAULT_CONFIG.audioMode,
            description: '"auto" = preserve audio with speed adjustment. "strip" = remove audio. "adjust" = adjust audio speed to match video.',
          },
          outputFormat: {
            type: 'string',
            values: VALID_FORMATS,
            default: DEFAULT_CONFIG.outputFormat,
            description: 'Output video container format.',
          },
          outputScale: {
            type: 'string | null',
            default: DEFAULT_CONFIG.outputScale,
            description: 'Scale output to specific resolution. E.g. "1280x720". null = keep original resolution.',
            example: '1280x720',
          },
          codec: {
            type: 'string',
            values: VALID_CODECS,
            default: DEFAULT_CONFIG.codec,
            description: 'Video encoder. libx264 = most compatible, libx265 = HEVC better compression, libvpx-vp9 = VP9 for WebM.',
          },
        },
      },
      trimDuration: {
        type: 'string (number)',
        required: false,
        description: 'Shorthand for config.trimDuration. If both this and config.trimDuration are provided, this takes precedence.',
      },
    },
    response: {
      success: {
        type: 'binary video file',
        headers: {
          'Content-Type': 'video/mp4 (or video/quicktime, video/webm)',
          'Content-Disposition': 'attachment; filename="speedramp_*.mp4"',
          'X-Processing-Time': 'milliseconds',
          'X-Config-Mode': 'vramp | linear | custom',
          'X-Config-Reverse': 'true | false',
        },
      },
      error: {
        type: 'JSON',
        example: { error: 'Error message describing what went wrong' },
      },
    },
    examples: {
      vramp: {
        description: 'Default V-ramp: 4x→0.6x→4x reverse speed ramp',
        curl: `curl -X POST /api/speedramp -F "file=@video.mp4" -F "config={\\"mode\\":\\"vramp\\",\\"trimDuration\\":1.0}"`,
        formData: { file: 'video.mp4', config: { mode: 'vramp', trimDuration: 1.0 } },
      },
      linear: {
        description: 'Simple linear speed ramp from 2x to 0.5x',
        curl: `curl -X POST /api/speedramp -F "file=@video.mp4" -F "config={\\"mode\\":\\"linear\\",\\"startSpeed\\":2.0,\\"endSpeed\\":0.5}"`,
        formData: { file: 'video.mp4', config: { mode: 'linear', startSpeed: 2.0, endSpeed: 0.5 } },
      },
      custom: {
        description: 'Custom speed curve with multiple control points',
        curl: `curl -X POST /api/speedramp -F "file=@video.mp4" -F "config={\\"mode\\":\\"custom\\",\\"speedPoints\\":[{\\"time\\":0,\\"speed\\":4},{\\"time\\":0.5,\\"speed\\":1},{\\"time\\":1,\\"speed\\":0.6},{\\"time\\":2,\\"speed\\":2}]}"`,
        formData: { file: 'video.mp4', config: { mode: 'custom', speedPoints: [{ time: 0, speed: 4 }, { time: 0.5, speed: 1 }, { time: 1, speed: 0.6 }, { time: 2, speed: 2 }] } },
      },
      simple: {
        description: 'Simplest call - just file and trimDuration (defaults to V-ramp)',
        curl: `curl -X POST /api/speedramp -F "file=@video.mp4" -F "trimDuration=1.0"`,
      },
      highQuality: {
        description: 'High quality output with CRF 15, medium preset, 30fps',
        curl: `curl -X POST /api/speedramp -F "file=@video.mp4" -F "config={\\"mode\\":\\"vramp\\",\\"crf\\":15,\\"preset\\":\\"medium\\",\\"outputFps\\":30}"`,
      },
      noAudio: {
        description: 'Strip audio from output',
        curl: `curl -X POST /api/speedramp -F "file=@video.mp4" -F "config={\\"mode\\":\\"linear\\",\\"startSpeed\\":2,\\"endSpeed\\":0.5,\\"audioMode\\":\\"strip\\"}"`,
      },
      scaled: {
        description: 'Output at 720p resolution',
        curl: `curl -X POST /api/speedramp -F "file=@video.mp4" -F "config={\\"mode\\":\\"vramp\\",\\"outputScale\\":\\"1280x720\\"}"`,
      },
    },
    math: {
      setptsFormula: 'For linear speed ramp S(t) = s0 + (s1-s0)*(t/D), the FFmpeg setpts expression is: (D/(deltaS*TB))*log(max(0.0001, 1+deltaS*(PTS-STARTPTS)*TB/(s0*D)))',
      outputDurationFormula: 'T_out = (D/(s1-s0)) * ln(1 + (s1-s0)/s0) for linear speed ramp',
    },
  };

  return NextResponse.json(apiDocs, {
    status: 200,
    headers: { 'Cache-Control': 'public, max-age=3600' },
  });
}
