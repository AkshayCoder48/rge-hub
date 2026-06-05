import { NextRequest, NextResponse } from 'next/server';
import { existsSync } from 'fs';
import path from 'path';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string[] }> }
) {
  try {
    const { filename } = await params;
    const filePath = path.join(UPLOADS_DIR, ...filename);

    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(path.resolve(UPLOADS_DIR))) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    if (!existsSync(resolvedPath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const { readFile } = await import('fs/promises');
    const fileBuffer = await readFile(resolvedPath);

    const ext = path.extname(resolvedPath).toLowerCase();
    const contentType: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo',
      '.mkv': 'video/x-matroska',
      '.webm': 'video/webm',
    };

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType[ext] || 'application/octet-stream',
        'Content-Length': fileBuffer.length.toString(),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'File not found';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
