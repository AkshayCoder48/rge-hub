'use client';

import React, { useState, useCallback } from 'react';
import { useAppStore } from '@/lib/store';
import { PlayCircle, Loader2, CheckCircle2, AlertCircle, Film, Combine, Download } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface ProcessAllProgress {
  clipId: string;
  clipName: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  error?: string;
}

export function ProcessAll() {
  const clips = useAppStore((s) => s.clips);
  const setClipStatus = useAppStore((s) => s.setClipStatus);
  const setClipProcessedBlob = useAppStore((s) => s.setClipProcessedBlob);
  const setProcessingState = useAppStore((s) => s.setProcessingState);
  const processingState = useAppStore((s) => s.processingState);
  const { toast } = useToast();
  const [isProcessingAll, setIsProcessingAll] = useState(false);
  const [progressItems, setProgressItems] = useState<ProcessAllProgress[]>([]);

  const processableClips = clips.filter((c) => c.status === 'ready' || c.status === 'error');

  const handleProcessAll = useCallback(async () => {
    if (processableClips.length === 0) return;

    // Check all clips have originalFile
    const clipsWithoutFile = processableClips.filter((c) => !c.originalFile);
    if (clipsWithoutFile.length > 0) {
      toast({
        title: 'Some clips missing original files',
        description: `${clipsWithoutFile.length} clip(s) need to be re-uploaded.`,
        variant: 'destructive',
      });
      return;
    }

    setIsProcessingAll(true);

    const items = processableClips.map((c) => ({
      clipId: c.id, clipName: c.originalName, status: 'pending' as const,
    }));
    setProgressItems(items);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < processableClips.length; i++) {
      const clip = processableClips[i];
      setProgressItems((prev) => prev.map((p) => p.clipId === clip.id ? { ...p, status: 'processing' } : p));
      setClipStatus(clip.id, 'processing');
      setProcessingState({ isProcessing: true, progress: Math.round((i / processableClips.length) * 100), currentClipId: clip.id, message: `Processing ${i + 1}/${processableClips.length}` });

      try {
        const formData = new FormData();
        formData.append('file', clip.originalFile!);
        formData.append('config', JSON.stringify({
          ...clip.config,
          trimDuration: clip.trimDuration,
        }));

        const response = await fetch('/api/speedramp', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          let errorMsg = 'Failed to process video';
          try {
            const errorData = await response.json();
            errorMsg = errorData.error || errorMsg;
          } catch { /* ignore */ }
          throw new Error(errorMsg);
        }

        const blob = await response.blob();
        setClipProcessedBlob(clip.id, blob);
        setClipStatus(clip.id, 'done');
        setProgressItems((prev) => prev.map((p) => p.clipId === clip.id ? { ...p, status: 'done' } : p));
        successCount++;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed';
        setClipStatus(clip.id, 'error', message);
        setProgressItems((prev) => prev.map((p) => p.clipId === clip.id ? { ...p, status: 'error', error: message } : p));
        failCount++;
      }
    }

    setProcessingState({ isProcessing: false, progress: 100, currentClipId: null, message: '' });
    setIsProcessingAll(false);
    toast({ title: 'Batch processing complete', description: `${successCount} succeeded, ${failCount} failed.`, variant: failCount > 0 ? 'destructive' : 'default' });
  }, [processableClips, setClipStatus, setClipProcessedBlob, setProcessingState, toast]);

  const handleDownloadAll = useCallback(async () => {
    const doneClips = clips.filter((c) => c.status === 'done' && c.processedBlob);
    if (doneClips.length === 0) return;

    for (const clip of doneClips) {
      if (clip.processedBlob) {
        const url = URL.createObjectURL(clip.processedBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `speedramp_${clip.originalName.replace(/\.[^/.]+$/, '')}.mp4`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    }
  }, [clips]);

  if (clips.length === 0) return null;
  const doneCount = clips.filter((c) => c.status === 'done' && c.processedBlob).length;

  return (
    <div className="rounded-2xl bg-[#0f0f17] border border-white/5 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Film className="w-4 h-4 text-orange-400" />
        <h3 className="text-sm font-medium text-white/70">Batch Process</h3>
        <span className="text-xs text-white/20 ml-auto">{doneCount}/{clips.length} done</span>
      </div>

      {progressItems.length > 0 && (
        <div className="space-y-1.5 mb-4 max-h-40 overflow-y-auto custom-scrollbar">
          {progressItems.map((item) => (
            <div key={item.clipId} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.02] border border-white/5">
              {item.status === 'pending' && <div className="w-4 h-4 rounded-full border border-white/10 shrink-0" />}
              {item.status === 'processing' && <Loader2 className="w-4 h-4 text-orange-400 animate-spin shrink-0" />}
              {item.status === 'done' && <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />}
              {item.status === 'error' && <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />}
              <Combine className="w-3 h-3 text-white/30 shrink-0" />
              <span className="text-xs text-white/50 truncate flex-1">{item.clipName}</span>
              {item.status === 'processing' && <span className="text-[10px] text-orange-400/70 animate-pulse">Processing...</span>}
              {item.status === 'done' && <span className="text-[10px] text-cyan-400/70">Done</span>}
              {item.status === 'error' && <span className="text-[10px] text-red-400/70">Failed</span>}
            </div>
          ))}
        </div>
      )}

      {isProcessingAll && (
        <div className="w-full h-1.5 rounded-full bg-white/5 mb-4 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-cyan-400 transition-all duration-500" style={{ width: `${processingState.progress}%` }} />
        </div>
      )}

      <button onClick={handleProcessAll} disabled={isProcessingAll || processableClips.length === 0 || processingState.isProcessing}
        className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
          isProcessingAll || processingState.isProcessing ? 'bg-orange-500/10 text-orange-400/60 cursor-not-allowed' :
          processableClips.length === 0 ? 'bg-white/[0.03] text-white/20 cursor-not-allowed' :
          'bg-gradient-to-r from-orange-500 to-cyan-500 text-white hover:from-orange-400 hover:to-cyan-400 shadow-lg shadow-orange-500/20'
        }`}>
        {isProcessingAll || processingState.isProcessing ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Processing {processableClips.length} clip{processableClips.length > 1 ? 's' : ''}...</>
        ) : (
          <><PlayCircle className="w-4 h-4" /> Process All ({processableClips.length})</>
        )}
      </button>

      {/* Download all button */}
      {doneCount > 0 && (
        <button onClick={handleDownloadAll}
          className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 transition-all">
          <Download className="w-4 h-4" /> Download All ({doneCount})
        </button>
      )}

      {processableClips.length === 0 && clips.length > 0 && (
        <p className="text-[10px] text-white/20 mt-2 text-center">All clips have been processed</p>
      )}
    </div>
  );
}
