---
Task ID: 1
Agent: Main Agent
Task: Rebuild entire project from scratch, fixing IDs not deploying

Work Log:
- Project sandbox was reset - all previous files gone
- Re-initialized Next.js project with fullstack init script
- Installed fluent-ffmpeg + @types/fluent-ffmpeg
- Created /uploads, /processed, /tmp directories
- Built complete app from scratch with the ID fix:

KEY FIX - IDs not deploying issue:
- In store.ts addClip(), the reversed clip gets `sourceClipId: clip.id` which points to the ORIGINAL clip's UUID
- In process/route.ts, the file lookup uses `sourceClipId || clipId` to find the uploaded file
- The uploaded file is saved as `{uuid}.{ext}` in the analyze route
- The original clip's `id` matches this UUID prefix
- The reversed clip's `id` is `rev-{timestamp}-{random}` - which does NOT match any file
- So the reversed clip MUST use `sourceClipId` to find the file → this was the missing link

- Created types.ts: simple VideoClip with 2-point SpeedRampPoint, no presets
- Created store.ts: addClip auto-creates reversed clip (0.6x→4x) with sourceClipId pointing to original
- Created ffmpeg-config.ts: fluent-ffmpeg setup
- Created analyze/route.ts: upload + probe video, returns UUID-based ID
- Created process/route.ts: KEY FIX - uses sourceClipId for file lookup, segmented speed processing
- Created download/route.ts: file serving by ID
- Created all UI components: upload-zone, clip-list, video-preview, export-panel, process-all, processing-status, timeline-trimmer
- Created page.tsx: simplified layout with straight-line speed ramp SVG
- Lint passes, dev server running, agent-browser verified page renders correctly

Stage Summary:
- Complete rebuild from scratch
- ID deployment fix: process API correctly uses sourceClipId to find uploaded file for reversed clips
- Normal clip: 4.0x → 0.6x (orange), Reversed clip: 0.6x → 4.0x (cyan)
- Auto-creates both clips on upload, no manual action needed
- Straight-line speed ramps, no fancy graphs or presets
