# Reverse Speed Ramp — V-Shaped Video Speed Control

A Next.js web application that transforms ordinary videos into dramatic **reverse speed ramp clips** — the signature V-shaped speed effect popular in action cinematography, sports reels, and social media content.

> **Forward**: 4x → 0.6x (fast to slow — decelerate)
> **Reversed**: 0.6x → 4x (slow to fast — accelerate)
> **Combined**: One seamless V-ramp clip

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-38B2AC?logo=tailwindcss)
![FFmpeg](https://img.shields.io/badge/FFmpeg-Powered-green?logo=ffmpeg)

---

## Features

- **3 Speed Ramp Modes**:
  - **V-Ramp** — V-shaped decelerate-then-accelerate (4x→0.6x→4x), the classic reverse speed ramp
  - **Linear** — Simple A→B speed transition (e.g. 4x→0.6x)
  - **Custom** — User-defined speed curve with arbitrary control points

- **Video Processing**:
  - FFmpeg-powered server-side processing with continuous speed interpolation
  - Supports MP4, MOV, AVI, WebM, MKV input formats
  - Output formats: MP4 (H.264), MOV, WebM (VP9)
  - Adjustable quality (CRF 0–51), FPS (1–120), encoding presets (ultrafast→veryslow)
  - Audio handling: auto-preserve + adjust, strip, or match speed

- **Full API Access**:
  - REST API with 15+ configurable parameters
  - `GET /api/speedramp` returns complete API documentation
  - `POST /api/speedramp` processes videos and returns binary output
  - `POST /api/analyze` probes video metadata

- **Batch Processing**:
  - Upload multiple videos simultaneously
  - Process all clips at once with progress tracking
  - Download all processed clips in sequence

- **Polished UI**:
  - Dark theme with orange/cyan gradient accents
  - Interactive V-ramp visualization with SVG speed graph
  - Video preview with play/pause, mute, fullscreen, original/processed toggle
  - Configurable trim duration with preset shortcuts
  - Real-time processing progress bar
  - Toast notifications for upload/process status

---

## Quick Start

### Prerequisites

- Node.js 20+ (or Bun)
- FFmpeg (optional — `ffmpeg-static` npm package is bundled for serverless deployment)

### Installation

```bash
# Clone and install
git clone <your-repo-url>
cd reverse-speed-ramp
bun install

# Start development server
bun run dev
```

The app runs on **http://localhost:3000**.

### Upload & Process

1. Open the app in your browser
2. Drag & drop or click to upload a video
3. Adjust trim duration and speed config (optional)
4. Click **Process V-Ramp** (or **Process All** for batch)
5. Preview the result with original/processed toggle
6. Download the processed clip

---

## API Reference

### POST /api/analyze

Upload and probe a video file for metadata.

```bash
curl -X POST /api/analyze -F "file=@video.mp4"
```

**Response**:
```json
{
  "id": "uuid",
  "fileName": "uuid.mp4",
  "originalName": "video.mp4",
  "duration": 3.0,
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "codec": "h264",
  "hasAudio": true,
  "audioCodec": "aac"
}
```

### POST /api/speedramp

Process a video with configurable speed ramping. Returns the processed video as a binary file.

```bash
# V-Ramp (default)
curl -X POST /api/speedramp \
  -F "file=@video.mp4" \
  -F 'config={"mode":"vramp","trimDuration":1.0}' \
  -o output.mp4

# Linear 2x→0.5x
curl -X POST /api/speedramp \
  -F "file=@video.mp4" \
  -F 'config={"mode":"linear","startSpeed":2.0,"endSpeed":0.5}' \
  -o output.mp4

# Custom speed curve
curl -X POST /api/speedramp \
  -F "file=@video.mp4" \
  -F 'config={"mode":"custom","speedPoints":[{"time":0,"speed":4},{"time":0.5,"speed":1},{"time":1,"speed":0.6}]}' \
  -o output.mp4
```

### GET /api/speedramp

Returns complete API documentation with all parameters, examples, and processing tips.

```bash
curl /api/speedramp
```

### Configuration Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mode` | `string` | `"vramp"` | Processing mode: `vramp`, `linear`, or `custom` |
| `trimDuration` | `number` | `1.0` | Source video duration to use (seconds) |
| `trimStart` | `number` | `0` | Start offset for trimming (seconds) |
| `startSpeed` | `number` | `4.0` | Starting speed multiplier |
| `endSpeed` | `number` | `0.6` | Ending speed (linear mode) |
| `rampMid` | `number` | `0.6` | V-bottom speed (vramp mode) |
| `rampEnd` | `number` | `4.0` | End speed for reversed segment |
| `speedPoints` | `array` | `[]` | Custom control points `{time, speed}` |
| `reverse` | `boolean` | `true` | Add reversed + concatenate |
| `outputFps` | `number` | `30` | Output frame rate (1–120) |
| `crf` | `number` | `23` | Quality: 0=lossless, 23=good, 28=acceptable |
| `preset` | `string` | `"ultrafast"` | Encoding speed: ultrafast→veryslow |
| `audioMode` | `string` | `"auto"` | Audio: `auto`, `strip`, or `adjust` |
| `outputFormat` | `string` | `"mp4"` | Format: `mp4`, `mov`, or `webm` |
| `outputScale` | `string` | `null` | Scale e.g. `"1280x720"`, null=original |
| `codec` | `string` | `"libx264"` | Encoder: `libx264`, `libx265`, `libvpx-vp9` |

---

## How It Works

### Speed Ramp Mathematics

The speed ramp uses **continuous logarithmic interpolation** — not step-wise constant speeds. This creates smooth, cinematic transitions:

**setpts formula** (continuous speed change from s₀ to s₁ over duration D):

```
setpts = (D / (Δs · TB)) · log(max(0.0001, 1 + Δs · (PTS - STARTPTS) · TB / (s₀ · D)))
```

where `Δs = s₁ - s₀`, `TB = timebase`, and `PTS = presentation timestamp`.

**Output duration** (integral of 1/s(t)):

```
T_out = (D / Δs) · ln(1 + Δs/s₀)
```

For constant speed (`Δs ≈ 0`): `T_out ≈ D / s₀`

### Processing Pipeline

**V-Ramp mode (optimized)**:

| Step | Operation | FFmpeg Calls |
|------|-----------|--------------|
| 1 | Trim + Forward ramp (4x→0.6x) | 1 |
| 2 | Trim + Reverse (0.6x frame order) | 1 |
| 3 | Reverse speed ramp (0.6x→4x) | 1 |
| 4 | Concatenate forward + reversed | 1 (stream copy) |

**Linear mode (no reverse)**: 1 FFmpeg call — trim + ramp combined

**Linear mode (with reverse)**: 3 calls — ramp, reverse, concat

---

## Project Architecture

```
src/
├── app/
│   ├── page.tsx              # Main UI — upload, preview, config, export
│   └── api/
│       ├── analyze/route.ts  # Video upload + metadata probe
│       └── speedramp/route.ts # Speed ramp processing engine
│       └── process/route.ts  # Deprecated → redirects to /api/speedramp
├── components/
│   ├── upload-zone.tsx       # Drag & drop video upload
│   ├── clip-list.tsx         # Video clip list + management
│   ├── video-preview.tsx     # Video player with controls
│   ├── trim-duration-control.tsx # Trim duration slider + presets
│   ├── export-panel.tsx      # Process/download + full config panel
│   ├── processing-status.tsx # Processing progress indicator
│   ├── process-all.tsx       # Batch processing + download all
│   └── ui/                   # shadcn/ui component library
├── lib/
│   ├── store.ts              # Zustand state management
│   ├── types.ts              # TypeScript interfaces
│   ├── paths.ts              # Platform-aware FFmpeg path resolution
│   └── db.ts                 # Prisma database client
└── hooks/
    └── use-toast.ts          # Toast notification hook
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 + shadcn/ui |
| State | Zustand (client) |
| Processing | FFmpeg via `ffmpeg-static` npm package |
| Database | Prisma ORM (SQLite — available but unused) |
| Deployment | Vercel, Render/Docker, or local |

---

## Deployment

### Vercel (Serverless)

The project is configured for Vercel deployment using `ffmpeg-static` as a bundled native binary:

1. Push to a git repository connected to Vercel
2. Vercel runs `prisma generate && next build` automatically
3. `ffmpeg-static` is included in `serverExternalPackages` for proper bundling
4. On Vercel, ffprobe is unavailable — the app uses FFmpeg itself for video probing

**Vercel plan limitations**:

| Plan | Max Upload | Timeout | Notes |
|------|-----------|---------|-------|
| Hobby | 4.5 MB | 10s | Too restrictive for most videos |
| Pro | 50 MB | 60s (up to 300s) | Recommended for video processing |

### Render (Docker)

For unrestricted video processing, deploy on Render with the included Dockerfile:

```bash
# Render detects render.yaml automatically
# Uses Docker runtime with system FFmpeg installed
```

**Render free tier**: No body size limits, no timeout constraints for Docker deployments.

### Local Development

```bash
bun run dev    # Start dev server on port 3000
bun run lint   # Check code quality
bun run build  # Production build (not needed for Vercel)
```

---

## Processing Performance

| Video | Duration | V-Ramp Processing | Output Size |
|-------|----------|-------------------|-------------|
| 320×240 3s | 1s trim | 271ms | 174 KB |
| 1920×1080 4s | 1s trim | 2.7s | 2.6 MB |

**Tips for fast processing**:
- Use `ultrafast` preset, 30 FPS, CRF 23
- Keep trim duration short (1–5 seconds for best speed)
- Avoid `slow`/`veryslow` presets for long clips

---

## Environment Configuration

```env
# FFmpeg path (optional — auto-detected)
FFMPEG_PATH=/usr/bin/ffmpeg

# FFprobe path (optional — auto-detected)
FFPROBE_PATH=/usr/bin/ffprobe

# Vercel auto-sets these:
VERCEL=1

# Database (optional — app doesn't require it)
DATABASE_URL=file:./dev.db
```

---

## License

MIT
