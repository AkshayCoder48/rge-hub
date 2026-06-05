import { NextRequest, NextResponse } from 'next/server';
import { existsSync } from 'fs';
import path from 'path';
import { getVideoInfo } from '@/lib/ffmpeg';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const PROCESSED_DIR = path.join(process.cwd(), 'processed');

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clipId: string }> }
) {
  try {
    const { clipId } = await params;
    const possibleExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'];
    let filePath: string | null = null;

    const trimmedPath = path.join(UPLOADS_DIR, `trimmed_${clipId}.mp4`);
    if (existsSync(trimmedPath)) {
      filePath = trimmedPath;
    }

    if (!filePath) {
      for (const ext of possibleExtensions) {
        const testPath = path.join(UPLOADS_DIR, `${clipId}${ext}`);
        if (existsSync(testPath)) {
          filePath = testPath;
          break;
        }
      }
    }

    if (!filePath) {
      const processedPath = path.join(PROCESSED_DIR, `${clipId}_final.mp4`);
      if (existsSync(processedPath)) {
        filePath = processedPath;
      }
    }

    if (!filePath) {
      return NextResponse.json({ error: 'Video file not found' }, { status: 404 });
    }

    const videoInfo = await getVideoInfo(filePath);

    return NextResponse.json({
      clipId,
      filePath,
      ...videoInfo,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to get video info';
    return NextResponse.json({ error: `Failed to get video info: ${message}` }, { status: 500 });
  }
}
