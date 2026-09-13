/**
 * FFmpeg Processing Functions - Ultra-Fast Pipeline
 * 
 * Optimized for 1-2 second clip processing with:
 * - Combined trim + speed ramp (input seeking, no separate trim step)
 * - Parallel forward + reverse clip processing
 * - Visually lossless quality (CRF 17)
 * - Audio stripped (speed ramping incompatible with original timing)
 * - Codec detection for best quality preservation
 */

import { execFile, spawn } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import {
  generateSetptsExpression,
  generateReverseSetptsExpression,
} from "./speed-ramp";
import { getFfmpegPath, getFfprobePath } from "./paths";

const execFileAsync = promisify(execFile);

export interface VideoInfo {
  duration: number;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  codec: string;
  mimeType: string;
  hasAudio: boolean;
  audioCodec: string;
  pixelFormat: string;
}

export interface TrimResult {
  outputPath: string;
  duration: number;
}

export interface ProcessResult {
  outputPath: string;
  outputDuration: number;
}

/**
 * Get video metadata using ffprobe (enhanced with audio/pixel info)
 */
export async function getVideoInfo(filePath: string): Promise<VideoInfo> {
  const { stdout } = await execFileAsync(getFfprobePath(), [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);

  const data = JSON.parse(stdout);

  const videoStream = data.streams?.find(
    (s: any) => s.codec_type === "video"
  );
  if (!videoStream) {
    throw new Error("No video stream found in file");
  }

  const audioStream = data.streams?.find(
    (s: any) => s.codec_type === "audio"
  );

  const duration = parseFloat(data.format?.duration || videoStream.duration || "0");
  const width = videoStream.width || 0;
  const height = videoStream.height || 0;

  // Parse FPS from r_frame_rate (e.g., "30/1")
  let fps = 30;
  if (videoStream.r_frame_rate) {
    const parts = videoStream.r_frame_rate.split("/");
    if (parts.length === 2 && parseInt(parts[1]) !== 0) {
      fps = parseInt(parts[0]) / parseInt(parts[1]);
    }
  }

  const bitrate = parseInt(data.format?.bit_rate || "0");
  const codec = videoStream.codec_name || "unknown";
  const pixelFormat = videoStream.pix_fmt || "yuv420p";

  // Determine MIME type
  let mimeType = "video/mp4";
  const formatName = data.format?.format_name || "";
  if (formatName.includes("mov")) {
    mimeType = "video/quicktime";
  } else if (formatName.includes("webm")) {
    mimeType = "video/webm";
  } else if (formatName.includes("avi")) {
    mimeType = "video/x-msvideo";
  } else if (formatName.includes("mkv") || formatName.includes("matroska")) {
    mimeType = "video/x-matroska";
  }

  return {
    duration,
    width,
    height,
    fps,
    bitrate,
    codec,
    mimeType,
    hasAudio: !!audioStream,
    audioCodec: audioStream?.codec_name || "",
    pixelFormat,
  };
}

/**
 * Run an FFmpeg command and return a promise
 */
function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(getFfmpegPath(), args);

    let stderrOutput = "";
    proc.stderr.on("data", (data: Buffer) => {
      stderrOutput += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}: ${stderrOutput.slice(-500)}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`FFmpeg process error: ${err.message}`));
    });
  });
}

/**
 * Trim a clip to the selected time range using fast input seeking
 * Uses stream copy for maximum speed when no re-encoding is needed
 */
export async function trimClip(
  inputPath: string,
  outputPath: string,
  startTime: number,
  endTime: number
): Promise<TrimResult> {
  const duration = endTime - startTime;

  // Fast trim using input seeking + stream copy
  // -ss before -i = fast seeking (no re-encoding before seek point)
  await runFFmpeg([
    "-y",
    "-ss", startTime.toString(),
    "-to", endTime.toString(),
    "-i", inputPath,
    "-c", "copy",
    "-avoid_negative_ts", "make_zero",
    outputPath,
  ]);

  return {
    outputPath,
    duration,
  };
}

/**
 * Concatenate multiple video clips using FFmpeg concat demuxer
 * Uses stream copy for maximum speed
 */
export async function concatClips(
  clipPaths: string[],
  outputPath: string
): Promise<void> {
  if (clipPaths.length === 0) {
    throw new Error("No clips to concatenate");
  }

  if (clipPaths.length === 1) {
    fs.copyFileSync(clipPaths[0], outputPath);
    return;
  }

  // Create concat list file
  const listPath = outputPath + ".concat.txt";
  const listContent = clipPaths
    .map((p) => `file '${p}'`)
    .join("\n");

  fs.writeFileSync(listPath, listContent);

  try {
    await runFFmpeg([
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listPath,
      "-c", "copy",
      outputPath,
    ]);
  } finally {
    if (fs.existsSync(listPath)) {
      fs.unlinkSync(listPath);
    }
  }
}

/**
 * Generate a thumbnail from a video at a specific time
 */
export async function generateThumbnail(
  inputPath: string,
  outputPath: string,
  time: number = 0.1
): Promise<string> {
  await runFFmpeg([
    "-y",
    "-ss", time.toString(),
    "-i", inputPath,
    "-frames:v", "1",
    "-q:v", "2",
    outputPath,
  ]);

  return outputPath;
}

/**
 * Get optimal video codec based on source
 */
function getOptimalCodec(sourceCodec: string): { encoder: string; args: string[] } {
  // Match source codec for best quality preservation
  switch (sourceCodec) {
    case "hevc":
    case "h265":
      return { encoder: "libx265", args: ["-c:v", "libx265", "-tag:v", "hvc1"] };
    case "vp9":
      return { encoder: "libvpx-vp9", args: ["-c:v", "libvpx-vp9"] };
    case "av1":
      return { encoder: "libaom-av1", args: ["-c:v", "libaom-av1"] };
    default:
      // H.264 is the most compatible and fastest to encode
      return { encoder: "libx264", args: ["-c:v", "libx264"] };
  }
}

/**
 * ULTRA-FAST processing pipeline:
 * 
 * Key optimizations:
 * 1. Combined trim + speed ramp using input seeking (-ss before -i)
 * 2. PARALLEL processing of forward and reverse clips
 * 3. ultrafast preset + tune zerolatency for maximum speed
 * 4. CRF 17 for visually lossless quality (no perceptible degradation)
 * 5. Audio stripped (speed ramping changes video timing)
 * 6. Codec matching (uses same codec family as source)
 * 7. Pixel format matching
 * 
 * Pipeline:
 * - Step 1 (parallel): Forward speed ramp (4x→0.6x) + Reverse speed ramp (0.6x→4x)
 * - Step 2: Concatenate using stream copy
 */
export async function processClipWithSpeedRamp(
  inputPath: string,
  clipId: string,
  duration: number,
  processedDir: string,
  trimStart: number = 0,
  trimEnd?: number,
  preset?: 'quality' | 'fast' | 'turbo',
  sourceCodec: string = "h264",
  hasAudio: boolean = false,
  pixelFormat: string = "yuv420p",
  minSpeed: number = 0.6,
  maxSpeed: number = 4.0,
  preserveAudio: boolean = false
): Promise<ProcessResult> {
  const actualTrimEnd = trimEnd ?? duration;
  const trimDuration = actualTrimEnd - trimStart;

  // Determine FFmpeg settings based on preset
  let ffmpegPreset: string;
  let ffmpegCrf: string;
  let tuneArgs: string[];

  switch (preset) {
    case 'quality':
      ffmpegPreset = 'medium';
      ffmpegCrf = '15'; // Near-lossless
      tuneArgs = [];
      break;
    case 'turbo':
    case 'fast':
      ffmpegPreset = 'ultrafast';
      ffmpegCrf = '17'; // Visually lossless - no perceptible quality loss
      tuneArgs = ['-tune', 'zerolatency'];
      break;
    default:
      // Default to turbo for 1-2s processing
      ffmpegPreset = 'ultrafast';
      ffmpegCrf = '17'; // Visually lossless - no perceptible quality loss
      tuneArgs = ['-tune', 'zerolatency'];
  }

  const codecInfo = getOptimalCodec(sourceCodec);
  const forwardRampPath = path.join(processedDir, `${clipId}_ramp_forward.mp4`);
  const reverseRampPath = path.join(processedDir, `${clipId}_ramp_reverse.mp4`);
  const finalPath = path.join(processedDir, `${clipId}_final.mp4`);

  // Generate setpts expressions
  const forwardSetptsExpr = generateReverseSetptsExpression(minSpeed, maxSpeed, trimDuration);
  const reverseSetptsExpr = generateSetptsExpression(minSpeed, maxSpeed, trimDuration);

  // Audio args - always strip audio for speed ramping
  // Speed ramping changes video timing, so audio can't be simply preserved
  // The output video will be silent (consistent with the speed ramp effect)
  const audioArgs = ["-an"];

  // Pixel format args - match source
  const pixelArgs = pixelFormat !== "yuv420p" ? ["-pix_fmt", pixelFormat] : [];

  // Input seeking args for instant trim (-ss before -i = no decode before seek)
  // Always include -ss when we need trimming (even -ss 0 ensures -to works correctly)
  const needsTrim = trimStart > 0 || actualTrimEnd < duration;
  const seekArgs = needsTrim
    ? ["-ss", trimStart.toString(), "-to", actualTrimEnd.toString()]
    : [];

  console.log(`[Process] ${clipId}: Starting TURBO pipeline [preset=${ffmpegPreset}, crf=${ffmpegCrf}] (parallel forward+reverse)`);

  const startTime = Date.now();

  // PARALLEL PROCESSING: Run forward and reverse simultaneously
  // Forward clip: apply speed ramp directly (decelerating 4x→0.6x)
  const forwardArgs = [
    "-y",
    ...seekArgs,
    "-i", inputPath,
    "-vf", `setpts=${forwardSetptsExpr}`,
    ...codecInfo.args,
    "-crf", ffmpegCrf,
    "-preset", ffmpegPreset,
    ...tuneArgs,
    ...pixelArgs,
    ...audioArgs,
    "-fps_mode", "cfr",
    "-movflags", "+faststart",
    forwardRampPath,
  ];

  // CRITICAL FIX: Reverse clip needs TWO passes.
  // After `reverse`, PTS values are in decreasing order (D→0), which causes
  // setpts expressions to produce non-monotonic output PTS, making the video
  // appear frozen/paused. Solution: reverse to temp file first, then apply
  // speed ramp to the reversed file with correct PTS order.
  const reversedTempPath = path.join(processedDir, `${clipId}_reversed_temp.mp4`);

  const reverseStep1Args = [
    "-y",
    ...seekArgs,
    "-i", inputPath,
    "-vf", "reverse",
    ...codecInfo.args,
    "-crf", ffmpegCrf,
    "-preset", ffmpegPreset,
    ...tuneArgs,
    ...pixelArgs,
    ...audioArgs,
    "-fps_mode", "cfr",
    "-movflags", "+faststart",
    reversedTempPath,
  ];

  const reverseStep2Args = [
    "-y",
    "-i", reversedTempPath,
    "-vf", `setpts=${reverseSetptsExpr}`,
    ...codecInfo.args,
    "-crf", ffmpegCrf,
    "-preset", ffmpegPreset,
    ...tuneArgs,
    ...pixelArgs,
    ...audioArgs,
    "-fps_mode", "cfr",
    "-movflags", "+faststart",
    reverseRampPath,
  ];

  // Execute forward clip + reverse step 1 in parallel
  await Promise.all([
    runFFmpeg(forwardArgs),
    runFFmpeg(reverseStep1Args),
  ]);

  // Then apply speed ramp to the reversed clip (must be sequential after reverse)
  await runFFmpeg(reverseStep2Args);

  const rampTime = Date.now() - startTime;
  console.log(`[Process] ${clipId}: Speed ramps complete in ${(rampTime / 1000).toFixed(1)}s`);

  // Step 2: Concatenate using stream copy (fastest possible)
  await concatClips([forwardRampPath, reverseRampPath], finalPath);

  const totalTime = Date.now() - startTime;
  console.log(`[Process] ${clipId}: TOTAL pipeline complete in ${(totalTime / 1000).toFixed(1)}s -> ${finalPath}`);

  // Get final duration
  const finalInfo = await getVideoInfo(finalPath);

  // When preserveAudio is true, add a silent audio track for compatibility
  // This ensures the output file has an audio stream (even if silent),
  // which is better than no audio at all for player compatibility
  if (preserveAudio) {
    const withAudioPath = finalPath.replace('.mp4', '_audio.mp4');
    try {
      await runFFmpeg([
        "-y",
        "-i", finalPath,
        "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "128k",
        "-shortest",
        "-movflags", "+faststart",
        withAudioPath,
      ]);

      // Replace original with audio version
      fs.renameSync(withAudioPath, finalPath);
      console.log(`[Process] ${clipId}: Added silent audio track for compatibility`);
    } catch (audioErr) {
      console.warn(`[Process] ${clipId}: Failed to add silent audio track, keeping video-only output:`, audioErr);
      // Clean up partial file if it exists
      if (fs.existsSync(withAudioPath)) {
        try { fs.unlinkSync(withAudioPath); } catch { /* ignore */ }
      }
    }
  }

  // Clean up intermediate files
  try {
    if (fs.existsSync(forwardRampPath)) fs.unlinkSync(forwardRampPath);
    if (fs.existsSync(reverseRampPath)) fs.unlinkSync(reverseRampPath);
    if (fs.existsSync(reversedTempPath)) fs.unlinkSync(reversedTempPath);
  } catch {
    // Ignore cleanup errors
  }

  return {
    outputPath: finalPath,
    outputDuration: finalInfo.duration,
  };
}
