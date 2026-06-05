/**
 * Video Processor - Auto Speed Ramping Service
 * 
 * Socket.io + Express server running on port 3003.
 * Handles video upload, processing, and export using FFmpeg.
 */

import express from "express";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { v4 as uuidv4 } from "uuid";
import multer from "multer";
import path from "path";
import fs from "fs";

import { getVideoInfo, trimClip, processClipWithSpeedRamp, generateThumbnail } from "./lib/ffmpeg";
import { extractVideosFromZip, createZipFromFiles, isVideoFile } from "./lib/zip-handler";

const PORT = 3003;

// Directories
const UPLOADS_DIR = path.resolve(__dirname, "uploads");
const PROCESSED_DIR = path.resolve(__dirname, "processed");

// Ensure directories exist
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(PROCESSED_DIR)) fs.mkdirSync(PROCESSED_DIR, { recursive: true });

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".mp4";
    const uniqueName = `${uuidv4()}${ext}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max
  },
});

// Express app
const app = express();

// Parse JSON bodies
app.use(express.json());

// Serve static files
app.use("/uploads", express.static(UPLOADS_DIR));
app.use("/processed", express.static(PROCESSED_DIR));

// CORS middleware for API routes
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (_req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// HTTP server
const httpServer = createServer(app);

// Socket.io server with CORS
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["*"],
    credentials: false,
  },
});

// ==================== Socket.io Connection ====================

io.on("connection", (socket) => {
  console.log(`[Socket.io] Client connected: ${socket.id}`);

  socket.on("disconnect", () => {
    console.log(`[Socket.io] Client disconnected: ${socket.id}`);
  });

  socket.on("join-clip", (clipId: string) => {
    socket.join(`clip-${clipId}`);
    console.log(`[Socket.io] Client ${socket.id} joined room for clip: ${clipId}`);
  });

  socket.on("leave-clip", (clipId: string) => {
    socket.leave(`clip-${clipId}`);
    console.log(`[Socket.io] Client ${socket.id} left room for clip: ${clipId}`);
  });
});

// ==================== API Routes ====================

/**
 * POST /api/upload - Upload a single video file
 */
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file as Express.Multer.File | undefined;

    if (!file) {
      return res.status(400).json({ error: "No file provided" });
    }

    // Validate it's a video file
    const originalName = file.originalname;
    if (!isVideoFile(originalName)) {
      // Remove non-video file
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(400).json({ error: "File is not a video" });
    }

    const filePath = file.path;
    const fileName = file.filename;

    // Get video info using ffprobe
    let videoInfo;
    try {
      videoInfo = await getVideoInfo(filePath);
    } catch (err: any) {
      // Clean up the file if probe fails
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.status(400).json({ error: `Invalid video file: ${err.message}` });
    }

    // Validate duration (0.5 - 2.0 seconds)
    if (videoInfo.duration < 0.5 || videoInfo.duration > 2.0) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.status(400).json({
        error: `Video duration (${videoInfo.duration.toFixed(2)}s) must be between 0.5 and 2.0 seconds`,
      });
    }

    // The clipId is the filename without extension
    const clipId = path.basename(fileName, path.extname(fileName));

    console.log(`[Upload] ${originalName} -> ${fileName} (${videoInfo.duration}s)`);

    res.json({
      id: clipId,
      fileName,
      filePath,
      duration: videoInfo.duration,
      width: videoInfo.width,
      height: videoInfo.height,
      fps: videoInfo.fps,
      bitrate: videoInfo.bitrate,
      codec: videoInfo.codec,
      originalName,
      fileSize: file.size,
      mimeType: videoInfo.mimeType,
    });
  } catch (err: any) {
    console.error("[Upload] Error:", err);
    res.status(500).json({ error: `Upload failed: ${err.message}` });
  }
});

/**
 * POST /api/upload-zip - Upload a ZIP file with multiple video clips
 */
app.post("/api/upload-zip", upload.single("file"), async (req, res) => {
  try {
    const file = req.file as Express.Multer.File | undefined;

    if (!file) {
      return res.status(400).json({ error: "No file provided" });
    }

    const zipPath = file.path;
    const batchId = path.basename(file.filename, path.extname(file.filename));

    // Extract videos from ZIP
    const extractedVideos = await extractVideosFromZip(zipPath, UPLOADS_DIR);

    // Validate each video
    const validClips: any[] = [];
    const skippedFiles: string[] = [];

    for (const video of extractedVideos) {
      try {
        const videoInfo = await getVideoInfo(video.filePath);

        // Validate duration
        if (videoInfo.duration < 0.5 || videoInfo.duration > 2.0) {
          skippedFiles.push(`${video.originalName} (duration: ${videoInfo.duration.toFixed(2)}s)`);
          // Remove invalid file
          if (fs.existsSync(video.filePath)) fs.unlinkSync(video.filePath);
          continue;
        }

        const clipId = path.basename(video.filePath, path.extname(video.filePath));

        validClips.push({
          id: clipId,
          fileName: video.fileName,
          filePath: video.filePath,
          duration: videoInfo.duration,
          width: videoInfo.width,
          height: videoInfo.height,
          fps: videoInfo.fps,
          bitrate: videoInfo.bitrate,
          codec: videoInfo.codec,
          originalName: video.originalName,
          fileSize: video.size,
          mimeType: videoInfo.mimeType,
        });
      } catch (err: any) {
        skippedFiles.push(`${video.originalName} (error: ${err.message})`);
        // Remove invalid file
        if (fs.existsSync(video.filePath)) fs.unlinkSync(video.filePath);
      }
    }

    // Clean up ZIP file
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

    console.log(`[Upload-ZIP] Batch ${batchId}: ${validClips.length} valid clips, ${skippedFiles.length} skipped`);

    res.json({
      batchId,
      clips: validClips,
      skipped: skippedFiles,
    });
  } catch (err: any) {
    console.error("[Upload-ZIP] Error:", err);
    res.status(500).json({ error: `ZIP upload failed: ${err.message}` });
  }
});

/**
 * POST /api/trim - Trim a clip to the selected 1-second portion
 */
app.post("/api/trim", async (req, res) => {
  try {
    const { clipId, filePath, trimStart, trimEnd } = req.body;

    if (!clipId || !filePath || trimStart === undefined || trimEnd === undefined) {
      return res.status(400).json({ error: "Missing required fields: clipId, filePath, trimStart, trimEnd" });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Source file not found" });
    }

    const outputPath = path.join(UPLOADS_DIR, `trimmed_${clipId}.mp4`);

    const result = await trimClip(filePath, outputPath, trimStart, trimEnd);

    console.log(`[Trim] ${clipId}: ${trimStart}s - ${trimEnd}s -> ${outputPath}`);

    res.json({
      trimmedPath: result.outputPath,
      duration: result.duration,
    });
  } catch (err: any) {
    console.error("[Trim] Error:", err);
    res.status(500).json({ error: `Trim failed: ${err.message}` });
  }
});

/**
 * POST /api/process - Process a trimmed clip with speed ramping
 */
app.post("/api/process", async (req, res) => {
  try {
    const { clipId, filePath, duration, socketId } = req.body;

    if (!clipId || !filePath || !duration) {
      return res.status(400).json({ error: "Missing required fields: clipId, filePath, duration" });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Source file not found" });
    }

    // Emit status
    if (socketId) {
      io.to(socketId).emit("status", {
        clipId,
        status: "started",
        message: "Processing started",
      });
    }

    // Process clip with speed ramping
    const result = await processClipWithSpeedRamp(
      filePath,
      clipId,
      duration,
      PROCESSED_DIR,
      socketId,
      io
    );

    // Emit completion
    if (socketId) {
      io.to(socketId).emit("complete", {
        clipId,
        outputPath: result.outputPath,
      });
    }

    console.log(`[Process] ${clipId}: Complete -> ${result.outputPath} (${result.outputDuration}s)`);

    res.json({
      outputPath: result.outputPath,
      outputDuration: result.outputDuration,
    });
  } catch (err: any) {
    console.error("[Process] Error:", err);

    // Emit error
    const { clipId, socketId } = req.body;
    if (socketId && clipId) {
      io.to(socketId).emit("error", {
        clipId,
        error: err.message,
      });
    }

    res.status(500).json({ error: `Processing failed: ${err.message}` });
  }
});

/**
 * GET /api/video-info/:clipId - Get video metadata
 */
app.get("/api/video-info/:clipId", async (req, res) => {
  try {
    const { clipId } = req.params;

    // Try to find the file in uploads directory
    const possibleExtensions = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"];
    let filePath: string | null = null;

    // First check for trimmed version
    const trimmedPath = path.join(UPLOADS_DIR, `trimmed_${clipId}.mp4`);
    if (fs.existsSync(trimmedPath)) {
      filePath = trimmedPath;
    }

    // Then check for original with various extensions
    if (!filePath) {
      for (const ext of possibleExtensions) {
        const testPath = path.join(UPLOADS_DIR, `${clipId}${ext}`);
        if (fs.existsSync(testPath)) {
          filePath = testPath;
          break;
        }
      }
    }

    // Also check processed directory
    if (!filePath) {
      const processedPath = path.join(PROCESSED_DIR, `${clipId}_final.mp4`);
      if (fs.existsSync(processedPath)) {
        filePath = processedPath;
      }
    }

    if (!filePath) {
      return res.status(404).json({ error: "Video file not found" });
    }

    const videoInfo = await getVideoInfo(filePath);

    res.json({
      clipId,
      filePath,
      ...videoInfo,
    });
  } catch (err: any) {
    console.error("[Video-Info] Error:", err);
    res.status(500).json({ error: `Failed to get video info: ${err.message}` });
  }
});

/**
 * POST /api/export-zip - Export multiple processed clips as ZIP
 */
app.post("/api/export-zip", async (req, res) => {
  try {
    const { clipIds } = req.body;

    if (!clipIds || !Array.isArray(clipIds) || clipIds.length === 0) {
      return res.status(400).json({ error: "Missing or empty clipIds array" });
    }

    const filePaths: string[] = [];
    const missingClips: string[] = [];

    for (const clipId of clipIds) {
      const processedPath = path.join(PROCESSED_DIR, `${clipId}_final.mp4`);
      if (fs.existsSync(processedPath)) {
        filePaths.push(processedPath);
      } else {
        missingClips.push(clipId);
      }
    }

    if (filePaths.length === 0) {
      return res.status(404).json({ error: "No processed clips found", missingClips });
    }

    const zipId = uuidv4();
    const zipPath = path.join(PROCESSED_DIR, `export_${zipId}.zip`);

    await createZipFromFiles(filePaths, zipPath);

    console.log(`[Export-ZIP] Created export with ${filePaths.length} clips, ${missingClips.length} missing`);

    // Send the ZIP file as download
    res.download(zipPath, `speed-ramp-export-${zipId}.zip`, (err) => {
      if (err) {
        console.error("[Export-ZIP] Download error:", err);
      }
      // Clean up ZIP file after download
      try {
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      } catch {
        // Ignore cleanup errors
      }
    });
  } catch (err: any) {
    console.error("[Export-ZIP] Error:", err);
    res.status(500).json({ error: `Export failed: ${err.message}` });
  }
});

/**
 * GET /api/thumbnail/:clipId - Generate and return a video thumbnail
 */
app.get("/api/thumbnail/:clipId", async (req, res) => {
  try {
    const { clipId } = req.params;

    // Check if thumbnail already exists
    const thumbPath = path.join(PROCESSED_DIR, `${clipId}_thumb.jpg`);
    if (fs.existsSync(thumbPath)) {
      return res.sendFile(thumbPath);
    }

    // Find the source video
    const possibleExtensions = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"];
    let filePath: string | null = null;

    // Check uploads directory
    for (const ext of possibleExtensions) {
      const testPath = path.join(UPLOADS_DIR, `${clipId}${ext}`);
      if (fs.existsSync(testPath)) {
        filePath = testPath;
        break;
      }
    }

    // Check for trimmed version
    if (!filePath) {
      const trimmedPath = path.join(UPLOADS_DIR, `trimmed_${clipId}.mp4`);
      if (fs.existsSync(trimmedPath)) {
        filePath = trimmedPath;
      }
    }

    if (!filePath) {
      return res.status(404).json({ error: "Video file not found for thumbnail" });
    }

    await generateThumbnail(filePath, thumbPath, 0.1);

    res.sendFile(thumbPath);
  } catch (err: any) {
    console.error("[Thumbnail] Error:", err);
    res.status(500).json({ error: `Thumbnail generation failed: ${err.message}` });
  }
});

// ==================== Start Server ====================

httpServer.listen(PORT, () => {
  console.log(`[Video Processor] Server running on port ${PORT}`);
  console.log(`[Video Processor] Uploads dir: ${UPLOADS_DIR}`);
  console.log(`[Video Processor] Processed dir: ${PROCESSED_DIR}`);
});

export { app, io, httpServer };
