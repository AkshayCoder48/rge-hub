'use client';

import React from 'react';
import { Copy, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { clampCount, ghostButton } from './surfaces';
import { StreamedWords } from './streaming-text';

export interface MessagePairProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The sent message, shown as the bubble or the flat line. */
  userMessage: string;
  /** The full reply, already split into words. */
  words: readonly string[];
  /** How many words from the start of `words` to show. */
  visibleWords: number;
  /** Tints the newest words and shows the trailing cursor while true. */
  streaming: boolean;
  /** How the sent message is presented. */
  variant?: 'bubble' | 'flat';
}

/**
 * MessagePair — one turn of a conversation: the message you sent (a filled
 * pill in `bubble`, right-aligned plain text in `flat`) and the reply landing
 * beneath it word by word, with copy and regenerate actions tucked away until
 * the reply group is hovered or focused. The action buttons are presentational
 * — they carry aria-labels but no handlers.
 */
export function MessagePair({
  userMessage,
  words,
  visibleWords,
  streaming,
  variant = 'bubble',
  className,
  ...rest
}: MessagePairProps) {
  const shown = clampCount(visibleWords, words.length);
  const streamWords = words.map((text) => ({ text, mono: false }));

  return (
    <div
      className={cn('flex w-full flex-col gap-3', className)}
      {...rest}
      data-slot="message-pair"
    >
      {variant === 'bubble' ? (
        <div className="max-w-[85%] self-end rounded-2xl rounded-br-md border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm text-zinc-100">
          {userMessage}
        </div>
      ) : (
        <div className="max-w-[85%] self-end text-right text-sm text-zinc-400">{userMessage}</div>
      )}

      <div className="group w-full">
        <div className="min-h-[1.5rem] text-sm leading-relaxed text-zinc-100">
          <StreamedWords words={streamWords} shown={shown} streaming={streaming} />
        </div>

        {/* Copy + regenerate: presentational, revealed on hover or focus. */}
        <div className="mt-2 flex items-center gap-1.5 opacity-0 transition-opacity duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:opacity-100 group-focus-within:opacity-100">
          <button type="button" aria-label="Copy" className={cn(ghostButton, 'h-6 px-1.5')}>
            <Copy aria-hidden className="h-3 w-3" />
          </button>
          <button type="button" aria-label="Regenerate" className={cn(ghostButton, 'h-6 px-1.5')}>
            <RefreshCw aria-hidden className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
