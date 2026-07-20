import { NextResponse } from 'next/server';
import { ffmpeg } from '@/lib/ffmpeg-config';
import { writeFile } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { UPLOADS_DIR, ensureDirs } from '@/lib/paths';

export async function POST(request: Request) {
  try {
    ensureDirs();
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
    const ext = path.extname(file.name) || '.mp4';
    const fileName = `${id}${ext}`;

    const filePath = path.join(UPLOADS_DIR, fileName);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    const probeData = await new Promise<ffmpeg.FfprobeData>((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    const videoStream = probeData.streams.find((s) => s.codec_type === 'video');
    const audioStream = probeData.streams.find((s) => s.codec_type === 'audio');
    const formatInfo = probeData.format;

    const duration = parseFloat(String(formatInfo.duration || '0'));
    const width = videoStream?.width || 0;
    const height = videoStream?.height || 0;

    let fps = 0;
    if (videoStream) {
      const rFrameRate = videoStream.r_frame_rate;
      if (rFrameRate) {
        const parts = rFrameRate.split('/');
        if (parts.length === 2 && parseInt(parts[1]) !== 0) {
          fps = Math.round((parseInt(parts[0]) / parseInt(parts[1])) * 100) / 100;
        }
      }
    }

    const codec = videoStream?.codec_name || 'unknown';
    const bitrate = formatInfo.bit_rate ? parseInt(String(formatInfo.bit_rate)) : 0;
    const formatName = formatInfo.format_name || 'unknown';
    const fileSize = parseInt(String(formatInfo.size || '0'));

    return NextResponse.json({
      id,
      fileName,
      originalName: file.name,
      duration: Math.round(duration * 1000) / 1000,
      width,
      height,
      fps,
      codec,
      bitrate,
      format: formatName,
      fileSize,
      url: `/api/download?id=${id}`,
      hasAudio: !!audioStream,
      audioCodec: audioStream?.codec_name || null,
    }, { status: 200 });
  } catch (error) {
    console.error('Analyze error:', error);
    const message = error instanceof Error ? error.message : 'Failed to analyze video';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
