'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore, formatDuration } from '@/lib/store';
import type { SpeedRampPoint } from '@/lib/types';
import { Input } from '@/components/ui/input';

function interpolateSpeed(ramps: SpeedRampPoint[], time: number): number {
  if (ramps.length === 0) return 1;
  if (ramps.length === 1) return ramps[0].speed;
  if (time <= ramps[0].time) return ramps[0].speed;
  if (time >= ramps[ramps.length - 1].time) return ramps[ramps.length - 1].speed;
  for (let i = 0; i < ramps.length - 1; i++) {
    if (time >= ramps[i].time && time <= ramps[i + 1].time) {
      const t = (time - ramps[i].time) / (ramps[i + 1].time - ramps[i].time);
      return ramps[i].speed + t * (ramps[i + 1].speed - ramps[i].speed);
    }
  }
  return 1;
}

interface TimelineTrimmerProps { clipId: string; }

export function TimelineTrimmer({ clipId }: TimelineTrimmerProps) {
  const clip = useAppStore((s) => s.clips.find((c) => c.id === clipId));
  const setClipTrim = useAppStore((s) => s.setClipTrim);
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null);
  const [editField, setEditField] = useState<'start' | 'end' | null>(null);
  const [editValue, setEditValue] = useState('');

  const pxToTime = useCallback((px: number) => {
    if (!clip || !trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(1, px / rect.width)) * clip.duration * 100) / 100;
  }, [clip]);

  const timeToPercent = useCallback((time: number) => {
    if (!clip || clip.duration === 0) return 0;
    return (time / clip.duration) * 100;
  }, [clip]);

  useEffect(() => {
    if (!dragging || !clip) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const time = pxToTime(e.clientX - rect.left);
      if (dragging === 'start') setClipTrim(clipId, Math.max(0, Math.min(time, clip.trimEnd - 0.1)), clip.trimEnd);
      else setClipTrim(clipId, clip.trimStart, Math.min(clip.duration, Math.max(time, clip.trimStart + 0.1)));
    };
    const handleMouseUp = () => setDragging(null);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [dragging, clip, clipId, setClipTrim, pxToTime]);

  const commitEdit = useCallback(() => {
    if (!clip || !editField) return;
    const val = parseFloat(editValue);
    if (isNaN(val)) { setEditField(null); return; }
    if (editField === 'start') setClipTrim(clipId, Math.max(0, Math.min(val, clip.trimEnd - 0.1)), clip.trimEnd);
    else setClipTrim(clipId, clip.trimStart, Math.min(clip.duration, Math.max(val, clip.trimStart + 0.1)));
    setEditField(null);
  }, [clip, clipId, editField, editValue, setClipTrim]);

  const miniSpeedPath = useMemo(() => {
    if (!clip || clip.speedRamps.length < 2) return null;
    const steps = 100;
    const points: string[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * clip.duration;
      const speed = interpolateSpeed(clip.speedRamps, t);
      const x = (i / steps) * 100;
      const normalizedSpeed = (speed - 0.25) / (4.0 - 0.25);
      points.push(`${x},${100 - normalizedSpeed * 100}`);
    }
    return points.join(' ');
  }, [clip]);

  if (!clip) return (
    <div className="flex items-center justify-center h-[80px] bg-[#0f0f17] rounded-lg border border-white/5">
      <p className="text-white/30 text-sm">No clip selected</p>
    </div>
  );

  const startPercent = timeToPercent(clip.trimStart);
  const endPercent = timeToPercent(clip.trimEnd);
  const trimmedDuration = clip.trimEnd - clip.trimStart;

  return (
    <div className="bg-[#0f0f17] rounded-lg border border-white/5 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5">
        <span className="text-white/70 text-xs font-medium uppercase tracking-wider">Timeline Trimmer</span>
        <div className="flex items-center gap-3">
          <span className="text-white/40 text-xs">Duration: <span className="text-white/70 font-mono">{formatDuration(clip.duration)}</span></span>
          <span className="text-orange-400/70 text-xs">Trimmed: <span className="text-orange-400 font-mono font-bold">{formatDuration(trimmedDuration)}</span></span>
        </div>
      </div>
      <div className="p-4">
        <div className="relative mb-4">
          <div className="flex justify-between mb-1.5 px-0">
            <span className="text-white/40 text-[10px] font-mono">0:00.00</span>
            <span className="text-white/40 text-[10px] font-mono">{formatDuration(clip.duration / 2)}</span>
            <span className="text-white/40 text-[10px] font-mono">{formatDuration(clip.duration)}</span>
          </div>
          <div ref={trackRef} className="relative h-14 rounded-md cursor-pointer overflow-hidden" style={{ userSelect: 'none' }}>
            <div className="absolute inset-0 bg-white/5 rounded-md" />
            <div className="absolute top-0 left-0 h-full bg-white/[0.02] border-r border-white/5" style={{ width: `${startPercent}%` }} />
            <div className="absolute top-0 h-full bg-gradient-to-r from-orange-500/20 via-orange-400/15 to-orange-500/20 border-x border-orange-400/30"
              style={{ left: `${startPercent}%`, width: `${endPercent - startPercent}%` }}>
              {miniSpeedPath && (
                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ opacity: 0.6 }}>
                  <defs><linearGradient id={`miniSpeedGrad-${clipId}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.6" /><stop offset="100%" stopColor="#f97316" stopOpacity="0.15" />
                  </linearGradient></defs>
                  <polyline points={miniSpeedPath} fill="none" stroke="#f97316" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                  <polygon points={`0,100 ${miniSpeedPath} 100,100`} fill={`url(#miniSpeedGrad-${clipId})`} />
                </svg>
              )}
            </div>
            <div className="absolute top-0 right-0 h-full bg-white/[0.02] border-l border-white/5" style={{ width: `${100 - endPercent}%` }} />
            <div className="absolute top-0 h-full w-0.5 bg-orange-400 z-10" style={{ left: `${startPercent}%` }} />
            <div className="absolute top-0 h-full w-0.5 bg-orange-400 z-10" style={{ left: `${endPercent}%` }} />
            {/* Handles */}
            <div className="absolute top-0 h-full z-20 flex items-center" style={{ left: `${startPercent}%`, transform: 'translateX(-50%)', cursor: 'ew-resize' }}
              onMouseDown={(e) => { e.preventDefault(); setDragging('start'); }}>
              <div className="w-4 h-full flex flex-col items-center justify-center gap-0.5">
                <div className="w-1 h-1 rounded-full bg-cyan-400" /><div className="w-1 h-1 rounded-full bg-cyan-400" /><div className="w-1 h-1 rounded-full bg-cyan-400" />
              </div>
            </div>
            <div className="absolute top-0 h-full z-20 flex items-center" style={{ left: `${endPercent}%`, transform: 'translateX(-50%)', cursor: 'ew-resize' }}
              onMouseDown={(e) => { e.preventDefault(); setDragging('end'); }}>
              <div className="w-4 h-full flex flex-col items-center justify-center gap-0.5">
                <div className="w-1 h-1 rounded-full bg-cyan-400" /><div className="w-1 h-1 rounded-full bg-cyan-400" /><div className="w-1 h-1 rounded-full bg-cyan-400" />
              </div>
            </div>
          </div>
          <div className="relative h-5 mt-1">
            <div className="absolute transform -translate-x-1/2" style={{ left: `${startPercent}%` }}>
              <div className="bg-cyan-400/10 border border-cyan-400/30 rounded px-1.5 py-0.5">
                <span className="text-cyan-400 text-[9px] font-mono whitespace-nowrap">{formatDuration(clip.trimStart)}</span>
              </div>
            </div>
            <div className="absolute transform -translate-x-1/2" style={{ left: `${endPercent}%` }}>
              <div className="bg-cyan-400/10 border border-cyan-400/30 rounded px-1.5 py-0.5">
                <span className="text-cyan-400 text-[9px] font-mono whitespace-nowrap">{formatDuration(clip.trimEnd)}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="text-white/40 text-[10px] uppercase tracking-wider mb-1 block">Trim Start (s)</label>
            {editField === 'start' ? (
              <Input type="text" value={editValue} onChange={(e) => setEditValue(e.target.value)} onBlur={commitEdit}
                onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditField(null); }}
                className="h-7 text-xs font-mono bg-white/5 border-white/10 text-white/80 focus:border-cyan-400/50" autoFocus />
            ) : (
              <div className="h-7 px-3 flex items-center rounded-md border border-white/10 bg-white/5 cursor-pointer hover:border-cyan-400/30 transition-colors"
                onClick={() => { setEditField('start'); setEditValue(clip.trimStart.toFixed(2)); }}>
                <span className="text-xs font-mono text-white/60">{clip.trimStart.toFixed(2)}s</span>
              </div>
            )}
          </div>
          <div className="flex items-center pt-4">
            <svg className="w-4 h-4 text-white/20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
          </div>
          <div className="flex-1">
            <label className="text-white/40 text-[10px] uppercase tracking-wider mb-1 block">Trim End (s)</label>
            {editField === 'end' ? (
              <Input type="text" value={editValue} onChange={(e) => setEditValue(e.target.value)} onBlur={commitEdit}
                onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditField(null); }}
                className="h-7 text-xs font-mono bg-white/5 border-white/10 text-white/80 focus:border-cyan-400/50" autoFocus />
            ) : (
              <div className="h-7 px-3 flex items-center rounded-md border border-white/10 bg-white/5 cursor-pointer hover:border-cyan-400/30 transition-colors"
                onClick={() => { setEditField('end'); setEditValue(clip.trimEnd.toFixed(2)); }}>
                <span className="text-xs font-mono text-white/60">{clip.trimEnd.toFixed(2)}s</span>
              </div>
            )}
          </div>
          <div className="pt-4">
            <div className="h-7 px-3 flex items-center rounded-md bg-orange-400/10 border border-orange-400/20">
              <span className="text-xs font-mono text-orange-400 font-semibold">{trimmedDuration.toFixed(2)}s</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
