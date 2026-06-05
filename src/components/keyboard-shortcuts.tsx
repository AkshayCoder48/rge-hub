'use client';

import React, { useEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { X, Keyboard } from 'lucide-react';

interface KeyboardShortcutsProps {
  isOpen: boolean;
  onClose: () => void;
}

const shortcutCategories = [
  {
    name: 'Global',
    shortcuts: [
      { keys: ['Space'], description: 'Process selected clip' },
      { keys: ['Ctrl', 'Enter'], description: 'Process all clips' },
      { keys: ['Delete'], description: 'Remove selected clip' },
      { keys: ['?'], description: 'Toggle shortcuts panel' },
    ],
  },
  {
    name: 'Navigation',
    shortcuts: [
      { keys: ['↑'], description: 'Select previous clip' },
      { keys: ['↓'], description: 'Select next clip' },
      { keys: ['Escape'], description: 'Deselect / Close panel' },
    ],
  },
  {
    name: 'Playback',
    shortcuts: [
      { keys: ['Space'], description: 'Play / Pause video' },
      { keys: ['R'], description: 'Restart video' },
      { keys: ['M'], description: 'Mute / Unmute' },
      { keys: ['L'], description: 'Toggle loop' },
      { keys: ['←'], description: 'Seek back 0.1s' },
      { keys: ['→'], description: 'Seek forward 0.1s' },
    ],
  },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 bg-zinc-800 border border-zinc-700 rounded text-[11px] font-mono text-zinc-300 shadow-sm">
      {children}
    </kbd>
  );
}

export function KeyboardShortcuts({ isOpen, onClose }: KeyboardShortcutsProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <Card
        ref={panelRef}
        className="bg-zinc-900 border-zinc-700 shadow-2xl shadow-black/50 w-full max-w-md mx-4 p-0 animate-in slide-in-from-bottom-4 fade-in duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-orange-400" />
            <h3 className="text-sm font-semibold text-zinc-200">Keyboard Shortcuts</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Shortcuts */}
        <div className="px-5 py-3 max-h-96 overflow-y-auto custom-scrollbar">
          {shortcutCategories.map((category) => (
            <div key={category.name} className="mb-4 last:mb-0">
              <h4 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                {category.name}
              </h4>
              <div className="space-y-1.5">
                {category.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.description}
                    className="flex items-center justify-between py-1"
                  >
                    <span className="text-xs text-zinc-400">{shortcut.description}</span>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key, i) => (
                        <React.Fragment key={key}>
                          {i > 0 && (
                            <span className="text-[10px] text-zinc-600">+</span>
                          )}
                          <Kbd>{key}</Kbd>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-800 bg-zinc-900/50 rounded-b-lg">
          <p className="text-[10px] text-zinc-600 text-center">
            Press <Kbd>?</Kbd> or <Kbd>Esc</Kbd> to close this panel
          </p>
        </div>
      </Card>
    </div>
  );
}
