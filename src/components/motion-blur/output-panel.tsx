'use client';

import React from 'react';
import { Download, RotateCcw, CheckCircle2, FileVideo, ArrowRight } from 'lucide-react';
import type { ProcessingResult } from '@/lib/video';

interface OutputPanelProps {
  result: ProcessingResult;
  onDownload: () => void;
  onReset: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function OutputPanel({ result, onDownload, onReset }: OutputPanelProps) {
  // Derive input filename from output filename
  const inputFilename = result.filename.replace(/_motionblur/, '');

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="rounded-2xl bg-[#0f0f17] border border-cyan-500/15 p-6 space-y-5">
        {/* Success header */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-cyan-500/10 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-cyan-400">Motion Blur Complete!</h3>
            <p className="text-xs text-white/30 mt-0.5">Your processed video is ready to download</p>
          </div>
        </div>

        {/* Filename transformation */}
        <div className="flex items-center gap-2 rounded-xl bg-white/[0.03] border border-white/5 px-4 py-3 overflow-x-auto">
          <FileVideo className="w-4 h-4 text-white/30 shrink-0" />
          <span className="text-xs text-white/40 truncate">{inputFilename}</span>
          <ArrowRight className="w-3.5 h-3.5 text-cyan-400/50 shrink-0" />
          <span className="text-xs text-cyan-400/80 truncate font-medium">{result.filename}</span>
        </div>

        {/* Output details */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'File Size', value: formatFileSize(result.blob.size) },
            { label: 'Resolution', value: `${result.width}×${result.height}` },
            { label: 'Frame Rate', value: `${Math.round(result.fps)} fps` },
            { label: 'Duration', value: `${result.duration.toFixed(1)}s` },
          ].map((item) => (
            <div key={item.label} className="rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2">
              <p className="text-[10px] text-white/25 uppercase tracking-wider">{item.label}</p>
              <p className="text-sm font-medium text-white/70 mt-0.5">{item.value}</p>
            </div>
          ))}
        </div>

        {/* Action buttons */}
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={onDownload}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-400 text-sm font-semibold text-white hover:shadow-lg hover:shadow-cyan-500/20 hover:scale-[1.01] active:scale-[0.99] transition-all duration-300"
          >
            <Download className="w-4 h-4" />
            Download
          </button>
          <button
            onClick={onReset}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-white/5 border border-white/10 text-sm font-medium text-white/60 hover:text-white/80 hover:bg-white/10 transition-all duration-300"
          >
            <RotateCcw className="w-4 h-4" />
            Process Another Video
          </button>
        </div>
      </div>
    </div>
  );
}
