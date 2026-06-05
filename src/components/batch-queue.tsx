'use client';

import React from 'react';
import { Loader2, Check, Film } from 'lucide-react';
import { useAppStore } from '@/lib/store';

export function BatchQueue({ clipIds }: { clipIds: string[] }) {
  const { clips } = useAppStore();

  if (clipIds.length <= 1) return null;

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">
            Batch Queue
          </p>
          <span className="text-[10px] text-zinc-500">
            {clips.filter(c => clipIds.includes(c.id) && c.status === 'completed').length}/{clipIds.length} done
          </span>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {clipIds.map((clipId) => {
            const clip = clips.find(c => c.id === clipId);
            if (!clip) return null;

            const isProcessing = clip.status === 'processing';
            const isCompleted = clip.status === 'completed';
            const isPending = !isProcessing && !isCompleted;
            const isError = clip.status === 'error';

            return (
              <div
                key={clipId}
                className={`flex-shrink-0 w-20 rounded-md border overflow-hidden transition-all duration-300 ${
                  isProcessing
                    ? 'border-orange-500/50 shadow-sm shadow-orange-500/10 bg-zinc-800/80'
                    : isCompleted
                      ? 'border-green-500/30 bg-zinc-800/60'
                      : isError
                        ? 'border-red-500/30 bg-zinc-800/40'
                        : 'border-zinc-800/60 bg-zinc-900/60 opacity-50'
                }`}
              >
                {/* Thumbnail */}
                <div className="relative w-full h-11 bg-zinc-800 flex items-center justify-center">
                  {clip.thumbnailUrl ? (
                    <img
                      src={clip.thumbnailUrl}
                      alt={clip.originalName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Film className="w-4 h-4 text-zinc-600" />
                  )}

                  {/* Processing overlay */}
                  {isProcessing && (
                    <div className="absolute inset-0 bg-orange-500/20 flex items-center justify-center">
                      <Loader2 className="w-4 h-4 text-orange-400 animate-spin" />
                    </div>
                  )}

                  {/* Completed overlay */}
                  {isCompleted && (
                    <div className="absolute inset-0 bg-green-500/20 flex items-center justify-center">
                      <div className="w-5 h-5 rounded-full bg-green-500/30 border border-green-500/50 flex items-center justify-center">
                        <Check className="w-3 h-3 text-green-400" />
                      </div>
                    </div>
                  )}

                  {/* Error overlay */}
                  {isError && (
                    <div className="absolute inset-0 bg-red-500/15 flex items-center justify-center">
                      <span className="text-[10px] text-red-400 font-bold">✕</span>
                    </div>
                  )}
                </div>

                {/* Name */}
                <div className="px-1.5 py-1">
                  <p className="text-[9px] text-zinc-400 truncate leading-tight">
                    {clip.originalName}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
