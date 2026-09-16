'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { ShimmerLabel } from './surfaces';

export interface GenerationLoaderProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Text shown under the grid, rendered with a shimmer. */
  label: string;
  /** Advances the moving band of lit cells; the component does not advance it for you. */
  tick: number;
  /** Corner radius of the nine cells. */
  variant?: 'dots' | 'squares' | 'rounded';
}

const RADIUS: Record<NonNullable<GenerationLoaderProps['variant']>, string> = {
  dots: 'rounded-full',
  squares: 'rounded-[1px]',
  rounded: 'rounded-[3px]',
};

/** A 3-diagonal-wide band of lit cells sweeping across the 3×3 grid. */
function isLit(x: number, y: number, tick: number): boolean {
  const span = 5; // distinct diagonals in a 3×3 grid (x + y ∈ 0…4)
  const phase = (((tick % span) + span) % span);
  return ((((x + y) % span) + span - phase) % span) < 3;
}

/**
 * GenerationLoader — a pixel matrix that keeps time while the model has
 * nothing to show yet: nine cells cycling through a moving band (driven by the
 * `tick` prop — nothing advances on its own), with a shimmering label
 * underneath naming what is happening. Cells paint a flat foreground at two
 * opacity levels: lit and dim.
 */
export function GenerationLoader({
  label,
  tick,
  variant = 'dots',
  className,
  ...rest
}: GenerationLoaderProps) {
  return (
    <div
      className={cn('flex w-full flex-col items-center gap-3', className)}
      {...rest}
      data-slot="generation-loader"
    >
      <div className="grid grid-cols-3 gap-[5px]" role="presentation">
        {Array.from({ length: 9 }, (_, i) => {
          const x = i % 3;
          const y = Math.floor(i / 3);
          return (
            <span
              key={i}
              aria-hidden
              className={cn(
                'h-2.5 w-2.5 bg-white transition-opacity duration-150',
                RADIUS[variant],
                isLit(x, y, tick) ? 'opacity-70' : 'opacity-15',
              )}
            />
          );
        })}
      </div>
      <ShimmerLabel className="text-center text-xs">{label}</ShimmerLabel>
    </div>
  );
}
