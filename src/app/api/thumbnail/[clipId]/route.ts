import { NextRequest, NextResponse } from 'next/server';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { generateThumbnail } from '@/lib/ffmpeg';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const PROCESSED_DIR = path.join(process.cwd(), 'processed');

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clipId: string }> }
) {
  try {
    const { clipId } = await params;

    if (!existsSync(PROCESSED_DIR)) {
      mkdirSync(PROCESSED_DIR, { recursive: true });
    }

    // Check if thumbnail already exists
    const thumbPath = path.join(PROCESSED_DIR, `${clipId}_thumb.jpg`);
    if (existsSync(thumbPath)) {
      const { readFile } = await import('fs/promises');
      const thumbBuffer = await readFile(thumbPath);
      return new NextResponse(thumbBuffer, {
        headers: { 'Content-Type': 'image/jpeg' },
      });
    }

    // Find the source video
    const possibleExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'];
    let filePath: string | null = null;

    for (const ext of possibleExtensions) {
      const testPath = path.join(UPLOADS_DIR, `${clipId}${ext}`);
      if (existsSync(testPath)) {
        filePath = testPath;
        break;
      }
    }

    if (!filePath) {
      const trimmedPath = path.join(UPLOADS_DIR, `trimmed_${clipId}.mp4`);
      if (existsSync(trimmedPath)) {
        filePath = trimmedPath;
      }
    }

    if (!filePath) {
      return NextResponse.json({ error: 'Video file not found for thumbnail' }, { status: 404 });
    }

    await generateThumbnail(filePath, thumbPath, 0.1);

    const { readFile } = await import('fs/promises');
    const thumbBuffer = await readFile(thumbPath);
    return new NextResponse(thumbBuffer, {
      headers: { 'Content-Type': 'image/jpeg' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Thumbnail generation failed';
    console.error('[Thumbnail] Error:', err);
    return NextResponse.json({ error: `Thumbnail generation failed: ${message}` }, { status: 500 });
  }
}
