'use client';

import React, { useMemo, useEffect, useRef } from 'react';
import { Eye } from 'lucide-react';

interface VideoPreviewProps {
  originalFile?: File;
  processedBlob?: Blob;
}

export function VideoPreviewPanel({ originalFile, processedBlob }: VideoPreviewProps) {
  const originalUrl = useMemo(() => {
    if (!originalFile) return null;
    return URL.createObjectURL(originalFile);
  }, [originalFile]);

  const processedUrl = useMemo(() => {
    if (!processedBlob) return null;
    return URL.createObjectURL(processedBlob);
  }, [processedBlob]);

  // Track URLs for cleanup
  const urlsRef = useRef<string[]>([]);

  // Register URLs for cleanup
  useEffect(() => {
    const currentUrls: string[] = [];
    if (originalUrl) currentUrls.push(originalUrl);
    if (processedUrl) currentUrls.push(processedUrl);
    urlsRef.current = currentUrls;

    return () => {
      for (const url of urlsRef.current) {
        URL.revokeObjectURL(url);
      }
    };
  }, [originalUrl, processedUrl]);

  const hasOriginal = !!originalUrl;
  const hasProcessed = !!processedUrl;

  if (!hasOriginal && !hasProcessed) return null;

  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="rounded-2xl bg-[#0f0f17] border border-white/5 p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500/10 to-cyan-500/10 flex items-center justify-center">
            <Eye className="w-4 h-4 text-white/70" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-white/80">Video Preview</h3>
            <p className="text-xs text-white/30 mt-0.5">Compare original and processed video</p>
          </div>
        </div>

        {/* Video panels */}
        <div className={`grid gap-4 ${hasProcessed ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
          {/* Original video */}
          {hasOriginal && (
            <div className="space-y-2">
              <span className="text-xs font-medium text-white/50 uppercase tracking-wider">Original</span>
              <div className="rounded-xl overflow-hidden bg-black/40 border border-white/5 aspect-video">
                <video
                  src={originalUrl!}
                  controls
                  className="w-full h-full object-contain"
                  preload="metadata"
                >
                  <track kind="captions" />
                </video>
              </div>
            </div>
          )}

          {/* Processed video */}
          {hasProcessed && (
            <div className="space-y-2">
              <span className="text-xs font-medium text-cyan-400/70 uppercase tracking-wider">Motion Blur Applied</span>
              <div className="rounded-xl overflow-hidden bg-black/40 border border-cyan-500/15 aspect-video">
                <video
                  src={processedUrl!}
                  controls
                  className="w-full h-full object-contain"
                  preload="metadata"
                >
                  <track kind="captions" />
                </video>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
