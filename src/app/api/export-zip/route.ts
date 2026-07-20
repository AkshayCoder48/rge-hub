import { NextRequest, NextResponse } from 'next/server';
import { existsSync } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createZipFromFiles } from '@/lib/zip-handler';
import { PROCESSED_DIR, ensureDirs } from '@/lib/paths';

interface ClipExportInfo {
  clipId: string;
  originalName: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { clipIds, clipNames } = body as {
      clipIds?: string[];
      clipNames?: Record<string, string>;
    };

    if (!clipIds || !Array.isArray(clipIds) || clipIds.length === 0) {
      return NextResponse.json({ error: 'Missing or empty clipIds array' }, { status: 400 });
    }

    ensureDirs();

    const fileEntries: { filePath: string; nameInZip: string }[] = [];
    const missingClips: string[] = [];

    for (let i = 0; i < clipIds.length; i++) {
      const clipId = clipIds[i];
      const processedPath = path.join(PROCESSED_DIR, `${clipId}_final.mp4`);
      if (existsSync(processedPath)) {
        // Use the original name if provided, otherwise use a numbered name
        const originalName = clipNames?.[clipId] || `clip_${i + 1}`;
        const baseName = originalName.replace(/\.[^/.]+$/, '');
        const nameInZip = `speedramp_${baseName}.mp4`;
        fileEntries.push({ filePath: processedPath, nameInZip });
      } else {
        missingClips.push(clipId);
      }
    }

    if (fileEntries.length === 0) {
      return NextResponse.json({ error: 'No processed clips found', missingClips }, { status: 404 });
    }

    const zipId = uuidv4();
    const zipPath = path.join(PROCESSED_DIR, `export_${zipId}.zip`);

    await createZipFromFiles(fileEntries, zipPath);

    console.log(`[Export-ZIP] Created export with ${fileEntries.length} clips`);

    // Read the ZIP file and return as download
    const { readFile, unlink } = await import('fs/promises');
    const zipBuffer = await readFile(zipPath);

    // Clean up ZIP file
    try {
      if (existsSync(zipPath)) await unlink(zipPath);
    } catch {
      // Ignore cleanup errors
    }

    return new NextResponse(zipBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="speed-ramp-export-${zipId}.zip"`,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Export failed';
    console.error('[Export-ZIP] Error:', err);
    return NextResponse.json({ error: `Export failed: ${message}` }, { status: 500 });
  }
}
