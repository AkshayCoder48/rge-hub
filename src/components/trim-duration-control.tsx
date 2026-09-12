'use client';

import { useCallback } from 'react';
import { useAppStore, formatDuration, MAX_AUTO_TRIM_DURATION } from '@/lib/store';
import { Scissors, Clock, AlertTriangle } from 'lucide-react';

interface TrimDurationControlProps {
  clipId: string;
}

export function TrimDurationControl({ clipId }: TrimDurationControlProps) {
  const clip = useAppStore((s) => s.clips.find((c) => c.id === clipId));
  const setClipTrimDuration = useAppStore((s) => s.setClipTrimDuration);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val) && val > 0) {
      setClipTrimDuration(clipId, Math.min(val, clip?.duration ?? MAX_AUTO_TRIM_DURATION));
    }
  }, [clipId, clip?.duration, setClipTrimDuration]);

  if (!clip) return null;

  const maxDuration = clip.duration;
  const trimDuration = clip.trimDuration;

  return (
    <div className="rounded-3xl border border-white/5 bg-white/[0.02] p-6">
      <div className="flex items-center gap-2 mb-4">
        <Scissors className="w-4 h-4 text-violet-400" />
        <h3 className="font-serif-display text-lg text-white">Trim Duration</h3>
        <span className="text-xs font-mono-display text-neutral-500 ml-auto">Source: {formatDuration(clip.duration)}</span>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Clock className="w-3.5 h-3.5 text-neutral-500" />
          <div className="flex-1">
            <input
              type="range"
              min={0.1}
              max={maxDuration}
              step={0.01}
              value={trimDuration}
              onChange={handleChange}
              className="w-full"
            />
          </div>
          <span className="text-sm font-mono-display text-violet-400 min-w-[60px] text-right">{trimDuration.toFixed(2)}s</span>
        </div>

        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] font-mono-display text-neutral-600">0.1s</span>
          <div className="flex items-center gap-1 flex-wrap">
            {[0.5, 1.0, 1.5, 2.0, 3.0, 5.0, 10.0, 15.0, 30.0].map((val) => (
              <button
                key={val}
                onClick={() => setClipTrimDuration(clipId, Math.min(val, maxDuration))}
                disabled={val > maxDuration}
                className={`px-2 py-1 rounded-lg text-[10px] font-mono-display transition-all duration-300 ease-snap ${
                  Math.abs(trimDuration - val) < 0.01
                    ? 'bg-violet-500/15 text-violet-400 border border-violet-500/30'
                    : val > maxDuration
                    ? 'bg-white/[0.02] text-neutral-700 cursor-not-allowed'
                    : 'bg-white/[0.03] text-neutral-400 border border-white/5 hover:text-white hover:border-white/15'
                }`}
              >
                {val}s
              </button>
            ))}
          </div>
          <span className="text-[10px] font-mono-display text-neutral-600">{maxDuration.toFixed(1)}s</span>
        </div>

        <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 mt-2">
          <p className="text-[11px] text-neutral-400 leading-relaxed">
            The first <span className="text-violet-400 font-mono-display">{trimDuration.toFixed(2)}s</span> of the original video will be used.
            Forward segment plays at 4x→0.6x, then reversed segment plays at 0.6x→4x. Both combined into one V-ramp clip.
          </p>
        </div>

        {trimDuration > 10 && (
          <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/15 mt-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-[11px] text-amber-400 font-medium">Long clip — slower processing</p>
                <p className="text-[10px] text-amber-400/60 mt-0.5 leading-relaxed">
                  Trim durations over 10s use chunked processing to avoid memory issues. Processing will take longer but will work reliably.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
