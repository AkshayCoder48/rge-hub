'use client';

import React, { useState } from 'react';

/**
 * Image with automatic fallback chain: primary → mirror → storage.
 * If the canonical URL ever fails, the next source is tried seamlessly.
 */
export function SafeImage({
  src,
  fallbacks,
  alt,
  className,
}: {
  src: string;
  fallbacks: (string | undefined)[];
  alt: string;
  className?: string;
}) {
  const [idx, setIdx] = useState(-1); // -1 = primary
  const queue = [src, ...fallbacks.filter(Boolean)] as string[];
  const current = queue[idx + 1] || src;

  return (
    <img
      src={current}
      alt={alt}
      className={className}
      onError={() => {
        if (idx + 1 < queue.length - 1) setIdx(idx + 1);
      }}
    />
  );
}
