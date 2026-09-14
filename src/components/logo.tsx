'use client';

import React from 'react';

interface LogoProps {
  size?: number;
  className?: string;
}

/**
 * RGE Hub Logo — symbol-only mark (zero text): a red ramp-play emblem on
 * a black tile. One asset (public/logo.png) used at every size; the PNG
 * already carries transparent rounded corners.
 */
export function Logo({ size = 24, className = '' }: LogoProps) {
  return (
    <img
      src="/logo.png"
      alt="RGE Hub"
      width={size}
      height={size}
      draggable={false}
      className={className}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * RGE Hub Logo with text.
 */
export function LogoWithText({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Logo size={size} />
      <span className="font-manrope font-bold tracking-tight text-white text-lg">
        RGE <span className="text-accent">Hub</span>
      </span>
    </div>
  );
}
