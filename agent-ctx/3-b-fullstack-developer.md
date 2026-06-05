# Task 3-b: Full-stack Developer - Add New Features

## Task Summary
Add 6 new features to the Auto Speed Ramping app: clip rename, reset trim, quick trim presets, clip duplicate, processing ETA, and batch queue visualization.

## Files Modified
- `/src/lib/store.ts` - Added `duplicateClip` action
- `/src/components/clip-list.tsx` - Added clip rename (inline edit) and duplicate features
- `/src/components/timeline-trimmer.tsx` - Added reset trim button and quick trim presets
- `/src/components/processing-status.tsx` - Added ETA countdown display
- `/src/app/page.tsx` - Added BatchQueue component and batchQueueIds state

## Files Created
- `/src/components/batch-queue.tsx` - Batch queue visualization component

## Key Implementation Details

### Clip Rename
- Double-click on clip name or click Pencil icon to enter edit mode
- Input auto-selects all text, Enter confirms, Escape cancels
- Uses `updateClip` to persist `originalName` changes

### Clip Duplicate
- Copy icon button on each ClipCard (cyan hover)
- `duplicateClip` store action creates new clip with "(copy)" suffix
- Resets status to 'uploaded', processedPath to null, progress to 0

### Reset Trim
- RotateCcw icon + "Reset" text button in timeline header
- Only visible when trimStart !== 0 or trimEnd !== duration

### Quick Trim Presets
- Pill buttons: "1s", "2s", "3s", "5s", "Full"
- Active preset highlighted in orange
- Sets trimStart=0, trimEnd=min(preset, duration)

### Processing ETA
- EtaCountdown sub-component with key={clip.id} for clean reset
- Estimates: turbo=2s, quality=7s per clip
- 100ms update interval, format "ETA: ~1.2s"
- Timer icon next to display

### Batch Queue
- Horizontal thumbnail strip with status overlays
- Orange border+spinner for processing, green check for completed, dimmed for pending
- Only shown when isProcessing && batchQueueIds.length > 1

## Lint Status
All files pass `bun run lint` with zero errors.
