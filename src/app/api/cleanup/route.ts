import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { UPLOADS_DIR, PROCESSED_DIR } from '@/lib/paths';

function deleteFilesInDirectory(dirPath: string): { deletedCount: number; freedSpace: number } {
  let deletedCount = 0;
  let freedSpace = 0;

  try {
    const entries = fs.readdirSync(dirPath);
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          freedSpace += stat.size;
          fs.unlinkSync(fullPath);
          deletedCount++;
        }
      } catch {
        // Skip files that can't be deleted
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return { deletedCount, freedSpace };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { type } = body as { type: 'processed' | 'all' };

    let totalDeleted = 0;
    let totalFreed = 0;

    if (type === 'processed') {
      const result = deleteFilesInDirectory(PROCESSED_DIR);
      totalDeleted += result.deletedCount;
      totalFreed += result.freedSpace;
    } else if (type === 'all') {
      const uploadsResult = deleteFilesInDirectory(UPLOADS_DIR);
      const processedResult = deleteFilesInDirectory(PROCESSED_DIR);

      totalDeleted += uploadsResult.deletedCount + processedResult.deletedCount;
      totalFreed += uploadsResult.freedSpace + processedResult.freedSpace;
    } else {
      return NextResponse.json(
        { error: 'Invalid type. Use "processed" or "all".' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      deletedCount: totalDeleted,
      freedSpace: totalFreed,
    });
  } catch (error) {
    console.error('Cleanup error:', error);
    return NextResponse.json(
      { error: 'Cleanup failed' },
      { status: 500 }
    );
  }
}
