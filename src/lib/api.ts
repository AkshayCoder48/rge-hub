import { VideoClip, VideoInfo } from './types';

const API_BASE = '/api';

function apiFetch(path: string, options?: RequestInit) {
  return fetch(`${API_BASE}${path}`, options);
}

export async function uploadVideo(file: File): Promise<VideoClip> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await apiFetch('/upload', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(error.error || 'Upload failed');
  }

  return response.json();
}

export async function uploadZip(file: File): Promise<{ batchId: string; clips: VideoClip[] }> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await apiFetch('/upload-zip', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(error.error || 'Upload failed');
  }

  return response.json();
}

export async function processClip(
  clipId: string,
  filePath: string,
  duration: number,
  preset?: 'quality' | 'fast' | 'turbo',
  trimStart?: number,
  trimEnd?: number,
  rampMinSpeed?: number,
  rampMaxSpeed?: number,
  preserveAudio?: boolean
): Promise<{ outputPath: string; outputDuration: number }> {
  const response = await apiFetch('/process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clipId, filePath, duration, preset, trimStart, trimEnd, rampMinSpeed, rampMaxSpeed, preserveAudio }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Processing failed' }));
    throw new Error(error.error || 'Processing failed');
  }

  return response.json();
}

export async function getVideoInfo(clipId: string): Promise<VideoInfo> {
  const response = await apiFetch(`/video-info/${clipId}`);

  if (!response.ok) {
    throw new Error('Failed to get video info');
  }

  return response.json();
}

export async function exportZip(clipIds: string[], clipNames?: Record<string, string>): Promise<Blob> {
  const response = await apiFetch('/export-zip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clipIds, clipNames }),
  });

  if (!response.ok) {
    throw new Error('Export failed');
  }

  return response.blob();
}

export function getProcessedVideoUrl(clipId: string): string {
  return `${API_BASE}/processed/${clipId}_final.mp4`;
}

export function getThumbnailUrl(clipId: string): string {
  return `${API_BASE}/thumbnail/${clipId}`;
}

export function getUploadedVideoUrl(filePath: string): string {
  const fileName = filePath.split('/').pop();
  return `${API_BASE}/uploads/${fileName}`;
}
