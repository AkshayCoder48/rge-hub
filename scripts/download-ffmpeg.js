#!/usr/bin/env node

/**
 * Download static FFmpeg and FFprobe binaries for Vercel serverless functions.
 * This script runs during the Vercel build process.
 * 
 * Downloads from https://johnvansickle.com/ffmpeg/ (static builds)
 * These are well-known, trusted static builds of FFmpeg for Linux.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const FFMPEG_VERSION = '6.1';
const BASE_URL = `https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz`;

const BIN_DIR = path.join(process.cwd(), 'bin');

function download(url) {
  return new Promise((resolve, reject) => {
    const request = (url) => {
      https.get(url, { timeout: 120000 }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          request(response.headers.location);
        } else if (response.statusCode === 200) {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => resolve(Buffer.concat(chunks)));
          response.on('error', reject);
        } else {
          reject(new Error(`Download failed with status ${response.statusCode}`));
        }
      }).on('error', reject);
    };
    request(url);
  });
}

async function main() {
  // Skip if not on Vercel or if ffmpeg already exists
  if (!process.env.VERCEL) {
    console.log('Not on Vercel, skipping ffmpeg download');
    return;
  }

  // Also skip if ffmpeg already exists in /opt/bin (some Vercel configs)
  try {
    execSync('which ffmpeg', { stdio: 'ignore' });
    console.log('ffmpeg already available in PATH, skipping download');
    return;
  } catch {
    // ffmpeg not in PATH, need to download
  }

  console.log('Downloading static FFmpeg binary for Vercel...');

  fs.mkdirSync(BIN_DIR, { recursive: true });

  const tarPath = path.join(BIN_DIR, 'ffmpeg-static.tar.xz');

  try {
    const data = await download(BASE_URL);
    fs.writeFileSync(tarPath, data);
    console.log(`Downloaded ${Math.round(data.length / 1024 / 1024)}MB`);

    // Extract
    console.log('Extracting...');
    execSync(`tar -xf "${tarPath}" -C "${BIN_DIR}" --strip-components=1`, {
      stdio: 'inherit',
    });

    // Make executable
    const ffmpegBin = path.join(BIN_DIR, 'ffmpeg');
    const ffprobeBin = path.join(BIN_DIR, 'ffprobe');

    if (fs.existsSync(ffmpegBin)) {
      fs.chmodSync(ffmpegBin, 0o755);
      console.log(`ffmpeg ready at ${ffmpegBin}`);
    }
    if (fs.existsSync(ffprobeBin)) {
      fs.chmodSync(ffprobeBin, 0o755);
      console.log(`ffprobe ready at ${ffprobeBin}`);
    }

    // Clean up tar
    fs.unlinkSync(tarPath);
    console.log('FFmpeg setup complete!');
  } catch (err) {
    console.error('Failed to download FFmpeg:', err.message);
    console.error('Video processing features will not work on this deployment.');
    // Don't fail the build - the app can still serve the UI
  }
}

main().catch(console.error);
