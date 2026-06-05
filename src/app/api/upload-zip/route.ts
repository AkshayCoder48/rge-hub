import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getVideoInfo } from '@/lib/ffmpeg';
import { extractVideosFromZip, isVideoFile } from '@/lib/zip-handler';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Ensure uploads directory exists
    if (!existsSync(UPLOADS_DIR)) {
      await mkdir(UPLOADS_DIR, { recursive: true });
    }

    // Save ZIP file temporarily
    const zipId = uuidv4();
    const zipPath = path.join(UPLOADS_DIR, `temp_${zipId}.zip`);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(zipPath, buffer);

    const batchId = zipId;

    console.log(`[Upload-ZIP] Extracting clips from ${file.name}...`);

    // Extract videos from ZIP
    const extractedVideos = await extractVideosFromZip(zipPath, UPLOADS_DIR);

    // Clean up ZIP file
    if (existsSync(zipPath)) await unlink(zipPath);

    // Validate each video
    const validClips: Record<string, unknown>[] = [];
    const skippedFiles: string[] = [];

    for (const video of extractedVideos) {
      try {
        const videoInfo = await getVideoInfo(video.filePath);

        if (videoInfo.duration < 0.5 || videoInfo.duration > 2.0) {
          skippedFiles.push(`${video.originalName} (duration: ${videoInfo.duration.toFixed(2)}s)`);
          if (existsSync(video.filePath)) await unlink(video.filePath);
          continue;
        }

        const clipId = path.basename(video.filePath, path.extname(video.filePath));

        validClips.push({
          id: clipId,
          fileName: video.fileName,
          filePath: video.filePath,
          duration: videoInfo.duration,
          width: videoInfo.width,
          height: videoInfo.height,
          fps: videoInfo.fps,
          bitrate: videoInfo.bitrate,
          codec: videoInfo.codec,
          originalName: video.originalName,
          fileSize: video.size,
          mimeType: videoInfo.mimeType,
          hasAudio: videoInfo.hasAudio,
          audioCodec: videoInfo.audioCodec,
          pixelFormat: videoInfo.pixelFormat,
        });

        console.log(`[Upload-ZIP] Extracted: ${video.originalName} (${videoInfo.duration}s, ${videoInfo.codec}, audio: ${videoInfo.hasAudio})`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        skippedFiles.push(`${video.originalName} (error: ${message})`);
        if (existsSync(video.filePath)) await unlink(video.filePath);
      }
    }

    console.log(`[Upload-ZIP] Batch ${batchId}: ${validClips.length} valid clips, ${skippedFiles.length} skipped`);

    return NextResponse.json({
      batchId,
      clips: validClips,
      skipped: skippedFiles,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Upload failed';
    console.error('[Upload-ZIP] Error:', err);
    return NextResponse.json({ error: `ZIP upload failed: ${message}` }, { status: 500 });
  }
}
