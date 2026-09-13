/**
 * FFmpeg Processing Functions
 * 
 * Provides functions for video manipulation using FFmpeg:
 * - Metadata extraction (ffprobe)
 * - Clip trimming
 * - Speed ramping with smooth transitions
 * - Video reversal
 * - Clip concatenation
 * - Thumbnail generation
 */

import { execFile, spawn } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import {
  generateSetptsExpression,
  generateReverseSetptsExpression,
} from "./speed-ramp";

const execFileAsync = promisify(execFile);

export interface VideoInfo {
  duration: number;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  codec: string;
  mimeType: string;
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
 * Get video metadata using ffprobe
 */
export async function getVideoInfo(filePath: string): Promise<VideoInfo> {
  const { stdout } = await execFileAsync("ffprobe", [
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
  };
}

/**
 * Run an FFmpeg command and return a promise
 */
function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args);

    let stderrOutput = "";
    proc.stderr.on("data", (data: Buffer) => {
      stderrOutput += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}: ${stderrOutput}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`FFmpeg process error: ${err.message}`));
    });
  });
}

/**
 * Run an FFmpeg command with progress tracking via Socket.io
 */
function runFFmpegWithProgress(
  args: string[],
  duration: number,
  socketId?: string,
  io?: any,
  clipId?: string,
  step?: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args);

    let stderrOutput = "";
    proc.stderr.on("data", (data: Buffer) => {
      const output = data.toString();
      stderrOutput += output;

      // Parse FFmpeg progress
      if (io && socketId && clipId) {
        const timeMatch = output.match(/time=(\d+:\d+:\d+\.\d+)/);
        if (timeMatch) {
          const parts = timeMatch[1].split(":");
          const currentTime =
            parseInt(parts[0]) * 3600 +
            parseInt(parts[1]) * 60 +
            parseFloat(parts[2]);
          const progress = Math.min(
            100,
            Math.max(0, (currentTime / duration) * 100)
          );
          io.to(socketId).emit("progress", {
            clipId,
            step: step || "processing",
            progress: Math.round(progress),
            message: `Processing: ${Math.round(progress)}%`,
          });
        }
      }
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}: ${stderrOutput}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`FFmpeg process error: ${err.message}`));
    });
  });
}

/**
 * Trim a clip to the selected time range
 */
export async function trimClip(
  inputPath: string,
  outputPath: string,
  startTime: number,
  endTime: number
): Promise<TrimResult> {
  const duration = endTime - startTime;

  await runFFmpeg([
    "-y",
    "-i",
    inputPath,
    "-ss",
    startTime.toString(),
    "-to",
    endTime.toString(),
    "-c:v",
    "libx264",
    "-crf",
    "18",
    "-preset",
    "slow",
    "-an",
    "-fps_mode",
    "cfr",
    outputPath,
  ]);

  return {
    outputPath,
    duration,
  };
}

/**
 * Create a speed-ramped clip with smooth transition
 * 
 * @param inputPath - Path to input video
 * @param outputPath - Path for output video
 * @param duration - Input clip duration in seconds
 * @param startSpeed - Starting speed multiplier
 * @param endSpeed - Ending speed multiplier
 * @param socketId - Optional Socket.io socket ID for progress
 * @param io - Optional Socket.io instance
 * @param clipId - Optional clip ID for progress events
 */
export async function createSpeedRampedClip(
  inputPath: string,
  outputPath: string,
  duration: number,
  startSpeed: number,
  endSpeed: number,
  socketId?: string,
  io?: any,
  clipId?: string
): Promise<void> {
  const setptsExpr = generateSetptsExpression(startSpeed, endSpeed, duration);

  const args = [
    "-y",
    "-i",
    inputPath,
    "-vf",
    `setpts=${setptsExpr}`,
    "-an",
    "-fps_mode",
    "cfr",
    "-c:v",
    "libx264",
    "-crf",
    "18",
    "-preset",
    "slow",
    outputPath,
  ];

  if (io && socketId && clipId) {
    const outputDuration = (duration / (endSpeed - startSpeed)) * Math.log(endSpeed / startSpeed);
    await runFFmpegWithProgress(
      args,
      outputDuration,
      socketId,
      io,
      clipId,
      `speed-ramp-${startSpeed}x-to-${endSpeed}x`
    );
  } else {
    await runFFmpeg(args);
  }
}

/**
 * Create a reverse speed-ramped clip
 * (high speed → low speed, like 4.0x → 0.6x)
 */
export async function createReverseSpeedRampedClip(
  inputPath: string,
  outputPath: string,
  duration: number,
  startSpeed: number,
  endSpeed: number,
  socketId?: string,
  io?: any,
  clipId?: string
): Promise<void> {
  const setptsExpr = generateReverseSetptsExpression(startSpeed, endSpeed, duration);

  const args = [
    "-y",
    "-i",
    inputPath,
    "-vf",
    `setpts=${setptsExpr}`,
    "-an",
    "-fps_mode",
    "cfr",
    "-c:v",
    "libx264",
    "-crf",
    "18",
    "-preset",
    "slow",
    outputPath,
  ];

  if (io && socketId && clipId) {
    const outputDuration = (duration / (endSpeed - startSpeed)) * Math.log(endSpeed / startSpeed);
    await runFFmpegWithProgress(
      args,
      outputDuration,
      socketId,
      io,
      clipId,
      `reverse-ramp-${endSpeed}x-to-${startSpeed}x`
    );
  } else {
    await runFFmpeg(args);
  }
}

/**
 * Reverse a video clip (play backwards)
 */
export async function reverseClip(
  inputPath: string,
  outputPath: string
): Promise<void> {
  await runFFmpeg([
    "-y",
    "-i",
    inputPath,
    "-vf",
    "reverse",
    "-an",
    "-c:v",
    "libx264",
    "-crf",
    "18",
    "-preset",
    "slow",
    outputPath,
  ]);
}

/**
 * Concatenate multiple video clips using FFmpeg concat demuxer
 */
export async function concatClips(
  clipPaths: string[],
  outputPath: string
): Promise<void> {
  if (clipPaths.length === 0) {
    throw new Error("No clips to concatenate");
  }

  if (clipPaths.length === 1) {
    // Just copy the single file
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
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c",
      "copy",
      outputPath,
    ]);
  } finally {
    // Clean up the list file
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
    "-i",
    inputPath,
    "-ss",
    time.toString(),
    "-frames:v",
    "1",
    "-q:v",
    "2",
    outputPath,
  ]);

  return outputPath;
}

/**
 * Full processing pipeline: create speed-ramped normal + reverse clip, then concatenate
 */
export async function processClipWithSpeedRamp(
  inputPath: string,
  clipId: string,
  duration: number,
  processedDir: string,
  socketId?: string,
  io?: any
): Promise<ProcessResult> {
  const normalRampPath = path.join(processedDir, `${clipId}_ramp_normal.mp4`);
  const reverseRampPath = path.join(processedDir, `${clipId}_ramp_reverse.mp4`);
  const finalPath = path.join(processedDir, `${clipId}_final.mp4`);

  const startSpeed = 0.6;
  const endSpeed = 4.0;

  // Step 1: Create normal speed ramp (0.6x → 4.0x)
  if (io && socketId) {
    io.to(socketId).emit("status", {
      clipId,
      status: "processing",
      message: "Creating normal speed ramp (0.6x → 4.0x)...",
    });
    io.to(socketId).emit("progress", {
      clipId,
      step: "normal-ramp",
      progress: 0,
      message: "Creating normal speed ramp...",
    });
  }

  await createSpeedRampedClip(
    inputPath,
    normalRampPath,
    duration,
    startSpeed,
    endSpeed,
    socketId,
    io,
    clipId
  );

  if (io && socketId) {
    io.to(socketId).emit("progress", {
      clipId,
      step: "normal-ramp",
      progress: 100,
      message: "Normal speed ramp complete",
    });
  }

  // Step 2: Create reverse speed ramp (4.0x → 0.6x)
  if (io && socketId) {
    io.to(socketId).emit("status", {
      clipId,
      status: "processing",
      message: "Creating reverse speed ramp (4.0x → 0.6x)...",
    });
    io.to(socketId).emit("progress", {
      clipId,
      step: "reverse-ramp",
      progress: 0,
      message: "Creating reverse speed ramp...",
    });
  }

  await createReverseSpeedRampedClip(
    inputPath,
    reverseRampPath,
    duration,
    startSpeed,
    endSpeed,
    socketId,
    io,
    clipId
  );

  if (io && socketId) {
    io.to(socketId).emit("progress", {
      clipId,
      step: "reverse-ramp",
      progress: 100,
      message: "Reverse speed ramp complete",
    });
  }

  // Step 3: Concatenate normal + reverse
  if (io && socketId) {
    io.to(socketId).emit("status", {
      clipId,
      status: "concatenating",
      message: "Concatenating clips...",
    });
    io.to(socketId).emit("progress", {
      clipId,
      step: "concatenate",
      progress: 50,
      message: "Concatenating clips...",
    });
  }

  await concatClips([normalRampPath, reverseRampPath], finalPath);

  if (io && socketId) {
    io.to(socketId).emit("progress", {
      clipId,
      step: "concatenate",
      progress: 100,
      message: "Concatenation complete",
    });
  }

  // Get final duration
  const finalInfo = await getVideoInfo(finalPath);

  // Clean up intermediate files
  try {
    if (fs.existsSync(normalRampPath)) fs.unlinkSync(normalRampPath);
    if (fs.existsSync(reverseRampPath)) fs.unlinkSync(reverseRampPath);
  } catch {
    // Ignore cleanup errors
  }

  return {
    outputPath: finalPath,
    outputDuration: finalInfo.duration,
  };
}
