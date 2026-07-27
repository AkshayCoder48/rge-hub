import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { UPLOADS_DIR, TMP_DIR, getFfprobePath } from '@/lib/paths';

export const maxDuration = 60;

async function probeVideo(filePath: string) {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  const { stdout } = await execFileAsync(getFfprobePath(), [
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
    if (parts.length === 2 && parseInt(parts[1]) > 0) fps = Math.round(parseInt(parts[0]) / parseInt(parts[1]));
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
}

export async function POST(request: Request) {
  try {
    mkdirSync(UPLOADS_DIR, { recursive: true });
    mkdirSync(TMP_DIR, { recursive: true });

    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'No video file provided.' }, { status: 400 });
    }

    const validVideoExtensions = ['.mp4', '.mov', '.avi', '.webm', '.mkv', '.flv', '.mpeg', '.3gp', '.m4v'];
    const fileExt = path.extname(file.name).toLowerCase();
    const isVideoType = file.type.startsWith('video/');
    const isOctetStream = file.type === 'application/octet-stream';
    const hasValidExt = validVideoExtensions.includes(fileExt);

    if (!isVideoType && !isOctetStream && !hasValidExt) {
      return NextResponse.json({ error: `Invalid file type: ${file.type}` }, { status: 400 });
    }

    const id = uuidv4();
    const ext = fileExt || '.mp4';
    const filePath = path.join(TMP_DIR, `${id}_analyze${ext}`);

    // Write file synchronously to ensure it's fully written before probing
    const buffer = Buffer.from(await file.arrayBuffer());
    writeFileSync(filePath, buffer);

    try {
      const probe = await probeVideo(filePath);

      // Clean up the file after analysis
      try { unlinkSync(filePath); } catch { /* */ }

      return NextResponse.json({
        id,
        fileName: `${id}${ext}`,
        originalName: file.name,
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
      // Clean up on probe failure too
      try { unlinkSync(filePath); } catch { /* */ }

      console.error('Probe error:', probeError);
      return NextResponse.json({
        error: 'Could not analyze video file. It may be corrupted or in an unsupported format.',
      }, { status: 500 });
    }
  } catch (error) {
    console.error('Analyze error:', error);
    const message = error instanceof Error ? error.message : 'Failed to analyze video';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
