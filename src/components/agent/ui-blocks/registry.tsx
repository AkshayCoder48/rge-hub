'use client';

/**
 * UI-block renderer registry — maps the 60 structured `uiType` keys the RGE
 * Agent emits through `emit_ui` to their Red Noir renderers.
 *
 * `UIBlockHost` is the single entry the chat renders per block: it looks up
 * the renderer and falls back to a graceful raw-JSON card for unknown types,
 * so a newer agent can never break an older frontend.
 */

import React from 'react';
import type { ComponentType } from 'react';
import type { UiBlockState } from '@/lib/agent/ui-protocol';
import { cn } from '@/lib/utils';
import { BlockShell, ScrollBox, monoCls, type BlockProps } from './primitives';
import {
  AccordionBlock,
  ActivityBlock,
  BadgesBlock,
  CalloutBlock,
  CardGridBlock,
  ChecklistBlock,
  ComparisonTableBlock,
  DataTableBlock,
  EmptyBlock,
  ErrorBlock,
  ExpandableBlock,
  FilterableTableBlock,
  InfoBlock,
  KeyValueBlock,
  ProgressBlock,
  ResultSummaryBlock,
  SearchableListBlock,
  SortableTableBlock,
  StatsBlock,
  StatusBlock,
  StepsBlock,
  SuccessBlock,
  TableBlock,
  TabsBlock,
  TimelineBlock,
  WarningBlock,
} from './basic';
import {
  DownloadBlock,
  ExtractionResultBlock,
  FileCardBlock,
  FileListBlock,
  FolderTreeBlock,
  GeneratedFileBlock,
  ResourceComparisonBlock,
  ResourceMetadataBlock,
  XmlAttributesBlock,
  XmlNodeBlock,
  XmlPreviewBlock,
  XmlTreeBlock,
  ZipContentsBlock,
} from './resource';
import {
  BarChartBlock,
  LineChartBlock,
  MetricTrendBlock,
  PieChartBlock,
  ProgressChartBlock,
} from './charts';
import {
  BeforeAfterBlock,
  ChangeSummaryBlock,
  ChangedFilesBlock,
  CodeBlock,
  CsvBlock,
  DiffBlock,
  ErrorOutputBlock,
  ExecutionLogBlock,
  JsonBlock,
  ProcessingProgressBlock,
  TerminalBlock,
  ValidationBlock,
  ValidationChecklistBlock,
  YamlBlock,
} from './code';

/* Re-exported public API pieces defined next to the renderers that use them. */
export type { BlockProps } from './primitives';
export { UiBlockActionsContext, useUiBlockActions, type UiBlockActions } from './primitives';

/* ── Registry (exactly 60 keys — order matches the task 22-a spec) ───────── */

const REGISTRY: Record<string, ComponentType<BlockProps>> = {
  // basic (1–26)
  table: TableBlock,
  'data-table': DataTableBlock,
  'comparison-table': ComparisonTableBlock,
  'key-value': KeyValueBlock,
  stats: StatsBlock,
  progress: ProgressBlock,
  checklist: ChecklistBlock,
  steps: StepsBlock,
  timeline: TimelineBlock,
  status: StatusBlock,
  callout: CalloutBlock,
  warning: WarningBlock,
  error: ErrorBlock,
  success: SuccessBlock,
  info: InfoBlock,
  badges: BadgesBlock,
  'card-grid': CardGridBlock,
  accordion: AccordionBlock,
  tabs: TabsBlock,
  expandable: ExpandableBlock,
  'searchable-list': SearchableListBlock,
  'filterable-table': FilterableTableBlock,
  'sortable-table': SortableTableBlock,
  activity: ActivityBlock,
  'result-summary': ResultSummaryBlock,
  empty: EmptyBlock,
  // resource (27–41)
  'file-card': FileCardBlock,
  'file-list': FileListBlock,
  'folder-tree': FolderTreeBlock,
  'zip-contents': ZipContentsBlock,
  'archive-preview': ZipContentsBlock,
  'extraction-result': ExtractionResultBlock,
  'xml-tree': XmlTreeBlock,
  'xml-preview': XmlPreviewBlock,
  xml: XmlPreviewBlock,
  'xml-attributes': XmlAttributesBlock,
  'xml-node': XmlNodeBlock,
  'resource-metadata': ResourceMetadataBlock,
  'resource-comparison': ResourceComparisonBlock,
  'generated-file': GeneratedFileBlock,
  download: DownloadBlock,
  // code (42–55)
  code: CodeBlock,
  json: JsonBlock,
  yaml: YamlBlock,
  csv: CsvBlock,
  terminal: TerminalBlock,
  'execution-log': ExecutionLogBlock,
  'error-output': ErrorOutputBlock,
  diff: DiffBlock,
  'before-after': BeforeAfterBlock,
  'changed-files': ChangedFilesBlock,
  'change-summary': ChangeSummaryBlock,
  validation: ValidationBlock,
  'validation-checklist': ValidationChecklistBlock,
  'processing-progress': ProcessingProgressBlock,
  // charts (56–60)
  'bar-chart': BarChartBlock,
  'line-chart': LineChartBlock,
  'pie-chart': PieChartBlock,
  'progress-chart': ProgressChartBlock,
  'metric-trend': MetricTrendBlock,
};

/** All 60 registered uiType keys. */
export const UI_BLOCK_TYPES: string[] = Object.keys(REGISTRY); // length === 60

/** Look up a renderer; null for unknown types (host falls back to raw JSON). */
export function getBlockRenderer(uiType: string): ComponentType<BlockProps> | null {
  return Object.prototype.hasOwnProperty.call(REGISTRY, uiType) ? REGISTRY[uiType] : null;
}

/* ── Data-shape docs (fed verbatim to the agent's system prompt) ─────────── */

export const RENDERER_DOCS: Record<string, string> = {
  table: 'data: {columns: string[], rows: (string|number)[][]}',
  'data-table': 'data: {columns: {key: string, label?: string, mono?: boolean}[], rows: Record<string, string|number>[]}',
  'comparison-table': 'data: {columns: string[], rows: (string|number)[][], highlightColumn?: number}',
  'key-value': 'data: {entries: {key: string, value: string|number, mono?: boolean}[]}',
  stats: 'data: {metrics: {label: string, value: string|number, unit?: string, delta?: string}[]}',
  progress: 'data: {items: {label: string, value: number, status?: "done"|"active"|"pending"}[]}',
  checklist: 'data: {items: {text: string, done?: boolean}[]}',
  steps: 'data: {steps: {label: string, detail?: string}[], activeIndex?: number}',
  timeline: 'data: {events: {label: string, detail?: string, time?: string, status?: "done"|"active"|"pending"|"error"}[]}',
  status: 'data: {state: "success"|"error"|"warning"|"info"|"working", label: string, detail?: string}',
  callout: 'data: {variant: "info"|"warning"|"error"|"success", title?: string, text: string}',
  warning: 'data: {title?: string, text: string} (warning-styled callout)',
  error: 'data: {title?: string, text: string} (error-styled callout)',
  success: 'data: {title?: string, text: string} (success-styled callout)',
  info: 'data: {title?: string, text: string} (info-styled callout)',
  badges: 'data: {badges: {label: string, tone?: "default"|"red"|"green"|"amber"|"zinc"}[]}',
  'card-grid': 'data: {cards: {title: string, value?: string|number, text?: string}[]}',
  accordion: 'data: {sections: {title: string, content: string}[]}',
  tabs: 'data: {tabs: {label: string, content: string}[]}',
  expandable: 'data: {title: string, content: string}',
  'searchable-list': 'data: {items: {label: string, detail?: string}[]}',
  'filterable-table': 'data: {columns: string[], rows: (string|number)[][]}',
  'sortable-table': 'data: {columns: string[], rows: (string|number)[][]}',
  activity: 'data: {events: {text: string, time?: string}[]}',
  'result-summary': 'data: {headline: string, status?: "success"|"error"|"warning"|"info", entries: {key: string, value: string|number}[]}',
  empty: 'data: {hint?: string}',
  'file-card': 'data: {file: {name: string, size?: number, path?: string}, note?: string}',
  'file-list': 'data: {files: {name: string, path?: string, size?: number}[]}',
  'folder-tree': 'data: {nodes: {path: string, name: string, depth: number, kind: "folder"|"file", size?: number}[]}',
  'zip-contents': 'data: {archive?: string, entries: {name: string, size?: number}[]}',
  'archive-preview': 'data: {archive?: string, entries: {name: string, size?: number}[]}',
  'extraction-result': 'data: {archive: string, dest: string, count?: number, files: {name: string, size?: number}[]}',
  'xml-tree': 'data: {root: {tag: string, attrs?: Record<string,string>, text?: string, children?: XmlNode[]}}',
  'xml-preview': 'data: {filename?: string, content: string}',
  xml: 'data: {filename?: string, content: string}',
  'xml-attributes': 'data: {tag?: string, attributes: {key: string, value: string}[]}',
  'xml-node': 'data: {tag: string, path?: string, attributes?: {key: string, value: string}[], text?: string, childrenCount?: number}',
  'resource-metadata': 'data: {title?: string, entries: {key: string, value: string|number, mono?: boolean}[]}',
  'resource-comparison': 'data: {entries: {key: string, base: string|number, modified: string|number, changed?: boolean}[]}',
  'generated-file': 'data: {file: {name: string, path?: string, size?: number}, note?: string} (download button when path set)',
  download: 'data: {path: string, label?: string, note?: string} (prominent download button)',
  code: 'data: {code: string, language?: string, filename?: string}',
  json: 'data: {data: unknown} or {content: string}',
  yaml: 'data: {content: string}',
  csv: 'data: {content: string} or {columns: string[], rows: string[][]}',
  terminal: 'data: {command?: string, lines: string[]}',
  'execution-log': 'data: {entries: {time?: string, text: string, level?: "info"|"warn"|"error"}[]}',
  'error-output': 'data: {message: string, detail?: string, lines?: string[]}',
  diff: 'data: {filename?: string, additions?: number, deletions?: number, lines: {kind: "context"|"added"|"removed", text: string}[]}',
  'before-after': 'data: {before: {label?: string, content: string}, after: {label?: string, content: string}, language?: string}',
  'changed-files': 'data: {files: {path: string, additions?: number, deletions?: number, status?: "modified"|"added"|"removed"}[]}',
  'change-summary': 'data: {added?: number, removed?: number, modified?: number, entries?: {path: string, change: string}[]}',
  validation: 'data: {results: {check: string, passed?: boolean, detail?: string}[]}',
  'validation-checklist': 'data: {results: {check: string, passed?: boolean, detail?: string}[]}',
  'processing-progress': 'data: {stages: {label: string, status: "pending"|"active"|"done"|"failed"}[]}',
  'bar-chart': 'data: {data: {label: string, value: number}[], unit?: string}',
  'line-chart': 'data: {data: {label: string, value: number}[], unit?: string}',
  'pie-chart': 'data: {data: {label: string, value: number}[]}',
  'progress-chart': 'data: {value: number, label?: string} (value 0–100 ring)',
  'metric-trend': 'data: {label: string, value: string|number, delta?: string, points: number[]}',
};

/* ── Host ────────────────────────────────────────────────────────────────── */

/** Graceful fallback for unknown uiTypes — raw JSON in the same shell. */
function RawBlock({ block, streaming }: BlockProps) {
  let text = '';
  try {
    text = JSON.stringify(block.data, null, 2) ?? '{}';
  } catch {
    text = String(block.data);
  }
  return (
    <BlockShell block={block} streaming={streaming} title={block.title ?? `ui · ${block.uiType}`}>
      <ScrollBox>
        <pre className={cn(monoCls, 'whitespace-pre-wrap break-words leading-relaxed text-zinc-500')}>
          {text || '{}'}
        </pre>
      </ScrollBox>
    </BlockShell>
  );
}

/**
 * UIBlockHost — render one structured UI block. Unknown types never crash or
 * vanish: they fall back to a raw-JSON card inside the standard shell.
 */
export function UIBlockHost({
  block,
  streaming,
}: {
  block: UiBlockState;
  streaming: boolean;
}): React.JSX.Element {
  const Renderer = getBlockRenderer(block.uiType);
  // Dynamic renderer lookup — createElement (not JSX) so the react-hooks
  // static-components lint doesn't mistake the stable registry entry for a
  // component created during render.
  return Renderer
    ? React.createElement(Renderer, { block, streaming })
    : React.createElement(RawBlock, { block, streaming });
}
