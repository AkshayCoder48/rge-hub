'use client';

import React from 'react';
import { useAppStore } from '@/lib/store';
import { Zap, Layers, Wind } from 'lucide-react';

const tabs = [
  {
    id: 'speedramp' as const,
    label: 'Speed Ramp',
    icon: Zap,
    activeColor: 'text-orange-400',
    activeLine: 'bg-orange-400',
    hoverBg: 'hover:text-orange-400/60',
  },
  {
    id: 'interpolation' as const,
    label: 'Interpolation',
    icon: Layers,
    activeColor: 'text-emerald-400',
    activeLine: 'bg-emerald-400',
    hoverBg: 'hover:text-emerald-400/60',
  },
  {
    id: 'motionblur' as const,
    label: 'Motion Blur',
    icon: Wind,
    activeColor: 'text-purple-400',
    activeLine: 'bg-purple-400',
    hoverBg: 'hover:text-purple-400/60',
  },
];

export function BottomNav() {
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-[#0a0a0f]/90 backdrop-blur-xl border-t border-white/[0.06]">
      {/* Safe area padding for iOS */}
      <div className="pb-[env(safe-area-inset-bottom)]">
        <div className="flex">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  relative flex-1 flex flex-col items-center justify-center gap-1 py-3
                  min-h-[44px] transition-colors duration-200
                  ${isActive ? tab.activeColor : `text-white/30 ${tab.hoverBg}`}
                `}
              >
                {/* Active indicator line */}
                <div
                  className={`absolute top-0 left-[20%] right-[20%] h-[2px] rounded-full transition-all duration-300 ${
                    isActive ? tab.activeLine : 'bg-transparent'
                  }`}
                />
                <Icon className="w-5 h-5" strokeWidth={isActive ? 2.2 : 1.8} />
                <span className={`text-[10px] font-medium tracking-wide ${isActive ? 'opacity-100' : 'opacity-60'}`}>
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
