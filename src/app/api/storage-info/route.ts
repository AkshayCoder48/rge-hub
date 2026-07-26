import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { UPLOADS_DIR, PROCESSED_DIR } from '@/lib/paths';

function getDirectoryStats(dirPath: string): { size: number; count: number } {
  let totalSize = 0;
  let count = 0;

  try {
    const entries = fs.readdirSync(dirPath);
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          totalSize += stat.size;
          count++;
        }
      } catch {
        // Skip files that can't be stat'd
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return { size: totalSize, count };
}

export async function GET() {
  const uploadsStats = getDirectoryStats(UPLOADS_DIR);
  const processedStats = getDirectoryStats(PROCESSED_DIR);

  return NextResponse.json({
    uploadsSize: uploadsStats.size,
    processedSize: processedStats.size,
    uploadCount: uploadsStats.count,
    processedCount: processedStats.count,
    totalSize: uploadsStats.size + processedStats.size,
  });
}
