import { NextRequest, NextResponse } from 'next/server';
import { existsSync } from 'fs';
import path from 'path';
import { trimClip } from '@/lib/ffmpeg';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { clipId, filePath, trimStart, trimEnd } = body;

    if (!clipId || !filePath || trimStart === undefined || trimEnd === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: clipId, filePath, trimStart, trimEnd' },
        { status: 400 }
      );
    }

    if (!existsSync(filePath)) {
      return NextResponse.json({ error: 'Source file not found' }, { status: 404 });
    }

    const outputPath = path.join(UPLOADS_DIR, `trimmed_${clipId}.mp4`);
    const result = await trimClip(filePath, outputPath, trimStart, trimEnd);

    console.log(`[Trim] ${clipId}: ${trimStart}s - ${trimEnd}s -> ${outputPath}`);

    return NextResponse.json({
      trimmedPath: result.outputPath,
      duration: result.duration,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Trim failed';
    console.error('[Trim] Error:', err);
    return NextResponse.json({ error: `Trim failed: ${message}` }, { status: 500 });
  }
}
