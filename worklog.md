---
Task ID: 1
Agent: main
Task: Restructure app to create single combined reverse speed ramp clip

Work Log:
- Updated types.ts: Replaced `sourceClipId`, `trimStart`, `trimEnd` with `trimDuration` field
- Updated store.ts: Changed from dual-clip system (normal + reversed) to single V-ramp clip
  - Added RAMP_START (4.0), RAMP_MID (0.6), RAMP_END (4.0) constants
  - Created `createReverseSpeedRamp()` generating 3-point V-shape: 4x→0.6x→4x
  - `addClip` now creates single clip instead of auto-creating reversed pair
  - Replaced `setClipTrim` with `setClipTrimDuration`
- Rewrote process API (route.ts) for combined forward+reverse processing:
  1. Trim input to `trimDuration` seconds
  2. Create forward segment with 4x→0.6x segmented speed ramp
  3. Reverse trimmed segment (video+audio), apply 0.6x→4x speed ramp
  4. Concatenate both segments into final V-ramp output
- Updated upload-zone.tsx: Creates single clip with `trimDuration` (default 1.00s)
- Updated page.tsx: New V-shaped SVG visualization showing forward (orange) and reversed (cyan) halves
  - Header shows "Reverse Speed Ramp" with V-ramp badge
  - Empty state explains "Upload → Get V-ramp clip"
  - Combined clip shows gradient V-ramp labels
- Updated clip-list.tsx: Single clip per upload with V-RAMP badge
- Updated export-panel.tsx: Shows V-ramp type, trim duration, estimated output
- Updated process-all.tsx: Works with single clip structure
- Updated video-preview.tsx: Removed sourceClipId logic, shows "V-RAMP" label
- Created trim-duration-control.tsx: Slider to adjust trim duration with preset buttons (0.5s, 1.0s, 1.5s, 2.0s, 3.0s)
- Removed TimelineTrimmer reference, replaced with TrimDurationControl
- Updated layout metadata for "Reverse Speed Ramp"
- Lint passes clean
- Page renders correctly with agent-browser verification

Stage Summary:
- App restructured from 2-clip system to single combined "Reverse Speed Ramp" clip
- Upload creates one clip that processes into forward(4x→0.6x) + reversed(0.6x→4x) combined video
- Default trim: first 1.00 second of original video
- V-shaped speed ramp visualization with forward (orange) and reversed (cyan) sections
- Trim duration is adjustable via slider and presets
