'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { anim, clampCount } from './surfaces';

export interface Segment {
  text: string;
  mono?: boolean;
}

export interface StreamingTextProps
  extends Omit<React.HTMLAttributes<HTMLParagraphElement>, 'children'> {
  /** Split on spaces and concatenated into one word stream. */
  segments: Segment[];
  /** Words to reveal, clamped between 0 and the total word count. */
  count: number;
  /** Tints the newest two shown words and renders a trailing caret. */
  streaming: boolean;
}

interface StreamWord {
  text: string;
  mono: boolean;
}

/**
 * Split every segment on whitespace into a single word stream (line breaks and
 * repeated spaces do not survive), carrying the mono flag per word.
 */
function toWords(segments: readonly Segment[]): StreamWord[] {
  const words: StreamWord[] = [];
  for (const segment of segments) {
    for (const text of segment.text.split(/\s+/)) {
      if (text.length > 0) words.push({ text, mono: segment.mono === true });
    }
  }
  return words;
}

/**
 * StreamedWords — the word stream shared by StreamingText and MessagePair:
 * words separated by single spaces, the newest two tinted blue while
 * streaming, every earlier word easing back to ink over 700ms instead of
 * snapping, and a blinking caret at the end while streaming (only when at
 * least one word is shown).
 */
export function StreamedWords({
  words,
  shown,
  streaming,
}: {
  words: readonly StreamWord[];
  shown: number;
  streaming: boolean;
}) {
  return (
    <>
      {words.slice(0, shown).map((word, i) => {
        const tinted = streaming && i >= shown - 2;
        return (
          <React.Fragment key={i}>
            {i > 0 ? ' ' : null}
            <span
              className={cn(
                anim.wordIn,
                'transition-colors duration-700',
                word.mono &&
                  'rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[0.85em] text-zinc-200',
                tinted && 'text-blue-500',
              )}
            >
              {word.text}
            </span>
          </React.Fragment>
        );
      })}
      {streaming && shown > 0 && (
        <span
          aria-hidden
          className={cn(
            anim.blink,
            'ml-1 inline-block h-[1em] w-[7px] translate-y-[2px] rounded-[1px] bg-blue-500',
          )}
        />
      )}
    </>
  );
}

/**
 * StreamingText — tokens arrive softly: word-by-word text with the newest two
 * words tinted blue and a caret at the end while it streams; older words fade
 * back to plain text over 700ms. `count` clamps between 0 and the total word
 * count — a negative or NaN count shows nothing, an overly large one shows
 * everything.
 */
export function StreamingText({
  segments,
  count,
  streaming,
  className,
  ...rest
}: StreamingTextProps) {
  const words = toWords(segments);
  const shown = clampCount(count, words.length);

  return (
    <p
      className={cn('text-sm leading-relaxed text-zinc-100', className)}
      {...rest}
      data-slot="streaming-text"
    >
      <StreamedWords words={words} shown={shown} streaming={streaming} />
    </p>
  );
}
