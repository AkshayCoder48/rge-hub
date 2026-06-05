---
Task ID: 3-c
Agent: Full-stack Developer
Task: Enhanced clip list, speed graph, stats bar, and ramp info panel

Work Log:
- Enhanced clip-list.tsx:
  - Changed imports: Replaced CheckCircle/AlertCircle with CheckCircle2/XCircle/Circle for better status icons
  - Upgraded StatusBadge component: 'uploaded' shows orange Circle icon + "Ready", 'processing' shows spinning Loader2 + "Processing...", 'completed' shows CheckCircle2 + "Done • 0.5s" with processing time, 'error' shows XCircle + "Failed"
  - Added processingTime prop to StatusBadge to display inline in badge
  - Converted metadata from plain text to styled badges: resolution badge (bg-zinc-800/80 border), file size badge, codec badge (orange-tinted bg-orange-500/5 border-orange-500/10), FPS badge (cyan-tinted bg-cyan-500/5 border-cyan-500/10)
  - Audio indicator now styled as badge with colored border (green for has-audio, zinc for no-audio)
  - Added thin animated gradient progress bar (3px) at bottom of card when clip is processing (absolute positioned, orange-to-cyan gradient)
  - Removed duplicate Timer/processing-time badge from info row (now shown inline in StatusBadge)
- Rewrote speed-graph.tsx:
  - Grid lines: Changed to dashed (setLineDash [4,4]) for all horizontal and vertical grid lines
  - Y-axis speed labels: "0x", "1x", "2x", etc. with bold styling at 1x
  - X-axis percentage labels: "0%"/"25%"/"50%"/"75%"/"100%" for both Forward and Reverse halves
  - Duration in seconds shown below percentage labels
  - Tooltip on hover: Shows crosshair lines + speed value tooltip at hover position on the curve
  - Better curve rendering: Changed strokeWidth from 2.5 to 3 for both forward and reverse curves
  - Animated gradient fill: Gradient stops shift subtly over time using sin() for color intensity and gradientOffset for position
  - 1x reference line: Made more prominent (lineWidth 1.5, brighter color #52525b, labeled "1x normal")
  - Draggable playhead: Click and drag to scrub the playhead position on completed clips; dashed line style when dragging; larger dot (6px) when dragging; speed tooltip shown at playhead
  - Legend improvement: Replaced dot indicators with SVG line segments (16x8, strokeWidth 3) in info panel
  - "Playing" indicator now shows "click & drag to scrub" text
  - Canvas cursor changed to crosshair
- Enhanced stats-bar.tsx:
  - Added total file size stat: HardDrive icon, formatFileSize helper, shows total size of all clips
  - Added total duration stat: Hourglass icon, formatTotalDuration helper ("Xm Ys" format)
  - Better tooltips: Each tooltip now shows primary info + secondary detail (e.g., "Total clips in library • 2 ready to process", "Average processing time • Based on 3 completed clips")
  - Added flex-shrink-0 and whitespace-nowrap for proper overflow handling
  - Added min-w-4 spacer for better responsive behavior
- Polished ramp-info.tsx:
  - Added SpeedCurveMiniPreview component: Inline SVG (64x24px) showing forward (orange) and reverse (cyan) speed curve shapes with 1x reference line
  - Mini preview appears next to the preset badge in the header
  - Added AnimatedCounter component: Count-up animation (ease-out cubic, 800ms) triggered by key prop on completion
  - Output duration panel shows when clip is completed with green-to-cyan gradient background and border
  - Shows percentage of original duration (e.g., "120% of original")
  - Replaced ArrowRight/RotateCcw with TrendingDown/TrendingUp icons for Forward/Reverse
  - Added gradient accent bars (left border) on Forward and Reverse cards
  - Better visual hierarchy with colored left-border accents
- All files pass `bun run lint` with zero errors
- Dev server compiles successfully (HTTP 200)

Stage Summary:
- **Enhanced Clip Cards**: Codec badge (orange), FPS badge (cyan), resolution badge, file size badge, audio badge; better status indicators with icons (Circle/Loader2/CheckCircle2/XCircle); thin gradient progress bar at bottom of processing cards; processing time shown inline in status badge
- **Speed Graph Improvements**: Dashed grid lines; Y-axis "1x"/"2x"/"3x" labels (bold at 1x); X-axis "0%"/"25%"/"50%"/"75%"/"100%" labels; hover tooltip with crosshair + speed value; thicker curves (strokeWidth 3); animated gradient fill; prominent 1x reference line labeled "1x normal"; draggable playhead with scrub support; SVG line segment legends
- **Stats Bar Enhancement**: Total file size (HardDrive icon); total duration with "Xm Ys" format (Hourglass icon); rich tooltips with secondary detail lines; overflow-safe layout
- **Ramp Info Polish**: Mini speed curve SVG preview; AnimatedCounter for output duration on completion; gradient accent bars on Forward/Reverse cards; TrendingDown/TrendingUp icons; output duration panel with percentage of original
