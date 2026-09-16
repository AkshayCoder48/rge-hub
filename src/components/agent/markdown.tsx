'use client';

/**
 * Markdown — the chat text renderer for RGE Agent.
 *
 * Assistant text segments stream as markdown (bold, lists, tables, code…)
 * and must render POLISHED, never raw. Powered by react-markdown + GFM
 * (tables, strikethrough, autolinks) with a compact custom component map —
 * no typography plugin, just the Red Noir tokens used across the agent UI.
 *
 * Safe by construction: react-markdown does not render raw HTML.
 */

import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

function MarkdownImpl({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'text-sm leading-relaxed text-zinc-100 break-words',
        // paragraph + list spacing
        '[&_.md-p]:my-0',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="md-p my-1.5 first:mt-0 last:mb-0">{children}</p>,
          h1: ({ children }) => (
            <h1 className="my-3 text-base font-manrope font-bold text-white first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="my-2.5 text-[15px] font-manrope font-bold text-white first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="my-2 text-sm font-manrope font-semibold text-white first:mt-0">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="my-2 text-sm font-manrope font-semibold text-zinc-100 first:mt-0">{children}</h4>
          ),
          ul: ({ children }) => (
            <ul className="my-1.5 list-disc pl-5 space-y-0.5 marker:text-zinc-600">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-1.5 list-decimal pl-5 space-y-0.5 marker:text-zinc-600">{children}</ol>
          ),
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
          em: ({ children }) => <em className="italic text-zinc-200">{children}</em>,
          del: ({ children }) => <del className="text-zinc-500">{children}</del>,
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#ff8fa3] underline decoration-[#ef233c]/40 underline-offset-2 hover:decoration-[#ef233c]"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-[#ef233c]/40 pl-3 text-zinc-300 italic">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-white/10" />,
          // GFM tables — scrollable on mobile, subtle borders like the ui-blocks tables
          table: ({ children }) => (
            <div className="my-2.5 max-w-full overflow-x-auto custom-scrollbar rounded-lg border border-white/10">
              <table className="w-full border-collapse text-[13px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-white/[0.04]">{children}</thead>,
          th: ({ children }) => (
            <th className="border-b border-white/10 px-3 py-1.5 text-left font-manrope text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-300">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-white/5 px-3 py-1.5 align-top text-zinc-200">{children}</td>
          ),
          code: ({
            className: cls,
            children,
            ...rest
          }: React.HTMLAttributes<HTMLElement> & { 'node'?: unknown }) => {
            const raw = String(children ?? '');
            // Block code (fenced) comes with a language- class; inline has none.
            const isBlock = /language-/.test(cls || '') || raw.includes('\n');
            if (isBlock) {
              return (
                <code
                  className={cn('block font-mono', cls)}
                  {...rest}
                >
                  {raw.replace(/\n$/, '')}
                </code>
              );
            }
            return (
              <code className="rounded bg-white/[0.06] border border-white/10 px-1.5 py-0.5 font-mono text-[12px] text-emerald-200/90">
                {raw}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-2.5 overflow-x-auto custom-scrollbar rounded-xl border border-white/10 bg-[#0a0a0b] p-3 text-[12px] leading-relaxed text-zinc-300">
              {children}
            </pre>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);
