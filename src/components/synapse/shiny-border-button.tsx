'use client';

import React from 'react';

/**
 * ShinyBorderButton — A button with a continuously spinning conic gradient
 * border that creates a thin neon line effect.
 *
 * Spec: padding 1px, border-radius 9999px, overflow hidden.
 * Inner: bg #0a0a0a, z-index 1.
 * Pseudo ::before: conic-gradient(from 0deg, transparent 0%, #8b5cf6 40%,
 * #06b6d4 50%, transparent 60%), 200%x200%, 4s rotation.
 */
interface ShinyBorderButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  innerClassName?: string;
  type?: 'button' | 'submit';
  disabled?: boolean;
}

export function ShinyBorderButton({
  children,
  onClick,
  className = '',
  innerClassName = '',
  type = 'button',
  disabled = false,
}: ShinyBorderButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`shiny-border-btn ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} transition-opacity duration-300 ease-snap ${className}`}
    >
      <span
        className={`inline-flex items-center justify-center gap-2 px-8 py-3 text-sm font-medium text-white ${innerClassName}`}
      >
        {children}
      </span>
    </button>
  );
}
