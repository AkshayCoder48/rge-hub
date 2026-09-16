'use client';

import React, { type CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import styles from './orb.module.css';

export type OrbVariant = 'S1';

/** The stage the geometry is tuned on; --orb-k scales it to `size`. */
const STAGE = 28;

/** Default rendered size — a 20×20 indicator box. */
const DEFAULT_SIZE = 20;

const N = 3; // lattice is N×N
const PITCH = 6; // centre-to-centre spacing in stage px; the dot size is CSS
const MID = (N - 1) / 2;

/** Swirl choreography: radians of rotation at each end, ~60°. */
const SWIRL = 1.05;
/** Outward push on top of the rotation. */
const SPREAD = 1.6;

/** Task label per variant — used when no `label` prop is supplied. */
export const ORB_TASKS: Record<OrbVariant, string> = {
  S1: 'Thinking',
};

/** Offset from a cell's own grid slot to its swirled position, in stage px. */
function swirl(x: number, y: number, angle: number): [number, number] {
  const dx = x - MID;
  const dy = y - MID;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    ((dx * cos - dy * sin) * SPREAD - dx) * PITCH,
    ((dx * sin + dy * cos) * SPREAD - dy) * PITCH,
  ];
}

/**
 * S1: a wavefront radiating from the centre on a round delay. The centre
 * leads a beat early so the next swell doesn't sit behind the outer fade.
 */
function cellDelay(x: number, y: number): number {
  const dx = x - MID;
  const dy = y - MID;
  return Math.hypot(dx, dy) * 700 - (dx === 0 && dy === 0 ? 180 : 0);
}

interface Cell {
  key: string;
  left: number;
  top: number;
  delay: number;
  /** Where the settle gathers this cell from, and releases it to. */
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/** The 9 lattice cells, with position, phase, and swirl vectors. */
function latticeCells(): Cell[] {
  const cells: Cell[] = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const [ax, ay] = swirl(x, y, -SWIRL);
      const [bx, by] = swirl(x, y, SWIRL);
      cells.push({
        key: `${x},${y}`,
        left: x * PITCH,
        top: y * PITCH,
        delay: cellDelay(x, y),
        ax,
        ay,
        bx,
        by,
      });
    }
  }
  return cells;
}

export interface OrbProps {
  variant?: OrbVariant;
  /** Rendered edge length in px. The 28px geometry scales to fit. */
  size?: number;
  /** Accessible label, and the status text when `pill` is set. */
  label?: string;
  /** Wraps the orb and its label in a status pill. */
  pill?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Orb — a compact animated activity indicator: a 3×3 lattice of cells with a
 * wavefront radiating from the centre (delay = hypot(dx,dy) × 700ms), each
 * cell gathering from a swirled position, swelling, and releasing to the
 * mirror rotation. With `pill`, the orb and its label sit in a status pill;
 * otherwise the glyph itself carries role="img" and the label as aria-label.
 */
export function Orb({
  variant = 'S1',
  size = DEFAULT_SIZE,
  label,
  pill,
  className,
  style,
}: OrbProps) {
  const text = label ?? `${ORB_TASKS[variant]}…`;

  return (
    <span
      className={cn(styles.root, pill && styles.pill, className)}
      style={style}
      data-pill={pill ? '' : undefined}
      data-slot="orb"
    >
      <span
        className={styles.glyph}
        // In pill form the visible label already carries the meaning, so the
        // glyph steps out of the accessibility tree.
        role={pill ? undefined : 'img'}
        aria-label={pill ? undefined : text}
        aria-hidden={pill ? true : undefined}
        style={{ width: size, height: size, '--orb-k': size / STAGE } as CSSProperties}
      >
        <span className={styles.lattice} data-variant={variant}>
          {latticeCells().map((cell) => (
            <span
              key={cell.key}
              className={styles.cell}
              style={
                {
                  left: cell.left,
                  top: cell.top,
                  animationDelay: `${cell.delay}ms`,
                  '--orb-ax': `${cell.ax}px`,
                  '--orb-ay': `${cell.ay}px`,
                  '--orb-bx': `${cell.bx}px`,
                  '--orb-by': `${cell.by}px`,
                } as CSSProperties
              }
            />
          ))}
        </span>
      </span>
      {pill && <span className={styles.text}>{text}</span>}
    </span>
  );
}
