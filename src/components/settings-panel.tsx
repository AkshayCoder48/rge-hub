'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  HardDrive,
  Trash2,
  AlertTriangle,
  Settings,
  Info,
  ExternalLink,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAppStore } from '@/lib/store';
import { toast } from 'sonner';

interface StorageInfo {
  uploadsSize: number;
  processedSize: number;
  uploadCount: number;
  processedCount: number;
  totalSize: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function SettingsPanel() {
  const {
    settingsOpen,
    setSettingsOpen,
    defaultPreset,
    setDefaultPreset,
    defaultAudio,
    setDefaultAudio,
  } = useAppStore();

  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [isLoadingStorage, setIsLoadingStorage] = useState(false);
  const [cleanupConfirm, setCleanupConfirm] = useState<'processed' | 'all' | null>(null);
  const [isCleaning, setIsCleaning] = useState(false);

  const fetchStorageInfo = useCallback(async () => {
    setIsLoadingStorage(true);
    try {
      const response = await fetch('/api/storage-info');
      if (response.ok) {
        const data = await response.json();
        setStorageInfo(data);
      }
    } catch (error) {
      console.error('Failed to fetch storage info:', error);
    } finally {
      setIsLoadingStorage(false);
    }
  }, []);

  useEffect(() => {
    if (settingsOpen) {
      fetchStorageInfo();
    }
  }, [settingsOpen, fetchStorageInfo]);

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && settingsOpen) {
        setSettingsOpen(false);
        setCleanupConfirm(null);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [settingsOpen, setSettingsOpen]);

  const handleCleanup = useCallback(async (type: 'processed' | 'all') => {
    setIsCleaning(true);
    try {
      const response = await fetch('/api/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });

      if (response.ok) {
        const result = await response.json();
        toast.success('Cleanup complete!', {
          description: `Deleted ${result.deletedCount} file(s), freed ${formatBytes(result.freedSpace)}.`,
          style: { background: '#052e16', border: '1px solid #16a34a', color: '#bbf7d0' },
        });
        fetchStorageInfo();
      } else {
        toast.error('Cleanup failed', {
          description: 'Could not delete files. Please try again.',
          style: { background: '#2a0a0a', border: '1px solid #dc2626', color: '#fecaca' },
        });
      }
    } catch (error) {
      console.error('Cleanup error:', error);
      toast.error('Cleanup failed', {
        description: 'An error occurred during cleanup.',
        style: { background: '#2a0a0a', border: '1px solid #dc2626', color: '#fecaca' },
      });
    } finally {
      setIsCleaning(false);
      setCleanupConfirm(null);
    }
  }, [fetchStorageInfo]);

  if (!settingsOpen) return null;

  const totalSize = storageInfo?.totalSize ?? 0;
  const uploadsSize = storageInfo?.uploadsSize ?? 0;
  const processedSize = storageInfo?.processedSize ?? 0;
  const uploadsPercent = totalSize > 0 ? (uploadsSize / totalSize) * 100 : 0;
  const processedPercent = totalSize > 0 ? (processedSize / totalSize) * 100 : 0;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] transition-opacity duration-300"
        onClick={() => { setSettingsOpen(false); setCleanupConfirm(null); }}
      />

      {/* Panel */}
      <div className="fixed top-0 right-0 bottom-0 w-full sm:w-96 bg-zinc-900/95 backdrop-blur-xl border-l border-zinc-800 z-[70] transform transition-transform duration-300 ease-out flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-orange-400" />
            <h2 className="text-sm font-semibold text-zinc-100">Settings</h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
            onClick={() => { setSettingsOpen(false); setCleanupConfirm(null); }}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6" style={{ scrollbarWidth: 'thin' }}>

          {/* Storage & Disk Usage */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <HardDrive className="w-3.5 h-3.5 text-zinc-400" />
              <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Storage & Disk Usage</h3>
            </div>

            {isLoadingStorage ? (
              <div className="flex items-center gap-2 text-zinc-500 text-xs py-4">
                <Loader2 className="w-3 h-3 animate-spin" />
                Loading...
              </div>
            ) : (
              <div className="space-y-3">
                {/* Usage bar */}
                <div className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-800">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] text-zinc-400">Total Used</span>
                    <span className="text-[11px] text-zinc-200 font-medium">{formatBytes(totalSize)}</span>
                  </div>
                  <div className="w-full h-3 bg-zinc-800 rounded-full overflow-hidden flex">
                    {totalSize > 0 && (
                      <>
                        <div
                          className="h-full bg-orange-500 transition-all duration-500"
                          style={{ width: `${uploadsPercent}%` }}
                        />
                        <div
                          className="h-full bg-cyan-500 transition-all duration-500"
                          style={{ width: `${processedPercent}%` }}
                        />
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-4 mt-2">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-orange-500" />
                      <span className="text-[10px] text-zinc-400">Uploads</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-cyan-500" />
                      <span className="text-[10px] text-zinc-400">Processed</span>
                    </div>
                  </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-zinc-800/30 rounded-md p-2.5 border border-zinc-800/50">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                      <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Uploads</span>
                    </div>
                    <p className="text-sm font-medium text-orange-400">{formatBytes(uploadsSize)}</p>
                    <p className="text-[10px] text-zinc-500">{storageInfo?.uploadCount ?? 0} file(s)</p>
                  </div>
                  <div className="bg-zinc-800/30 rounded-md p-2.5 border border-zinc-800/50">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-500" />
                      <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Processed</span>
                    </div>
                    <p className="text-sm font-medium text-cyan-400">{formatBytes(processedSize)}</p>
                    <p className="text-[10px] text-zinc-500">{storageInfo?.processedCount ?? 0} file(s)</p>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* File Cleanup */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Trash2 className="w-3.5 h-3.5 text-zinc-400" />
              <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">File Cleanup</h3>
            </div>

            <div className="space-y-2">
              {/* Clear Processed */}
              {cleanupConfirm === 'processed' ? (
                <div className="bg-red-950/30 border border-red-500/30 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2 text-red-400">
                    <AlertTriangle className="w-4 h-4" />
                    <span className="text-xs font-medium">Delete all processed files?</span>
                  </div>
                  <p className="text-[10px] text-red-400/70">This will permanently remove all processed video files. This action cannot be undone.</p>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      className="h-7 text-[11px] px-3 bg-red-600 hover:bg-red-700 text-white"
                      onClick={() => handleCleanup('processed')}
                      disabled={isCleaning}
                    >
                      {isCleaning ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Trash2 className="w-3 h-3 mr-1" />}
                      Confirm Delete
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-[11px] px-3 text-zinc-400 hover:text-zinc-200"
                      onClick={() => setCleanupConfirm(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="outline"
                  className="w-full h-9 text-xs justify-start gap-2 bg-zinc-800/50 border-zinc-700 text-zinc-300 hover:bg-red-950/30 hover:border-red-500/30 hover:text-red-400 transition-all"
                  onClick={() => setCleanupConfirm('processed')}
                  disabled={isCleaning}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear Processed Files
                  <span className="ml-auto text-[10px] text-zinc-500">{storageInfo?.processedCount ?? 0} files</span>
                </Button>
              )}

              {/* Clear All */}
              {cleanupConfirm === 'all' ? (
                <div className="bg-red-950/30 border border-red-500/30 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2 text-red-400">
                    <AlertTriangle className="w-4 h-4" />
                    <span className="text-xs font-medium">Delete ALL files?</span>
                  </div>
                  <p className="text-[10px] text-red-400/70">This will permanently remove both uploaded and processed files. This action cannot be undone.</p>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      className="h-7 text-[11px] px-3 bg-red-600 hover:bg-red-700 text-white"
                      onClick={() => handleCleanup('all')}
                      disabled={isCleaning}
                    >
                      {isCleaning ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Trash2 className="w-3 h-3 mr-1" />}
                      Delete Everything
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-[11px] px-3 text-zinc-400 hover:text-zinc-200"
                      onClick={() => setCleanupConfirm(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="outline"
                  className="w-full h-9 text-xs justify-start gap-2 bg-zinc-800/50 border-zinc-700 text-zinc-300 hover:bg-red-950/30 hover:border-red-500/30 hover:text-red-400 transition-all"
                  onClick={() => setCleanupConfirm('all')}
                  disabled={isCleaning}
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Clear All Files
                  <span className="ml-auto text-[10px] text-zinc-500">{(storageInfo?.uploadCount ?? 0) + (storageInfo?.processedCount ?? 0)} files</span>
                </Button>
              )}
            </div>
          </section>

          {/* Default Settings */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Settings className="w-3.5 h-3.5 text-zinc-400" />
              <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Default Settings</h3>
            </div>

            <div className="space-y-4">
              {/* Default Processing Preset */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-zinc-300">Processing Preset</p>
                  <p className="text-[10px] text-zinc-500">Default mode for new sessions</p>
                </div>
                <Select
                  value={defaultPreset}
                  onValueChange={(value: 'turbo' | 'quality') => setDefaultPreset(value)}
                >
                  <SelectTrigger className="w-28 h-8 text-xs bg-zinc-800 border-zinc-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    <SelectItem value="turbo" className="text-xs text-orange-400 focus:text-orange-300 focus:bg-orange-500/10">
                      <span className="flex items-center gap-1.5">
                        🚀 Turbo
                      </span>
                    </SelectItem>
                    <SelectItem value="quality" className="text-xs text-cyan-400 focus:text-cyan-300 focus:bg-cyan-500/10">
                      <span className="flex items-center gap-1.5">
                        ✨ Quality
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Default Audio Handling */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-zinc-300">Audio Track</p>
                  <p className="text-[10px] text-zinc-500">Add silent audio to output</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-500">{defaultAudio ? 'On' : 'Off'}</span>
                  <Switch
                    checked={defaultAudio}
                    onCheckedChange={setDefaultAudio}
                    className="data-[state=checked]:bg-green-500 data-[state=unchecked]:bg-zinc-700"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* About */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Info className="w-3.5 h-3.5 text-zinc-400" />
              <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">About</h3>
            </div>

            <div className="bg-zinc-800/30 rounded-lg p-3 border border-zinc-800/50 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-zinc-500">Version</span>
                <span className="text-[11px] text-zinc-200 font-medium">v2.0</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-zinc-500">Framework</span>
                <span className="text-[11px] text-zinc-300">Next.js 16</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-zinc-500">Video Engine</span>
                <span className="text-[11px] text-zinc-300">FFmpeg</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-zinc-500">Styling</span>
                <span className="text-[11px] text-zinc-300">Tailwind CSS</span>
              </div>
              <div className="pt-1 border-t border-zinc-800/50">
                <a
                  href="https://github.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-[11px] text-orange-400 hover:text-orange-300 transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  View on GitHub
                </a>
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-800 bg-zinc-900/50">
          <div className="flex items-center gap-2 text-[10px] text-zinc-500">
            <CheckCircle2 className="w-3 h-3 text-green-500/50" />
            Auto Speed Ramping v2.0
          </div>
        </div>
      </div>
    </>
  );
}
