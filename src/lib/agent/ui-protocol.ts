/**
 * RGE Agent — structured UI block protocol (PURE — client + server safe).
 *
 * The agent renders polished realtime UI through the `emit_ui` tool. Each
 * call targets a block by a stable agent-chosen `id` and an operation:
 *
 *   create  → new block (initial data)
 *   replace → swap the whole data payload
 *   append  → grow array fields (rows / lines / items / entries / files …)
 *   update  → shallow-merge object fields
 *   complete→ mark the block finished (renderers stop their live pulse)
 *
 * A block rendered during streaming keeps updating IN PLACE — the frontend
 * never spawns a second block for the same id.
 */

export type UiBlockOperation = 'create' | 'replace' | 'append' | 'update' | 'complete';

export interface UiBlockState {
  /** Stable agent-chosen id — same id across operations = same block. */
  id: string;
  /** Renderer type key, e.g. "table" | "zip-contents" | "terminal". */
  uiType: string;
  title?: string;
  /** Renderer-specific payload (see renderer registry docs). */
  data: Record<string, unknown>;
  status: 'streaming' | 'done';
  updatedAt: number;
}

/** Argument shape of the emit_ui tool call. */
export interface EmitUiArgs {
  uiType: string;
  id: string;
  operation: UiBlockOperation;
  title?: string;
  data?: Record<string, unknown>;
}

const ARRAY_KEYS = new Set([
  'rows',
  'items',
  'entries',
  'lines',
  'files',
  'events',
  'checks',
  'results',
  'nodes',
  'stages',
  'steps',
  'metrics',
  'badges',
  'cards',
  'sections',
  'tabs',
  'columns',
  'values',
  'points',
  'data',
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Apply one emit_ui operation to a block's state (pure — returns the next
 * state). `undefined` prev + append/update/complete creates the block.
 */
export function applyUiOperation(
  prev: UiBlockState | undefined,
  args: EmitUiArgs
): UiBlockState {
  const now = Date.now();
  const uiType = prev && args.operation !== 'create' && args.operation !== 'replace'
    ? prev.uiType
    : args.uiType || prev?.uiType || 'raw';

  if (!prev || args.operation === 'create' || args.operation === 'replace') {
    return {
      id: args.id,
      uiType,
      title: args.title ?? prev?.title,
      data: isPlainObject(args.data) ? args.data : {},
      status: args.operation === 'create' ? 'streaming' : prev?.status ?? 'streaming',
      updatedAt: now,
    };
  }

  if (args.operation === 'complete') {
    return {
      ...prev,
      title: args.title ?? prev.title,
      data: isPlainObject(args.data) ? { ...prev.data, ...args.data } : prev.data,
      status: 'done',
      updatedAt: now,
    };
  }

  if (args.operation === 'update') {
    return {
      ...prev,
      uiType,
      title: args.title ?? prev.title,
      data: isPlainObject(args.data) ? { ...prev.data, ...args.data } : prev.data,
      updatedAt: now,
    };
  }

  // append — concat every array field the payload carries (rows, lines,
  // items, …). Non-array fields merge like update.
  const nextData: Record<string, unknown> = { ...prev.data };
  if (isPlainObject(args.data)) {
    for (const [key, value] of Object.entries(args.data)) {
      if (Array.isArray(value)) {
        const existing = Array.isArray(nextData[key]) ? (nextData[key] as unknown[]) : [];
        nextData[key] = [...existing, ...value];
      } else if (Array.isArray(value) === false && isPlainObject(value)) {
        nextData[key] = { ...(isPlainObject(nextData[key]) ? nextData[key] : {}), ...value };
      } else {
        nextData[key] = value;
      }
    }
  }
  return {
    ...prev,
    uiType,
    title: args.title ?? prev.title,
    data: nextData,
    status: 'streaming',
    updatedAt: now,
  };
}

/** Cap a block's payload before persisting (protect localStorage size). */
export function capBlockData(data: Record<string, unknown>, maxItems = 300): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value) && value.length > maxItems) {
      out[key] = value.slice(0, maxItems);
    } else if (typeof value === 'string' && value.length > 60_000) {
      out[key] = `${value.slice(0, 60_000)}\n… (truncated)`;
    } else {
      out[key] = value;
    }
  }
  return out;
}
