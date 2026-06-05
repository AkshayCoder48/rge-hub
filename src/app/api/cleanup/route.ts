import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

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

    const projectRoot = process.cwd();
    let totalDeleted = 0;
    let totalFreed = 0;

    if (type === 'processed') {
      const processedDir = path.join(projectRoot, 'processed');
      const result = deleteFilesInDirectory(processedDir);
      totalDeleted += result.deletedCount;
      totalFreed += result.freedSpace;
    } else if (type === 'all') {
      const uploadsDir = path.join(projectRoot, 'uploads');
      const processedDir = path.join(projectRoot, 'processed');

      const uploadsResult = deleteFilesInDirectory(uploadsDir);
      const processedResult = deleteFilesInDirectory(processedDir);

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
