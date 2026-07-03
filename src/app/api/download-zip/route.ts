import { NextResponse } from 'next/server';
import { readdir, access, readFile, stat, mkdir } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const execFileAsync = promisify(execFile);

const PROCESSED_DIR = '/home/z/my-project/processed';
const UPLOADS_DIR = '/home/z/my-project/uploads';
const TMP_DIR = '/home/z/my-project/tmp';

async function findFileById(dir: string, id: string): Promise<string | null> {
  try { await access(dir); } catch { return null; }
  const files = await readdir(dir);
  const match = files.find((f) => f.startsWith(id) && f.includes('.'));
  return match ? path.join(dir, match) : null;
}

function extractOriginalName(filePath: string, id: string): string {
  const basename = path.basename(filePath);
  if (basename.startsWith(id)) {
    return `clip_${id.slice(0, 8)}${path.extname(filePath)}`;
  }
  return basename;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { ids } = body as { ids?: string[] };

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'ids array is required and must not be empty' }, { status: 400 });
    }

    // Resolve each ID to a file path in PROCESSED_DIR (or UPLOADS_DIR as fallback)
    const fileEntries: { filePath: string; nameInZip: string }[] = [];
    const missingIds: string[] = [];

    for (const id of ids) {
      let filePath = await findFileById(PROCESSED_DIR, id);
      if (!filePath) {
        filePath = await findFileById(UPLOADS_DIR, id);
      }
      if (filePath) {
        const originalName = extractOriginalName(filePath, id);
        fileEntries.push({ filePath, nameInZip: originalName });
      } else {
        missingIds.push(id);
      }
    }

    if (fileEntries.length === 0) {
      return NextResponse.json(
        { error: 'No files found for the provided IDs', missingIds },
        { status: 404 }
      );
    }

    // Ensure tmp dir exists
    try { await access(TMP_DIR); } catch { await mkdir(TMP_DIR, { recursive: true }); }

    // Create ZIP using the system `zip` command (reliable, no ESM issues)
    const zipId = uuidv4();
    const zipPath = path.join(TMP_DIR, `${zipId}.zip`);

    // Build the zip command arguments
    // -j = junk paths (store only filenames, no directory paths)
    // -q = quiet mode
    const args = ['-j', '-q', zipPath];
    for (const entry of fileEntries) {
      args.push(entry.filePath);
    }

    await execFileAsync('zip', args);

    // Read the ZIP file and return it
    const zipBuffer = await readFile(zipPath);
    const zipStat = await stat(zipPath);

    // Clean up the temp ZIP file
    try {
      const { unlink } = await import('fs/promises');
      await unlink(zipPath);
    } catch { /* ignore */ }

    console.log(`[Download-ZIP] Created ZIP with ${fileEntries.length} files (${zipStat.size} bytes)`);

    return new NextResponse(zipBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="video-clips.zip"',
        'Content-Length': zipStat.size.toString(),
      },
    });
  } catch (error) {
    console.error('[Download-ZIP] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to create ZIP';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
