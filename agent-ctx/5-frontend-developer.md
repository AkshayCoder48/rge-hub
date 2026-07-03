# Task 5 - Frontend Developer: Create Motion Blur Page Component

## Task
Create `/home/z/my-project/src/components/motion-blur-page.tsx` - A full standalone motion blur page component.

## Work Completed

### Created motion-blur-page.tsx
Followed the exact design patterns from `interpolation-page.tsx` with purple/violet theme instead of emerald/cyan.

### Sub-components implemented:
1. **MotionBlurUploadZone** - Drag-and-drop upload zone with purple theme
   - Posts to `/api/analyze`, creates MotionBlurClip with defaults (filterType: 'tblend', frames: 2, intensity: 'average', status: 'ready')
   - Purple/pink gradient progress bar

2. **MotionBlurClipList** - Left sidebar clip list
   - Shows original name, duration, resolution, filter type, intensity, status
   - Filter type dropdown (tblend/tmix) per clip
   - Intensity button group (Light/Average/Heavy) per clip
   - Delete on hover, "Add More Videos" at bottom

3. **MotionBlurVisual** - Before/After blur effect visualization
   - Before: Sharp frame rectangles with hard borders
   - After: Blurred frame rectangles with CSS blur + purple/pink glow
   - Stats grid: Source FPS, Filter Type, Intensity

4. **MotionBlurSettingsPanel** - Selected clip settings
   - Filter Type cards with descriptions (tblend vs tmix)
   - Frames slider (2-16) with visual feedback
   - Intensity selector (Light/Average/Heavy)
   - Process button → POST /api/motion-blur
   - Download button when done
   - Progress bar with purple→pink gradient

5. **MotionBlurBatchPanel** - Batch operations
   - Process All, Download Processed ZIP, Download All as ZIP
   - Same pattern as InterpolationBatchPanel

### Theme
- Primary: Purple/Violet (bg-purple-500/10, text-purple-400, border-purple-500/20)
- Secondary: Pink/rose accents
- Header gradient: from-purple-400 via-white/90 to-pink-400
- Background: #0a0a0f / #0f0f17

### Export
- Named export `MotionBlurPage` with 'use client' directive

### Lint & Compilation
- ESLint passes clean
- Dev server compiles without errors
