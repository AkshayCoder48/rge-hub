'use client';

import React, { useState } from 'react';
import { useAppStore, formatDuration, DEFAULT_CONFIG } from '@/lib/store';
import { Download, Loader2, Film, Settings2, Clock, Gauge, Scissors, Combine, Zap, ChevronDown, ChevronUp, Code2, Upload } from 'lucide-react';
import type { SpeedRampConfig } from '@/lib/types';
import { uploadInChunks, DIRECT_UPLOAD_LIMIT } from '@/lib/chunked-client';

interface ExportPanelProps { clipId: string; onPublish?: (file: File) => void; }

export function ExportPanel({ clipId, onPublish }: ExportPanelProps) {
  const clip = useAppStore((s) => s.clips.find((c) => c.id === clipId));
  const setClipStatus = useAppStore((s) => s.setClipStatus);
  const setClipProcessedBlob = useAppStore((s) => s.setClipProcessedBlob);
  const setClipConfig = useAppStore((s) => s.setClipConfig);
  const setProcessingState = useAppStore((s) => s.setProcessingState);
  const processingState = useAppStore((s) => s.processingState);
  const [showConfig, setShowConfig] = useState(false);
  const [showApiRef, setShowApiRef] = useState(false);

  if (!clip) return null;

  const config = clip.config || DEFAULT_CONFIG;
  const trimDuration = clip.trimDuration;

  // Accurate output duration using the integral formula
  function computeRampDuration(s0: number, s1: number, D: number): number {
    const deltaS = s1 - s0;
    if (Math.abs(deltaS) < 0.001) return D / s0;
    return (D / deltaS) * Math.log(1 + deltaS / s0);
  }

  const speedStart = clip.speedRamps[0]?.speed ?? 4.0;
  const speedMid = clip.speedRamps[Math.floor(clip.speedRamps.length / 2)]?.speed ?? 0.6;
  const speedEnd = clip.speedRamps[clip.speedRamps.length - 1]?.speed ?? 4.0;

  const forwardDur = computeRampDuration(speedStart, speedMid, trimDuration / 2);
  const reversedDur = computeRampDuration(speedMid, speedEnd, trimDuration / 2);
  const estimatedDuration = config.reverse ? forwardDur + reversedDur : forwardDur;

  const handleProcess = async () => {
    if (!clip.originalFile) {
      setClipStatus(clipId, 'error', 'Original file not available. Please re-upload the video.');
      return;
    }

    // AbortController for timeout handling - 5 minute max
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000);

    try {
      setClipStatus(clipId, 'processing');
      setProcessingState({ isProcessing: true, progress: 0, currentClipId: clipId, message: `Processing ${config.mode} speed ramp...` });

      const progressInterval = setInterval(() => {
        setProcessingState({ progress: Math.min((useAppStore.getState().processingState.progress || 0) + Math.random() * 8, 90) });
      }, 500);

      // Build the full config to send to the API
      const apiConfig: SpeedRampConfig = {
        mode: config.mode,
        trimDuration: clip.trimDuration,
        trimStart: config.trimStart ?? 0,
        startSpeed: config.startSpeed,
        endSpeed: config.endSpeed,
        rampMid: config.rampMid,
        rampEnd: config.rampEnd,
        speedPoints: config.speedPoints,
        reverse: config.reverse ?? true,
        outputFps: config.outputFps ?? 30,
        crf: config.crf ?? 23,
        preset: config.preset ?? 'ultrafast',
        audioMode: config.audioMode ?? 'auto',
        outputFormat: config.outputFormat ?? 'mp4',
        outputScale: config.outputScale,
        codec: config.codec ?? 'libx264',
      };

      // Large files go chunked (defeats the ~4.5MB Vercel request cap);
      // small files keep the fast single-request path.
      let response: Response;
      if (clip.originalFile.size <= DIRECT_UPLOAD_LIMIT) {
        const formData = new FormData();
        formData.append('file', clip.originalFile);
        formData.append('config', JSON.stringify(apiConfig));

        response = await fetch('/api/speedramp', {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        });
      } else {
        setProcessingState({ message: 'Uploading video in chunks…', progress: 0 });
        const { uploadId } = await uploadInChunks(clip.originalFile, {
          signal: controller.signal,
          onProgress: (p) =>
            setProcessingState({
              progress: Math.round(p.pct * 0.3),
              message: `Uploading video… ${p.pct}%`,
            }),
        });
        setProcessingState({ message: `Processing ${config.mode} speed ramp...` });
        response = await fetch('/api/speedramp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uploadId, config: apiConfig }),
          signal: controller.signal,
        });
      }

      clearInterval(progressInterval);
      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorMsg = 'Failed to process video';
        try {
          const errorData = await response.json();
          errorMsg = errorData.error || errorMsg;
        } catch { /* Response might not be JSON */ }
        throw new Error(errorMsg);
      }

      const blob = await response.blob();
      setClipProcessedBlob(clipId, blob);
      setClipStatus(clipId, 'done');
      setProcessingState({ isProcessing: false, progress: 100, currentClipId: null, message: 'Complete!' });
    } catch (err) {
      clearTimeout(timeoutId);
      let message = 'Failed to process video';
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          message = 'Processing timed out after 5 minutes. Try using "ultrafast" preset, 30fps, and smaller trim duration for faster processing.';
        } else {
          message = err.message;
        }
      }
      setClipStatus(clipId, 'error', message);
      setProcessingState({ isProcessing: false, progress: 0, currentClipId: null, message: '' });
    }
  };

  const handleDownload = () => {
    if (!clip.processedBlob) return;
    const url = URL.createObjectURL(clip.processedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `speedramp_${clip.originalName.replace(/\.[^/.]+$/, '')}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handlePublish = () => {
    if (!clip.processedBlob || !onPublish) return;
    const name = `speedramp_${clip.originalName.replace(/\.[^/.]+$/, '')}.mp4`;
    onPublish(new File([clip.processedBlob], name, { type: 'video/mp4' }));
  };

  const handleClearResult = () => {
    setClipProcessedBlob(clipId, undefined as any);
    setClipStatus(clipId, 'ready');
  };

  const isProcessing = processingState.isProcessing && processingState.currentClipId === clipId;

  // Config update handlers
  const updateConfig = (key: keyof SpeedRampConfig, value: any) => {
    setClipConfig(clipId, { ...config, [key]: value });
  };

  const modeLabel = config.mode === 'vramp' ? 'V-Ramp' : config.mode === 'linear' ? 'Linear' : 'Custom';

  return (
    <div className="rounded-3xl border border-white/5 bg-white/[0.02] p-6">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Settings2 className="w-4 h-4 text-violet-400" />
        <h3 className="font-serif-display text-lg text-white">Export</h3>
        <button onClick={() => setShowConfig(!showConfig)}
          className="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg font-mono-display text-[10px] uppercase tracking-[0.2em] text-neutral-500 hover:text-white hover:bg-white/5 transition-all duration-300 ease-snap">
          {showConfig ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          Config
        </button>
      </div>

      {/* Config Panel */}
      {showConfig && (
        <div className="mb-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-4 animate-fade-in">
          {/* Mode Selection */}
          <div>
            <label className="font-mono-display text-[10px] uppercase tracking-[0.2em] text-neutral-500 block mb-1.5">Mode</label>
            <div className="flex gap-2">
              {(['vramp', 'linear', 'custom'] as const).map((m) => (
                <button key={m} onClick={() => updateConfig('mode', m)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-300 ease-snap ${
                    config.mode === m
                      ? 'bg-gradient-to-r from-violet-500/15 to-cyan-500/15 text-white border border-violet-500/30'
                      : 'bg-white/[0.03] text-neutral-500 border border-white/5 hover:text-white'
                  }`}>
                  {m === 'vramp' ? 'V-Ramp' : m === 'linear' ? 'Linear' : 'Custom'}
                </button>
              ))}
            </div>
          </div>

          {/* Speed Controls */}
          <div className="grid grid-cols-2 gap-3">
            {config.mode === 'vramp' ? (
              <>
                <div>
                  <label className="font-mono-display text-[10px] uppercase tracking-[0.2em] text-neutral-500 block mb-1">Start Speed</label>
                  <input type="number" step="0.1" min="0.1" max="50"
                    value={config.startSpeed ?? 4.0}
                    onChange={(e) => updateConfig('startSpeed', parseFloat(e.target.value))}
                    className="w-full px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 text-xs text-neutral-300 font-mono-display focus:border-violet-500/30 focus:outline-none" />
                </div>
                <div>
                  <label className="font-mono-display text-[10px] uppercase tracking-[0.2em] text-neutral-500 block mb-1">Mid Speed (V-bottom)</label>
                  <input type="number" step="0.1" min="0.1" max="50"
                    value={config.rampMid ?? 0.6}
                    onChange={(e) => updateConfig('rampMid', parseFloat(e.target.value))}
                    className="w-full px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 text-xs text-neutral-300 font-mono-display focus:border-violet-500/30 focus:outline-none" />
                </div>
                <div>
                  <label className="font-mono-display text-[10px] uppercase tracking-[0.2em] text-neutral-500 block mb-1">End Speed (Reversed)</label>
                  <input type="number" step="0.1" min="0.1" max="50"
                    value={config.rampEnd ?? 4.0}
                    onChange={(e) => updateConfig('rampEnd', parseFloat(e.target.value))}
                    className="w-full px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 text-xs text-neutral-300 font-mono-display focus:border-violet-500/30 focus:outline-none" />
                </div>
                <div>
                  <label className="font-mono-display text-[10px] uppercase tracking-[0.2em] text-neutral-500 block mb-1">Reverse</label>
                  <select value={config.reverse ? 'true' : 'false'}
                    onChange={(e) => updateConfig('reverse', e.target.value === 'true')}
                    className="w-full px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 text-xs text-neutral-300 font-mono-display focus:border-violet-500/30 focus:outline-none">
                    <option value="true">Yes (V-Ramp)</option>
                    <option value="false">No (Forward only)</option>
                  </select>
                </div>
              </>
            ) : config.mode === 'linear' ? (
              <>
                <div>
                  <label className="font-mono-display text-[10px] uppercase tracking-[0.2em] text-neutral-500 block mb-1">Start Speed</label>
                  <input type="number" step="0.1" min="0.1" max="50"
                    value={config.startSpeed ?? 4.0}
                    onChange={(e) => updateConfig('startSpeed', parseFloat(e.target.value))}
                    className="w-full px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 text-xs text-neutral-300 font-mono-display focus:border-violet-500/30 focus:outline-none" />
                </div>
                <div>
                  <label className="font-mono-display text-[10px] uppercase tracking-[0.2em] text-neutral-500 block mb-1">End Speed</label>
                  <input type="number" step="0.1" min="0.1" max="50"
                    value={config.endSpeed ?? 0.6}
                    onChange={(e) => updateConfig('endSpeed', parseFloat(e.target.value))}
                    className="w-full px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 text-xs text-neutral-300 font-mono-display focus:border-violet-500/30 focus:outline-none" />
                </div>
                <div>
                  <label className="font-mono-display text-[10px] uppercase tracking-[0.2em] text-neutral-500 block mb-1">Reverse</label>
                  <select value={config.reverse ? 'true' : 'false'}
                    onChange={(e) => updateConfig('reverse', e.target.value === 'true')}
                    className="w-full px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 text-xs text-neutral-300 font-mono-display focus:border-violet-500/30 focus:outline-none">
                    <option value="true">Yes (+ reversed)</option>
                    <option value="false">No (forward only)</option>
                  </select>
                </div>
                <div>
                  <label className="font-mono-display text-[10px] uppercase tracking-[0.2em] text-neutral-500 block mb-1">Audio Mode</label>
                  <select value={config.audioMode ?? 'auto'}
                    onChange={(e) => updateConfig('audioMode', e.target.value)}
                    className="w-full px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 text-xs text-neutral-300 font-mono-display focus:border-violet-500/30 focus:outline-none">
                    <option value="auto">Auto (preserve + adjust)</option>
                    <option value="strip">Strip (no audio)</option>
                    <option value="adjust">Adjust (match speed)</option>
                  </select>
                </div>
              </>
            ) : (
              <div className="col-span-2">
                <label className="font-mono-display text-[10px] uppercase tracking-[0.2em] text-neutral-500 block mb-1">Speed Points (time, speed)</label>
                <textarea
                  value={JSON.stringify(config.speedPoints || [], null, 2)}
                  onChange={(e) => {
                    try {
                      const pts = JSON.parse(e.target.value);
                      updateConfig('speedPoints', pts);
                    } catch { /* invalid JSON, keep current */ }
                  }}
                  rows={4}
                  className="w-full px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 text-xs text-neutral-300 font-mono-display focus:border-violet-500/30 focus:outline-none resize-none"
                  placeholder='[{"time":0,"speed":4},{"time":1,"speed":0.6}]' />
              </div>
            )}
          </div>

          {/* Quality Controls */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="font-mono-display text-[10px] uppercase tracking-[0.2em] text-neutral-500 block mb-1">Quality (CRF)</label>
              <select value={config.crf ?? 23}
                onChange={(e) => updateConfig('crf', parseInt(e.target.value))}
                className="w-full px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 text-xs text-neutral-300 font-mono-display focus:border-violet-500/30 focus:outline-none">
                <option value="0">0 (Lossless)</option>
                <option value="15">15 (Near-lossless)</option>
                <option value="18">18 (Visually lossless)</option>
                <option value="23">23 (Good)</option>
                <option value="28">28 (Acceptable)</option>
              </select>
            </div>
            <div>
              <label className="font-mono-display text-[10px] uppercase tracking-[0.2em] text-neutral-500 block mb-1">FPS</label>
              <select value={config.outputFps ?? 30}
                onChange={(e) => updateConfig('outputFps', parseInt(e.target.value))}
                className="w-full px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 text-xs text-neutral-300 font-mono-display focus:border-violet-500/30 focus:outline-none">
                <option value="24">24</option>
                <option value="30">30</option>
                <option value="60">60</option>
                <option value="90">90</option>
              </select>
            </div>
            <div>
              <label className="font-mono-display text-[10px] uppercase tracking-[0.2em] text-neutral-500 block mb-1">Preset</label>
              <select value={config.preset ?? 'ultrafast'}
                onChange={(e) => updateConfig('preset', e.target.value)}
                className="w-full px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 text-xs text-neutral-300 font-mono-display focus:border-violet-500/30 focus:outline-none">
                <option value="ultrafast">Ultrafast</option>
                <option value="veryfast">Veryfast</option>
                <option value="fast">Fast</option>
                <option value="medium">Medium</option>
                <option value="slow">Slow</option>
              </select>
            </div>
          </div>

          {/* Format & Codec */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="font-mono-display text-[10px] uppercase tracking-[0.2em] text-neutral-500 block mb-1">Format</label>
              <select value={config.outputFormat ?? 'mp4'}
                onChange={(e) => updateConfig('outputFormat', e.target.value)}
                className="w-full px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 text-xs text-neutral-300 font-mono-display focus:border-violet-500/30 focus:outline-none">
                <option value="mp4">MP4</option>
                <option value="mov">MOV</option>
                <option value="webm">WebM</option>
              </select>
            </div>
            <div>
              <label className="font-mono-display text-[10px] uppercase tracking-[0.2em] text-neutral-500 block mb-1">Codec</label>
              <select value={config.codec ?? 'libx264'}
                onChange={(e) => updateConfig('codec', e.target.value)}
                className="w-full px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 text-xs text-neutral-300 font-mono-display focus:border-violet-500/30 focus:outline-none">
                <option value="libx264">H.264</option>
                <option value="libx265">H.265 (HEVC)</option>
                <option value="libvpx-vp9">VP9 (WebM)</option>
              </select>
            </div>
            <div>
              <label className="font-mono-display text-[10px] uppercase tracking-[0.2em] text-neutral-500 block mb-1">Audio</label>
              <select value={config.audioMode ?? 'auto'}
                onChange={(e) => updateConfig('audioMode', e.target.value)}
                className="w-full px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 text-xs text-neutral-300 font-mono-display focus:border-violet-500/30 focus:outline-none">
                <option value="auto">Auto</option>
                <option value="strip">Strip</option>
                <option value="adjust">Adjust</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Summary Card */}
      <div className="grid grid-cols-2 gap-3 mb-4 p-3 rounded-2xl bg-white/[0.02] border border-white/5">
        <div className="flex items-center gap-2">
          <Combine className="w-3.5 h-3.5 text-neutral-500" />
          <div>
            <p className="font-mono-display text-[10px] uppercase tracking-[0.2em] text-neutral-600">Type</p>
            <p className="text-xs font-medium bg-gradient-to-r from-violet-400/80 to-cyan-400/80 bg-clip-text text-transparent">{modeLabel} Speed Ramp</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Gauge className="w-3.5 h-3.5 text-neutral-500" />
          <div>
            <p className="font-mono-display text-[10px] uppercase tracking-[0.2em] text-neutral-600">Speed</p>
            <p className="text-xs font-mono-display bg-gradient-to-r from-violet-400/80 to-cyan-400/80 bg-clip-text text-transparent">{speedStart}x → {speedMid}x → {speedEnd}x</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Scissors className="w-3.5 h-3.5 text-violet-400/60" />
          <div>
            <p className="font-mono-display text-[10px] uppercase tracking-[0.2em] text-neutral-600">Trim</p>
            <p className="text-xs text-neutral-300 font-mono-display">{trimDuration.toFixed(2)}s</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-cyan-400/60" />
          <div>
            <p className="font-mono-display text-[10px] uppercase tracking-[0.2em] text-neutral-600">Est. Duration</p>
            <p className="text-xs text-neutral-300 font-mono-display">~{formatDuration(estimatedDuration)}</p>
          </div>
        </div>
      </div>

      {/* Process + Download Buttons */}
      <div className="flex gap-2">
        <button onClick={handleProcess} disabled={isProcessing}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium transition-all duration-300 ease-snap ${
            isProcessing ? 'bg-violet-500/10 text-violet-400/60 cursor-not-allowed'
              : 'bg-gradient-to-r from-violet-500 to-cyan-500 text-white hover:from-violet-400 hover:to-cyan-400 shadow-[0_0_20px_-5px_rgba(139,92,246,0.4)]'
          }`}>
          {isProcessing ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</> : <><Film className="w-4 h-4" /> Process {modeLabel}</>}
        </button>
        {clip.processedBlob && (
          <>
            <button onClick={handleDownload}
              className="flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 transition-all duration-300 ease-snap">
              <Download className="w-4 h-4" /> Download
            </button>
            {onPublish && (
              <button onClick={handlePublish}
                title="Open the community uploader with this clip attached"
                className="flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium bg-[#ef233c]/10 text-[#ef233c] border border-[#ef233c]/25 hover:bg-[#ef233c]/20 transition-all duration-300 ease-snap">
                <Upload className="w-4 h-4" /> Upload to Community
              </button>
            )}
            <button onClick={handleClearResult} className="px-3 py-2.5 rounded-2xl text-xs text-neutral-700 hover:text-neutral-500 hover:bg-white/5 transition-all duration-300 ease-snap">Clear</button>
          </>
        )}
      </div>

      {/* API Reference Toggle */}
      <div className="mt-3">
        <button onClick={() => setShowApiRef(!showApiRef)}
          className="flex items-center gap-1.5 font-mono-display text-[10px] uppercase tracking-[0.2em] text-neutral-500 hover:text-white transition-all duration-300 ease-snap">
          <Code2 className="w-3 h-3" />
          {showApiRef ? 'Hide API Reference' : 'Show API Reference'}
        </button>
        {showApiRef && (
          <div className="mt-2 p-3 rounded-2xl bg-black/40 border border-white/5">
            <p className="font-mono-display text-[10px] uppercase tracking-[0.2em] text-neutral-600 mb-2">Use this API endpoint directly:</p>
            <div className="rounded-lg bg-[#0a0a0f] p-3 overflow-x-auto custom-scrollbar">
              <pre className="text-[10px] font-mono-display text-neutral-500 whitespace-pre">
{`curl -X POST /api/speedramp \
  -F "file=@${clip.originalName}" \
  -F "config=${JSON.stringify({
    mode: config.mode,
    trimDuration: clip.trimDuration,
    startSpeed: config.startSpeed,
    endSpeed: config.endSpeed,
    rampMid: config.rampMid,
    rampEnd: config.rampEnd,
    reverse: config.reverse,
    outputFps: config.outputFps,
    crf: config.crf,
    preset: config.preset,
    audioMode: config.audioMode,
    outputFormat: config.outputFormat,
    codec: config.codec,
  }, null, 2)}"
                `}
              </pre>
            </div>
            <p className="font-mono-display text-[9px] text-neutral-700 mt-1.5">
              <span className="text-cyan-400/60">GET /api/speedramp</span> for full API documentation & all parameters
            </p>
          </div>
        )}
      </div>

      {/* Error Display */}
      {clip.status === 'error' && clip.error && (
        <div className="mt-3 p-3 rounded-lg bg-red-500/5 border border-red-500/20">
          <p className="text-xs text-red-400">{clip.error}</p>
        </div>
      )}
    </div>
  );
}
