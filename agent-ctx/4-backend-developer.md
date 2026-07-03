# Task 4 - Backend Developer Work Record

## Task
Upgrade interpolation API route to use FFmpeg's minterpolate filter

## Changes Made

### 1. `/home/z/my-project/src/app/api/interpolate/route.ts` (Full Rewrite)
- Replaced simple `fps=N` filter with proper minterpolate-based interpolation
- Added `InterpolationMode` type: `'mci' | 'blend' | 'framerate'`
- Added `interpolationMode` field to request body (default: `'mci'`)
- Implemented three modes:
  - **MCI**: `minterpolate=fps=N:mi_mode=mci:mc_mode=aobmc:vsbmc=1:me_mode=bidir:scd=fdiff` (highest quality)
  - **Blend**: `minterpolate=fps=N:mi_mode=blend` (medium quality, faster)
  - **Framerate**: `framerate=fps=N` (lightweight, fastest)
- Escaped colons with `\:` for fluent-ffmpeg compatibility
- Added `buildInterpolationFilter()` function
- Added `getModeLabel()` helper
- Response now includes `interpolationMode` and `interpolationModeLabel` fields
- Preserved existing motion blur (tblend) as post-processing step
- Preserved existing helper patterns and output encoding

### 2. `/home/z/my-project/src/components/interpolation-page.tsx` (Updated)
- Added `INTERPOLATION_MODE_OPTIONS` constant with labels/descriptions
- Imported `DEFAULT_INTERPOLATION_MODE` and `InterpolationMode` type
- Added interpolation mode selector dropdown per clip in clip list
- Both clip creation sites include `interpolationMode: DEFAULT_INTERPOLATION_MODE`
- Both API call sites (single + batch) send `interpolationMode` in request body
- Added `setInterpolationClipMode` action usage

## Verification
- `bun run lint` passes clean
- Dev server compiles successfully
