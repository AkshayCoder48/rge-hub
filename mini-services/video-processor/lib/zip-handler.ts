/**
 * ZIP File Handling
 * 
 * Functions for extracting video files from ZIP archives
 * and creating ZIP archives from processed files.
 */

import AdmZip from "adm-zip";
import archiver from "archiver";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

const VIDEO_EXTENSIONS = [
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".webm",
  ".m4v",
  ".mpg",
  ".mpeg",
  ".3gp",
  ".wmv",
  ".flv",
];

export interface ExtractedVideo {
  fileName: string;
  filePath: string;
  originalName: string;
  size: number;
}

/**
 * Check if a file extension is a video file
 */
export function isVideoFile(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return VIDEO_EXTENSIONS.includes(ext);
}

/**
 * Extract video files from a ZIP archive
 * 
 * @param zipPath - Path to the ZIP file
 * @param outputDir - Directory to extract files to
 * @returns Array of extracted video file info
 */
export async function extractVideosFromZip(
  zipPath: string,
  outputDir: string
): Promise<ExtractedVideo[]> {
  const extractedVideos: ExtractedVideo[] = [];

  if (!fs.existsSync(zipPath)) {
    throw new Error(`ZIP file not found: ${zipPath}`);
  }

  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();

  for (const entry of entries) {
    if (entry.isDirectory) continue;

    const entryName = entry.entryName;
    const baseName = path.basename(entryName);

    // Skip hidden files and macOS metadata
    if (baseName.startsWith(".") || baseName.startsWith("__MACOSX")) {
      continue;
    }

    if (!isVideoFile(baseName)) {
      console.log(`[ZIP] Skipping non-video file: ${baseName}`);
      continue;
    }

    // Generate unique filename to avoid conflicts
    const ext = path.extname(baseName);
    const uniqueName = `${uuidv4()}${ext}`;
    const outputPath = path.join(outputDir, uniqueName);

    // Extract the file
    const content = entry.getData();
    fs.writeFileSync(outputPath, content);

    extractedVideos.push({
      fileName: uniqueName,
      filePath: outputPath,
      originalName: baseName,
      size: content.length,
    });

    console.log(`[ZIP] Extracted video: ${baseName} -> ${uniqueName}`);
  }

  return extractedVideos;
}

/**
 * Create a ZIP archive from a list of files
 * 
 * @param filePaths - Array of file paths to include
 * @param outputPath - Path for the output ZIP file
 * @returns Path to the created ZIP file
 */
export async function createZipFromFiles(
  filePaths: string[],
  outputPath: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver("zip", {
      zlib: { level: 9 }, // Maximum compression
    });

    output.on("close", () => {
      console.log(
        `[ZIP] Created archive: ${outputPath} (${archive.pointer()} bytes)`
      );
      resolve(outputPath);
    });

    archive.on("error", (err: Error) => {
      reject(err);
    });

    archive.pipe(output);

    for (const filePath of filePaths) {
      if (!fs.existsSync(filePath)) {
        console.warn(`[ZIP] File not found, skipping: ${filePath}`);
        continue;
      }
      const fileName = path.basename(filePath);
      archive.file(filePath, { name: fileName });
    }

    archive.finalize();
  });
}
