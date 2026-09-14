/**
 * Operation tracking (PRD §6, §9, §24) — the replacement for the
 * "2-minute timeout → server busy" architecture.
 *
 * Long/inconclusive work (upload finalization, verified creates) is
 * tracked as an operation:
 *   queued → processing → success | failed
 *
 * The mutation returns 202 { operationId } immediately when the result is
 * not yet definitive, and the client polls GET /api/operations/[id].
 * A lost HTTP response is therefore NEVER interpreted as failure — the
 * client reconciles through the operation id (PRD §22).
 *
 * Storage: in-memory registry (authoritative for the handling instance)
 * + best-effort persistence to OnyxBase KV (collection "operations") via
 * `after()` so status survives instance rotation. Read-through: a GET for
 * an unknown in-memory id checks OnyxBase once.
 *
 * We only store non-sensitive metadata: type, target ids, status, timing.
 */

import { kvSet, kvGet } from './onyxbase';
import { ONYXBASE_COLLECTIONS } from './onyxbase';

export type OperationStatus = 'queued' | 'processing' | 'success' | 'failed';

export interface OperationRecord {
  id: string;
  type: string; // e.g. 'resource.create', 'profile.update'
  status: OperationStatus;
  createdAt: string;
  updatedAt: string;
  /** Result payload on success (e.g. the resource). */
  result?: unknown;
  /** { code, message } on failure. */
  error?: { code: string; message: string };
  /** Related ids (resourceId, ownerId…) — ids only, never secrets. */
  meta?: Record<string, string>;
}

const registry = new Map<string, OperationRecord>();
const MAX_REGISTRY = 1000;

function persistOp(op: OperationRecord) {
  // Best-effort background persistence — never blocks the response.
  const write = () =>
    kvSet(`op:${op.id}`, op, ONYXBASE_COLLECTIONS.SESSIONS).catch(() => {
      /* telemetry-grade: losing a status record only costs a re-verify */
    });
  try {
    // `after()` keeps the lambda alive past the response on Vercel.
    void import('next/server').then(({ after }) => {
      if (typeof after === 'function') after(() => void write());
      else void write();
    });
  } catch {
    void write();
  }
}

export function createOperation(
  type: string,
  meta: Record<string, string> = {},
  status: OperationStatus = 'queued'
): OperationRecord {
  const now = new Date().toISOString();
  const op: OperationRecord = {
    id: `op_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`,
    type,
    status,
    createdAt: now,
    updatedAt: now,
    meta,
  };
  registry.set(op.id, op);
  if (registry.size > MAX_REGISTRY) {
    // Drop the oldest finished ops.
    const it = registry.entries();
    for (let i = 0; i < registry.size - MAX_REGISTRY; i++) {
      const n = it.next();
      if (n.done) break;
      if (n.value[1].status === 'success' || n.value[1].status === 'failed') registry.delete(n.value[0]);
    }
  }
  persistOp(op);
  return op;
}

export function updateOperation(
  id: string,
  patch: Partial<Pick<OperationRecord, 'status' | 'result' | 'error' | 'meta'>>
): OperationRecord | null {
  const op = registry.get(id);
  if (!op) return null;
  Object.assign(op, patch, { updatedAt: new Date().toISOString() });
  persistOp(op);
  return op;
}

export async function getOperation(id: string): Promise<OperationRecord | null> {
  if (!/^op_[A-Za-z0-9]{8,32}$/.test(id)) return null;
  const local = registry.get(id);
  if (local) return local;
  // Read-through (instance rotation / cold start).
  try {
    const remote = await kvGet<OperationRecord>(`op:${id}`, ONYXBASE_COLLECTIONS.SESSIONS);
    if (remote && remote.id === id) {
      registry.set(id, remote);
      return remote;
    }
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Resolve an operation to a client-facing shape. For 'resource.create'
 * operations still processing, callers may attach a re-verify hint.
 */
export function operationToBody(op: OperationRecord) {
  return {
    operationId: op.id,
    type: op.type,
    status: op.status,
    createdAt: op.createdAt,
    updatedAt: op.updatedAt,
    ...(op.result !== undefined ? { result: op.result } : {}),
    ...(op.error ? { error: op.error } : {}),
    ...(op.meta ? { meta: op.meta } : {}),
  };
}
