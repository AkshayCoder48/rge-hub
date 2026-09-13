/**
 * POST /api/analyze
 * Probe a video file for metadata (duration, dimensions, fps, codec, audio).
 *
 * Accepts TWO input shapes (fixes Vercel FUNCTION_PAYLOAD_TOO_LARGE 413):
 *  1. multipart/form-data with "file" — small videos (≤ ~4.5MB per request)
 *  2. application/json { uploadId } — large videos previously sliced to
 *     /api/uploads/chunk; assembled server-side in this same request.
 */
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { spawn } from 'child_process';
import { mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { UPLOADS_DIR, TMP_DIR, getFfmpegPath, getFfprobePath, hasFfprobe } from '@/lib/paths';
import { assembleChunks } from '@/lib/chunks';

export const maxDuration = 60;

// Probe video using ffprobe (available on Docker/Render/local) or ffmpeg (Vercel fallback)
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
      const audioStream = streams.find((s: Record<string, unknown>) => s.codec_type === 'audio');
      const vs = streams.find((s: Record<string, unknown>) => s.codec_type === 'video');

      let duration = 0;
      if (info.format?.duration) duration = parseFloat(info.format.duration);
      else if (vs?.duration) duration = parseFloat(vs.duration as string);

      const width = vs?.width || 0;
      const height = vs?.height || 0;
      let fps = 0;
      if (vs?.r_frame_rate) {
        const parts = (vs.r_frame_rate as string).split('/');
        if (parts.length === 2 && parseInt(parts[1]) !== 0) fps = Math.round(parseInt(parts[0]) / parseInt(parts[1]));
      }
      const codec = (vs?.codec_name as string) || 'unknown';
      const bitrate = info.format?.bit_rate ? parseInt(info.format.bit_rate as string) : 0;
      const formatName = (info.format?.format_name as string) || 'unknown';
      const fileSize = info.format?.size ? parseInt(info.format.size as string) : 0;

      return {
        hasAudio: !!audioStream,
        audioCodec: audioStream?.codec_name as string || null,
        duration,
        width,
        height,
        fps,
        codec,
        bitrate,
        format: formatName,
        fileSize,
      };
    } catch (err) {
      console.warn('ffprobe failed, trying ffmpeg probe:', err);
    }
  }

  // Fallback: Use ffmpeg itself to probe (works on Vercel)
  try {
    const ffmpegPath = getFfmpegPath();
    const result = await new Promise<string>((resolve, reject) => {
      const proc = spawn(ffmpegPath, ['-i', filePath, '-hide_banner']);
      let stderr = '';
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      proc.on('close', () => resolve(stderr)); // code 1 expected (no output specified)
      proc.on('error', (err) => reject(err));
    });

    // Parse ffmpeg stderr
    let duration = 0, width = 0, height = 0, fps = 0;
    let codec = 'unknown', bitrate = 0, hasAudio = false, audioCodec: string | null = null;

    const durMatch = result.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
    if (durMatch) duration = parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 + parseFloat(durMatch[3]);

    const videoMatch = result.match(/Stream\s*#\d+:\d+[\w()]*:\s*Video:\s*(\w+)[,\s].*?(\d+)x(\d+)/);
    if (videoMatch) {
      codec = videoMatch[1];
      width = parseInt(videoMatch[2]);
      height = parseInt(videoMatch[3]);
    }

    const fpsMatch = result.match(/(\d+)\s*(fps|tbr)\b/);
    if (fpsMatch) fps = parseInt(fpsMatch[1]);

    const audioMatch = result.match(/Stream\s*#\d+:\d+[\w()]*:\s*Audio:\s*(\w+)/);
    if (audioMatch) { hasAudio = true; audioCodec = audioMatch[1]; }

    const bitrateMatch = result.match(/bitrate:\s*(\d+)\s*kb\/s/i);
    if (bitrateMatch) bitrate = parseInt(bitrateMatch[1]) * 1000;

    return { hasAudio, audioCodec, duration, width, height, fps, codec, bitrate, format: 'unknown', fileSize: 0 };
  } catch (err) {
    console.error('All probe methods failed:', err);
    throw new Error('Could not analyze video file. FFmpeg is not available or the file is corrupted.');
  }
}

export async function POST(request: Request) {
  try {
    mkdirSync(UPLOADS_DIR, { recursive: true });
    mkdirSync(TMP_DIR, { recursive: true });

    // ---- Input: multipart "file" (small) OR JSON { uploadId } (large) ----
    const contentType = request.headers.get('content-type') || '';
    let fileName = '';
    let fileType = '';
    let buffer: Buffer;

    if (contentType.includes('application/json')) {
      const body = await request.json().catch(() => null);
      const uploadId = body?.uploadId;
      if (!uploadId) {
        return NextResponse.json(
          { error: 'No video file provided. Send multipart "file" or JSON { uploadId }.' },
          { status: 400 }
        );
      }
      const assembled = await assembleChunks(uploadId);
      if (!assembled.ok) {
        return NextResponse.json({ error: assembled.error }, { status: 400 });
      }
      buffer = assembled.bytes;
      fileName = assembled.fileName;
      fileType = assembled.mimeType;
    } else {
      const formData = await request.formData();
      const file = formData.get('file');

      if (!file || !(file instanceof File)) {
        return NextResponse.json({ error: 'No video file provided.' }, { status: 400 });
      }
      fileName = file.name;
      fileType = file.type;
      buffer = Buffer.from(await file.arrayBuffer());
    }

    const validVideoExtensions = ['.mp4', '.mov', '.avi', '.webm', '.mkv', '.flv', '.mpeg', '.3gp', '.m4v'];
    const fileExt = path.extname(fileName).toLowerCase();
    const isVideoType = fileType.startsWith('video/');
    const isOctetStream = fileType === 'application/octet-stream';
    const hasValidExt = validVideoExtensions.includes(fileExt);

    if (!isVideoType && !isOctetStream && !hasValidExt) {
      return NextResponse.json({ error: `Invalid file type: ${fileType}` }, { status: 400 });
    }

    // Real ceiling (checked AFTER assembly, so chunked uploads work).
    const isVercel = !!process.env.VERCEL;
    const maxFileSize = isVercel ? 50 * 1024 * 1024 : 500 * 1024 * 1024;
    const fileSizeMB = Math.round(buffer.length / 1024 / 1024);

    if (buffer.length > maxFileSize) {
      return NextResponse.json({
        error: isVercel
          ? `File too large (${fileSizeMB}MB). Maximum on Vercel is 50MB. For larger videos, deploy on Render or Docker.`
          : `File too large (${fileSizeMB}MB). Maximum is 500MB.`,
      }, { status: 400 });
    }

    const id = uuidv4();
    const ext = fileExt || '.mp4';
    const filePath = path.join(TMP_DIR, `${id}_analyze${ext}`);

    writeFileSync(filePath, buffer);

    try {
      const probe = await probeVideo(filePath);
      try { unlinkSync(filePath); } catch { /* */ }

      return NextResponse.json({
        id,
        fileName: `${id}${ext}`,
        originalName: fileName,
        duration: Math.round(probe.duration * 1000) / 1000,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        codec: probe.codec,
        bitrate: probe.bitrate,
        format: probe.format,
        fileSize: probe.fileSize || buffer.length,
        url: `/api/download?id=${id}`,
        hasAudio: probe.hasAudio,
        audioCodec: probe.audioCodec,
      }, { status: 200 });
    } catch (probeError) {
      try { unlinkSync(filePath); } catch { /* */ }

      const errorMsg = probeError instanceof Error ? probeError.message : 'Could not analyze video file.';
      console.error('Probe error:', probeError);
      return NextResponse.json({
        error: errorMsg,
        hint: isVercel ? 'On Vercel Hobby, FFmpeg may not be available. Deploy on Render or Docker for reliable video processing.' : undefined,
      }, { status: 500 });
    }
  } catch (error) {
    console.error('Analyze error:', error);
    const message = error instanceof Error ? error.message : 'Failed to analyze video';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
