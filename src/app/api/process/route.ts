import { NextResponse } from 'next/server';

// This route is no longer used - processing is handled by /api/speedramp
// which combines upload + process + return in a single request
// (required for serverless deployment compatibility)

export async function POST() {
  return NextResponse.json({ 
    error: 'This endpoint is deprecated. Use /api/speedramp instead.',
    hint: 'Send a FormData with "file" and "trimDuration" to /api/speedramp'
  }, { status: 400 });
}
