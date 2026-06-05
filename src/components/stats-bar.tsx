'use client';

import React from 'react';
import { Film, CheckCircle, Clock, BarChart3, HardDrive, Hourglass } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useAppStore } from '@/lib/store';

function AnimatedNumber({ value, format }: { value: number; format: (v: number) => string }) {
  return (
    <span className="count-up tabular-nums" key={value}>
      {format(value)}
    </span>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatTotalDuration(seconds: number): string {
  if (seconds === 0) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

export function StatsBar() {
  const { clips, isProcessing } = useAppStore();

  const totalClips = clips.length;
  const completedClips = clips.filter(c => c.status === 'completed').length;
  const processingClips = clips.filter(c => c.status === 'processing').length;

  // Average processing time from completed clips
  const completedWithTime = clips.filter(c => c.status === 'completed' && c.processingTime != null);
  const avgProcessingTime = completedWithTime.length > 0
    ? completedWithTime.reduce((sum, c) => sum + (c.processingTime ?? 0), 0) / completedWithTime.length
    : 0;

  const completionRate = totalClips > 0 ? (completedClips / totalClips) * 100 : 0;

  // Total file size
  const totalFileSize = clips.reduce((sum, c) => sum + c.fileSize, 0);

  // Total duration
  const totalDuration = clips.reduce((sum, c) => sum + c.duration, 0);

  // Total completed file size
  const completedFileSize = clips.filter(c => c.status === 'completed').reduce((sum, c) => sum + c.fileSize, 0);

  function formatAvgTime(ms: number): string {
    if (ms === 0) return '—';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  const formatTotal = (v: number) => v.toString();
  const formatDone = (v: number) => v.toString();
  const formatProcessing = (v: number) => v.toString();
  const formatSize = (v: number) => formatFileSize(v);
  const formatDuration = (v: number) => formatTotalDuration(v);

  return (
    <div className="bg-gradient-to-r from-zinc-900/90 via-zinc-900/80 to-zinc-900/90 border-b border-zinc-800/60">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center h-9 gap-0 overflow-x-auto">
          {/* Total clips */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5 px-3 py-1 rounded cursor-default hover:bg-zinc-800/40 transition-colors duration-200 whitespace-nowrap">
                <Film className="w-3 h-3 text-zinc-500" />
                <span className="text-[11px] text-zinc-500">Total</span>
                <span className="text-[11px] font-semibold text-zinc-300">
                  <AnimatedNumber value={totalClips} format={formatTotal} />
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="bg-zinc-800 text-zinc-200 border-zinc-700">
              <p>Total clips in library</p>
              <p className="text-[10px] text-zinc-400">{clips.filter(c => c.status === 'uploaded').length} ready to process</p>
            </TooltipContent>
          </Tooltip>

          {/* Gradient separator */}
          <div className="w-px h-4 bg-gradient-to-b from-transparent via-orange-500/20 to-transparent flex-shrink-0" />

          {/* Completed clips */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5 px-3 py-1 rounded cursor-default hover:bg-green-500/5 transition-colors duration-200 whitespace-nowrap">
                <CheckCircle className="w-3 h-3 text-green-500" />
                <span className="text-[11px] text-zinc-500">Done</span>
                <span className="text-[11px] font-semibold text-green-400">
                  <AnimatedNumber value={completedClips} format={formatDone} />
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="bg-zinc-800 text-zinc-200 border-zinc-700">
              <p>Successfully processed clips</p>
              {completedFileSize > 0 && (
                <p className="text-[10px] text-zinc-400">{formatFileSize(completedFileSize)} total processed</p>
              )}
            </TooltipContent>
          </Tooltip>

          {/* Gradient separator */}
          <div className="w-px h-4 bg-gradient-to-b from-transparent via-green-500/20 to-transparent flex-shrink-0" />

          {/* Processing clips */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5 px-3 py-1 rounded cursor-default hover:bg-orange-500/5 transition-colors duration-200 whitespace-nowrap">
                <Clock className="w-3 h-3 text-orange-500" />
                <span className="text-[11px] text-zinc-500">Processing</span>
                <span className="text-[11px] font-semibold text-orange-400">
                  <AnimatedNumber value={processingClips} format={formatProcessing} />
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="bg-zinc-800 text-zinc-200 border-zinc-700">
              <p>Clips currently being processed</p>
              {processingClips > 0 && (
                <p className="text-[10px] text-orange-400">Active processing in progress</p>
              )}
            </TooltipContent>
          </Tooltip>

          {/* Gradient separator */}
          <div className="w-px h-4 bg-gradient-to-b from-transparent via-orange-500/10 to-transparent flex-shrink-0" />

          {/* Average processing time */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5 px-3 py-1 rounded cursor-default hover:bg-cyan-500/5 transition-colors duration-200 whitespace-nowrap">
                <BarChart3 className="w-3 h-3 text-cyan-500" />
                <span className="text-[11px] text-zinc-500">Avg Time</span>
                <span className="text-[11px] font-semibold text-cyan-400">
                  <AnimatedNumber value={avgProcessingTime} format={formatAvgTime} />
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="bg-zinc-800 text-zinc-200 border-zinc-700">
              <p>Average processing time per clip</p>
              {completedWithTime.length > 0 && (
                <p className="text-[10px] text-zinc-400">Based on {completedWithTime.length} completed clip{completedWithTime.length !== 1 ? 's' : ''}</p>
              )}
            </TooltipContent>
          </Tooltip>

          {/* Gradient separator */}
          <div className="w-px h-4 bg-gradient-to-b from-transparent via-zinc-500/10 to-transparent flex-shrink-0" />

          {/* Total file size */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5 px-3 py-1 rounded cursor-default hover:bg-zinc-800/40 transition-colors duration-200 whitespace-nowrap">
                <HardDrive className="w-3 h-3 text-zinc-500" />
                <span className="text-[11px] text-zinc-500">Size</span>
                <span className="text-[11px] font-semibold text-zinc-300">
                  <AnimatedNumber value={totalFileSize} format={formatSize} />
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="bg-zinc-800 text-zinc-200 border-zinc-700">
              <p>Total file size of all clips</p>
              <p className="text-[10px] text-zinc-400">{totalClips} file{totalClips !== 1 ? 's' : ''} • Avg {totalClips > 0 ? formatFileSize(totalFileSize / totalClips) : '0 B'}</p>
            </TooltipContent>
          </Tooltip>

          {/* Gradient separator */}
          <div className="w-px h-4 bg-gradient-to-b from-transparent via-zinc-500/10 to-transparent flex-shrink-0" />

          {/* Total duration */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5 px-3 py-1 rounded cursor-default hover:bg-zinc-800/40 transition-colors duration-200 whitespace-nowrap">
                <Hourglass className="w-3 h-3 text-zinc-500" />
                <span className="text-[11px] text-zinc-500">Duration</span>
                <span className="text-[11px] font-semibold text-zinc-300">
                  <AnimatedNumber value={totalDuration} format={formatDuration} />
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="bg-zinc-800 text-zinc-200 border-zinc-700">
              <p>Total duration of all clips</p>
              <p className="text-[10px] text-zinc-400">{totalDuration.toFixed(1)}s • Avg {totalClips > 0 ? (totalDuration / totalClips).toFixed(1) : '0'}s per clip</p>
            </TooltipContent>
          </Tooltip>

          {/* Spacer */}
          <div className="flex-1 min-w-4" />

          {/* Completion rate with progress bar + shimmer */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2 px-3 py-1 rounded cursor-default hover:bg-zinc-800/40 transition-colors duration-200 whitespace-nowrap">
                <span className="text-[11px] text-zinc-500">Progress</span>
                <div className="w-24 h-2 bg-zinc-800 rounded-full overflow-hidden progress-shimmer">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-orange-500 to-cyan-500 transition-all duration-500 ease-out"
                    style={{ width: `${completionRate}%` }}
                  />
                </div>
                <span className="text-[10px] font-semibold text-zinc-400 tabular-nums w-8 text-right">
                  {totalClips > 0 ? `${Math.round(completionRate)}%` : '—'}
                </span>
                {/* Active processing indicator */}
                {isProcessing && (
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="bg-zinc-800 text-zinc-200 border-zinc-700">
              <p>Overall completion rate ({completedClips}/{totalClips} clips)</p>
              {totalClips > 0 && (
                <p className="text-[10px] text-zinc-400">{clips.filter(c => c.status === 'error').length} failed • {clips.filter(c => c.status === 'uploaded').length} pending</p>
              )}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
