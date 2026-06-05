'use client';

import React, { useState, useEffect } from 'react';
import { Activity, ChevronDown, ChevronRight, Trash2, Upload, Cpu, Download, AlertCircle, Trash } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/lib/store';

const TYPE_CONFIG: Record<string, { color: string; dotColor: string; icon: React.ReactNode }> = {
  upload: {
    color: 'text-orange-400',
    dotColor: 'bg-orange-400',
    icon: <Upload className="w-3 h-3" />,
  },
  process: {
    color: 'text-cyan-400',
    dotColor: 'bg-cyan-400',
    icon: <Cpu className="w-3 h-3" />,
  },
  export: {
    color: 'text-green-400',
    dotColor: 'bg-green-400',
    icon: <Download className="w-3 h-3" />,
  },
  error: {
    color: 'text-red-400',
    dotColor: 'bg-red-400',
    icon: <AlertCircle className="w-3 h-3" />,
  },
  cleanup: {
    color: 'text-zinc-400',
    dotColor: 'bg-zinc-400',
    icon: <Trash className="w-3 h-3" />,
  },
};

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function RelativeTime({ timestamp }: { timestamp: number }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setTick(prev => prev + 1);
    }, 10000); // Update every 10s
    return () => clearInterval(interval);
  }, []);

  return <span className="text-[10px] text-zinc-600 whitespace-nowrap">{formatRelativeTime(timestamp)}</span>;
}

export function ActivityLog() {
  const { activityLog, clearActivityLog } = useAppStore();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-lg overflow-hidden">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/40 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-orange-400" />
              <span className="text-xs font-medium text-zinc-300 uppercase tracking-wider">
                Activity Log
              </span>
              {activityLog.length > 0 && (
                <span className="inline-flex items-center justify-center min-w-[16px] h-[16px] text-[9px] font-semibold bg-orange-500/15 text-orange-400 rounded-full px-1">
                  {activityLog.length}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-zinc-500">
              <span className="text-[10px]">{isOpen ? 'Hide' : 'Show'}</span>
              {isOpen ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-4 pb-4 pt-1">
            {activityLog.length === 0 ? (
              <div className="text-center py-6">
                <Activity className="w-6 h-6 text-zinc-700 mx-auto mb-2" />
                <p className="text-xs text-zinc-600">No activity yet</p>
              </div>
            ) : (
              <>
                <div className="max-h-48 overflow-y-auto custom-scrollbar pr-1 space-y-0.5">
                  {activityLog.map((entry) => {
                    const config = TYPE_CONFIG[entry.type] || TYPE_CONFIG.cleanup;
                    return (
                      <div
                        key={entry.id}
                        className="flex items-center gap-2.5 py-1.5 px-2 rounded-md hover:bg-zinc-800/30 transition-colors group"
                      >
                        {/* Colored dot indicator */}
                        <div className={`w-1.5 h-1.5 rounded-full ${config.dotColor} flex-shrink-0`} />

                        {/* Activity message */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-zinc-300 truncate">
                              {entry.message}
                            </span>
                          </div>
                          {entry.details && (
                            <p className="text-[10px] text-zinc-600 truncate">{entry.details}</p>
                          )}
                        </div>

                        {/* Relative timestamp */}
                        <RelativeTime timestamp={entry.timestamp} />
                      </div>
                    );
                  })}
                </div>

                {/* Clear button */}
                <div className="flex justify-end mt-2 pt-2 border-t border-zinc-800/50">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] px-2 text-zinc-600 hover:text-red-400 hover:bg-red-500/10"
                    onClick={(e) => {
                      e.stopPropagation();
                      clearActivityLog();
                    }}
                  >
                    <Trash2 className="w-3 h-3 mr-1" />
                    Clear
                  </Button>
                </div>
              </>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
