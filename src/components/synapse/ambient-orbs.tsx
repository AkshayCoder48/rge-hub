'use client';

import React from 'react';

/**
 * AmbientOrbs — Floating background orbs for the Synapse aesthetic.
 * Violet glow top-right, cyan glow bottom-left, blurred and animated.
 */
export function AmbientOrbs() {
  return (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
      {/* Violet orb */}
      <div
        className="absolute -top-32 right-[-10%] w-[600px] h-[600px] rounded-full animate-float-orb"
        style={{
          background: 'rgba(139, 92, 246, 0.4)',
          filter: 'blur(120px)',
        }}
      />
      {/* Cyan orb */}
      <div
        className="absolute bottom-[-20%] -left-32 w-[500px] h-[500px] rounded-full animate-float-orb-slow"
        style={{
          background: 'rgba(6, 182, 212, 0.3)',
          filter: 'blur(100px)',
        }}
      />
      {/* Smaller violet accent */}
      <div
        className="absolute top-[40%] left-[60%] w-[300px] h-[300px] rounded-full animate-float-orb"
        style={{
          background: 'rgba(139, 92, 246, 0.15)',
          filter: 'blur(80px)',
          animationDelay: '2s',
        }}
      />
      {/* Grid overlay */}
      <div
        className="absolute inset-0 opacity-[0.015]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)`,
          backgroundSize: '80px 80px',
        }}
      />
    </div>
  );
}
