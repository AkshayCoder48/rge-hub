'use client';

import React from 'react';

interface LogoProps {
  size?: number;
  className?: string;
}

/**
 * RGE Hub Logo — a red diamond with play triangle, representing video editing + railways.
 */
export function Logo({ size = 24, className = '' }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Outer diamond */}
      <rect
        x="6"
        y="6"
        width="20"
        height="20"
        rx="4"
        transform="rotate(45 16 16)"
        fill="#ef233c"
      />
      {/* Inner play triangle */}
      <path
        d="M13 11.5L21 16L13 20.5V11.5Z"
        fill="white"
      />
    </svg>
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
