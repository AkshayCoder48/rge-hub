# Task 14-a: Settings Panel with Preferences, Disk Usage Indicator, and File Cleanup

## Work Log

### 1. Updated Zustand Store (`/src/lib/store.ts`)
- Added `settingsOpen: boolean` (default: false) and `setSettingsOpen` action
- Added `defaultPreset: 'turbo' | 'quality'` (default: 'turbo') and `setDefaultPreset` action — also updates the active `processingPreset`
- Added `defaultAudio: boolean` (default: false) and `setDefaultAudio` action — also updates the active `preserveAudio`

### 2. Created Storage Info API Route (`/src/app/api/storage-info/route.ts`)
- GET endpoint that scans `./uploads/` and `./processed/` directories
- Uses `fs.readdirSync` and `fs.statSync` to calculate total sizes and file counts
- Returns JSON: `{ uploadsSize, processedSize, uploadCount, processedCount, totalSize }`
- Handles missing directories gracefully

### 3. Created Cleanup API Route (`/src/app/api/cleanup/route.ts`)
- POST endpoint accepting `{ type: "processed" | "all" }`
- Deletes all files in `./processed/` for type "processed", or both `./uploads/` and `./processed/` for type "all"
- Returns JSON: `{ deletedCount, freedSpace }`
- Validates type parameter, returns 400 for invalid values

### 4. Created Settings Panel Component (`/src/components/settings-panel.tsx`)
- Slide-in drawer from the right side (w-96 on desktop, full width on mobile)
- Dark theme with bg-zinc-900/95, backdrop-blur-xl, border-l
- Smooth transitions (transform + duration-300)
- Backdrop overlay (click to close)
- Escape key closes panel
- X button in header

**Panel sections:**

#### a) Storage & Disk Usage
- Fetches from `/api/storage-info` on panel open
- Visual bar with two segments: orange for uploads, cyan for processed
- Shows total size in human-readable format (B/KB/MB/GB)
- File count stats in grid cards with colored indicators

#### b) File Cleanup
- "Clear Processed Files" button — calls `/api/cleanup` with `{ type: "processed" }`
- "Clear All Files" button — calls `/api/cleanup` with `{ type: "all" }`
- Both buttons show red confirmation dialog with warning before deleting
- Cancel option, success/error toast notifications
- Refreshes storage info after cleanup

#### c) Default Settings
- Processing preset dropdown (Turbo/Quality) using shadcn Select — updates store defaults
- Audio toggle using shadcn Switch — updates store defaults
- Both also update the active processing settings immediately

#### d) About section
- Version: v2.0
- Tech stack: Next.js 16, FFmpeg, Tailwind CSS
- GitHub link (placeholder)

### 5. Updated Header (`/src/components/header.tsx`)
- Imported `useAppStore` for `settingsOpen` and `setSettingsOpen`
- Settings gear icon now toggles the settings panel
- Active state styling (orange highlight when panel is open)
- Gear icon rotates 90° when panel is open
- Removed "coming soon" title

### 6. Updated Page (`/src/app/page.tsx`)
- Added `SettingsPanel` import
- Rendered `<SettingsPanel />` after `KeyboardShortcuts` component

### Technical Details
- All files pass `bun run lint` with zero errors
- Both API endpoints tested and working via curl
- Page loads successfully (HTTP 200)
- Dev server compiles without errors
- Maintained orange (#f97316) / cyan (#22d3ee) / green color scheme
- Used existing shadcn/ui components (Button, Switch, Select, etc.)
