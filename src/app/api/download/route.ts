import { NextResponse } from 'next/server';
import { readdir, stat, readFile, access } from 'fs/promises';
import path from 'path';
import { UPLOADS_DIR, PROCESSED_DIR } from '@/lib/paths';

const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.flv': 'video/x-flv',
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg',
  '.3gp': 'video/3gpp',
  '.wmv': 'video/x-ms-wmv',
  '.ts': 'video/mp2t',
  '.m4v': 'video/x-m4v',
};

async function findFileById(dir: string, id: string): Promise<string | null> {
  try { await access(dir); } catch { return null; }
  const files = await readdir(dir);
  const match = files.find((f) => f.startsWith(id) && f.includes('.'));
  return match ? path.join(dir, match) : null;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: '"id" query parameter is required' }, { status: 400 });
    }

    // Search in uploads first, then processed
    let filePath: string | null = await findFileById(UPLOADS_DIR, id);
    if (!filePath) {
      filePath = await findFileById(PROCESSED_DIR, id);
    }

    if (!filePath) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    let fileStat;
    try { fileStat = await stat(filePath); } catch {
      return NextResponse.json({ error: 'File not found on disk' }, { status: 404 });
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const fileName = path.basename(filePath);
    const fileBuffer = await readFile(filePath);

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': fileStat.size.toString(),
        'Content-Disposition': `inline; filename="${fileName}"`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Download error:', error);
    const message = error instanceof Error ? error.message : 'Failed to download file';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
