'use client';

import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

/**
 * CodeBlock — Dark IDE-style window with syntax highlighting.
 * Background #080808/80, border white/10, 24px radius.
 * Toolbar: 3 window controls, filename, copy icon.
 * Syntax: Violet imports, Cyan classes, Emerald strings, Grey comments.
 */
interface CodeBlockProps {
  filename?: string;
  code: string;
  language?: string;
}

// Lightweight syntax highlighter for the demo code
function highlight(line: string): React.ReactNode {
  // Comments
  if (line.trim().startsWith('//') || line.trim().startsWith('#')) {
    return <span className="text-neutral-600">{line}</span>;
  }

  const parts: React.ReactNode[] = [];
  let remaining = line;

  // Token regex: strings, keywords, numbers, classes
  const tokenRegex = /("[^"]*"|'[^']*'|`[^`]*`|\/\/[^\n]*|\b(?:const|let|var|import|from|export|function|return|await|async|new|if|else|for|true|false|null|undefined)\b|\b\d+(?:\.\d+)?\b|\b[A-Z][a-zA-Z0-9]*\b)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = tokenRegex.exec(remaining)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={key++} className="text-neutral-300">{remaining.slice(lastIndex, match.index)}</span>);
    }
    const token = match[0];
    if (token.startsWith('"') || token.startsWith("'") || token.startsWith('`')) {
      parts.push(<span key={key++} className="text-emerald-400">{token}</span>);
    } else if (token.startsWith('//')) {
      parts.push(<span key={key++} className="text-neutral-600">{token}</span>);
    } else if (/^(const|let|var|import|from|export|function|return|await|async|new|if|else|for|true|false|null|undefined)$/.test(token)) {
      parts.push(<span key={key++} className="text-violet-400">{token}</span>);
    } else if (/^\d/.test(token)) {
      parts.push(<span key={key++} className="text-cyan-300">{token}</span>);
    } else if (/^[A-Z]/.test(token)) {
      parts.push(<span key={key++} className="text-cyan-400">{token}</span>);
    } else {
      parts.push(<span key={key++} className="text-neutral-300">{token}</span>);
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < remaining.length) {
    parts.push(<span key={key++} className="text-neutral-300">{remaining.slice(lastIndex)}</span>);
  }

  return parts;
}

export function CodeBlock({ filename = 'ramp.ts', code, language = 'typescript' }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="rounded-3xl border border-white/10 bg-[#080808]/80 backdrop-blur-xl overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500/40" />
          <div className="w-3 h-3 rounded-full bg-yellow-500/40" />
          <div className="w-3 h-3 rounded-full bg-green-500/40" />
        </div>
        <span className="text-[11px] font-mono-display text-neutral-500 tracking-wide">{filename}</span>
        <button
          onClick={handleCopy}
          className="text-neutral-500 hover:text-white transition-colors duration-300 ease-snap"
          aria-label="Copy code"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>

      {/* Code */}
      <pre className="p-6 overflow-x-auto custom-scrollbar text-[13px] leading-relaxed font-mono-display">
        <code>
          {code.split('\n').map((line, i) => (
            <div key={i} className="min-h-[1.5em]">
              <span className="text-neutral-700 select-none mr-4 inline-block w-6 text-right">{i + 1}</span>
              {highlight(line) || ' '}
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}
