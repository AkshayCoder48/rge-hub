'use client';

import React from 'react';
import { File as FileIcon, Folder } from 'lucide-react';
import { cn } from '@/lib/utils';
import { anim, clampCount, mono, paper } from './surfaces';

export interface FileTreeNode {
  path: string;
  name: string;
  depth: number;
  kind: 'folder' | 'file';
  additions?: number;
  deletions?: number;
}

export interface FileTreeProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The full row list, in order. */
  nodes: readonly FileTreeNode[];
  /** How many rows from the start of `nodes` to render. */
  visibleCount: number;
  /** Green count in the header. */
  totalAdditions: number;
  /** Red count in the header. */
  totalDeletions: number;
}

/**
 * FileTree — everything a run touched: an "N files changed" header with net
 * totals (always rendered, even at zero), then one row per visible node,
 * indented by depth × 0.85rem. Folders are static, non-interactive headings —
 * `depth` and `kind` are independent fields, so nothing about a row's position
 * is derived from `path` (used only as the React key). Only `kind: "file"`
 * nodes count in the header; a file's own badge is omitted when undefined.
 */
export function FileTree({
  nodes,
  visibleCount,
  totalAdditions,
  totalDeletions,
  className,
  ...rest
}: FileTreeProps) {
  const fileCount = nodes.reduce((n, node) => (node.kind === 'file' ? n + 1 : n), 0);
  const visible = clampCount(visibleCount, nodes.length);

  return (
    <div className={cn(paper, 'w-full max-w-md p-3', className)} {...rest} data-slot="file-tree">
      <div className="flex items-center justify-between gap-3 px-1 pb-2">
        <span className="text-xs text-zinc-300">{fileCount} files changed</span>
        <span className={cn(mono, 'flex shrink-0 items-center gap-2 text-[11px]')}>
          <span className="text-emerald-400">+{totalAdditions}</span>
          <span className="text-red-400">−{totalDeletions}</span>
        </span>
      </div>

      <ul className="space-y-0.5">
        {nodes.slice(0, visible).map((node) => (
          <li
            key={node.path}
            style={{ paddingLeft: `${node.depth * 0.85}rem` }}
            className={cn(anim.rowIn, 'flex min-w-0 items-center gap-2 rounded-md px-1 py-1')}
          >
            {node.kind === 'folder' ? (
              <Folder aria-hidden className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            ) : (
              <FileIcon aria-hidden className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
            )}
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-xs',
                node.kind === 'folder' ? 'font-medium text-zinc-300' : 'text-zinc-400',
              )}
            >
              {node.name}
            </span>
            {(node.additions !== undefined || node.deletions !== undefined) && (
              <span className={cn(mono, 'flex shrink-0 items-center gap-1.5 text-[11px]')}>
                {node.additions !== undefined && (
                  <span className="text-emerald-400">+{node.additions}</span>
                )}
                {node.deletions !== undefined && (
                  <span className="text-red-400">−{node.deletions}</span>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
