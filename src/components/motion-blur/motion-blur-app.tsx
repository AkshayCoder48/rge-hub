'use client';

import React, { useState, useRef, useCallback } from 'react';
import { VideoMotionBlurProcessor } from '@/lib/video';
import type { MotionBlurConfig, VideoMetadata, ProcessingProgress, ProcessingResult } from '@/lib/video';
import { VideoUploader } from './video-uploader';
import { BlurControls } from './blur-controls';
import { ProcessingProgressBar } from './processing-progress';
import { VideoPreviewPanel } from './video-preview';
import { OutputPanel } from './output-panel';
import { useToast } from '@/hooks/use-toast';

type Phase = 'upload' | 'configure' | 'processing' | 'done';

export function MotionBlurApp() {
  const [phase, setPhase] = useState<Phase>('upload');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [videoMetadata, setVideoMetadata] = useState<VideoMetadata | null>(null);
  const [progress, setProgress] = useState<ProcessingProgress | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const processorRef = useRef<VideoMotionBlurProcessor | null>(null);
  const { toast } = useToast();

  // Handle file selected from upload zone
  const handleFileSelected = useCallback((file: File, metadata: VideoMetadata) => {
    setSelectedFile(file);
    setVideoMetadata(metadata);
    setPhase('configure');
  }, []);

  // Handle apply — start processing
  const handleApply = useCallback(
    async (config: MotionBlurConfig) => {
      if (!selectedFile) return;

      const processor = new VideoMotionBlurProcessor();
      processorRef.current = processor;

      setPhase('processing');
      setIsProcessing(true);
      setProgress(null);
      setResult(null);

      try {
        const processingResult = await processor.process(
          selectedFile,
          config,
          (p: ProcessingProgress) => {
            setProgress(p);
          }
        );

        setResult(processingResult);
        setPhase('done');
        setIsProcessing(false);

        toast({
          title: 'Motion blur applied!',
          description: `${processingResult.filename} — ${(processingResult.blob.size / (1024 * 1024)).toFixed(1)} MB`,
        });
      } catch (err) {
        setIsProcessing(false);
        if (err instanceof DOMException && err.name === 'AbortError') {
          // User cancelled
          setPhase('configure');
          setProgress(null);
          toast({ title: 'Processing cancelled', description: 'You can adjust settings and try again.' });
        } else {
          const message = err instanceof Error ? err.message : 'Processing failed';
          setPhase('configure');
          setProgress(null);
          toast({ title: 'Processing failed', description: message, variant: 'destructive' });
        }
      } finally {
        processorRef.current = null;
      }
    },
    [selectedFile, toast]
  );

  // Handle cancel
  const handleCancel = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.cancel();
    }
  }, []);

  // Handle download
  const handleDownload = useCallback(() => {
    if (!result) return;
    const url = URL.createObjectURL(result.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [result]);

  // Handle reset — go back to upload
  const handleReset = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.cancel();
      processorRef.current = null;
    }
    setSelectedFile(null);
    setVideoMetadata(null);
    setProgress(null);
    setIsProcessing(false);
    setResult(null);
    setPhase('upload');
  }, []);

  return (
    <div className="space-y-6">
      {phase === 'upload' && (
        <VideoUploader onFileSelected={handleFileSelected} />
      )}

      {phase === 'configure' && videoMetadata && (
        <div className="space-y-6 animate-fade-in">
          {/* File info summary */}
          <div className="w-full max-w-2xl mx-auto">
            <div className="rounded-2xl bg-[#0f0f17] border border-white/5 p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-orange-500/10 flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4 text-orange-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium text-white/80 truncate">{videoMetadata.filename}</h3>
                    <p className="text-xs text-white/30 mt-0.5">
                      {videoMetadata.width}×{videoMetadata.height} · {Math.round(videoMetadata.fps)}fps · {videoMetadata.duration.toFixed(1)}s
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleReset}
                  className="text-xs text-white/30 hover:text-white/60 transition-colors shrink-0 ml-3"
                >
                  Change video
                </button>
              </div>
            </div>
          </div>
          <BlurControls onApply={handleApply} disabled={isProcessing} />
        </div>
      )}

      {phase === 'processing' && (
        <div className="space-y-6 animate-fade-in">
          <ProcessingProgressBar
            progress={progress}
            isProcessing={isProcessing}
            onCancel={handleCancel}
          />
        </div>
      )}

      {phase === 'done' && result && selectedFile && (
        <div className="space-y-6 animate-fade-in">
          <VideoPreviewPanel
            originalFile={selectedFile}
            processedBlob={result.blob}
          />
          <OutputPanel
            result={result}
            onDownload={handleDownload}
            onReset={handleReset}
          />
        </div>
      )}
    </div>
  );
}
