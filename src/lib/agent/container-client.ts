/**
 * RGE Agent — web container client (main thread).
 *
 * Typed RPC client + event fan-out + IndexedDB persistence for the Pyodide
 * web container worker at public/rge-container.js. The worker owns one
 * Python 3.12 (WASM) runtime with a virtual filesystem holding one
 * workspace per agent chat (/workspace/<workspaceId>).
 *
 * BROWSER-ONLY at runtime: every worker / IndexedDB touch is guarded by
 * `typeof window !== 'undefined'` and the worker is never instantiated at
 * module scope (lazy singleton via getContainer()). Importing this module
 * from server code is safe.
 *
 * Lifecycle / wiring cheat sheet (see the worklog entry for details):
 *   - boot() creates the worker and resolves on its 'ready' event. The
 *     worker boots Pyodide lazily on its first RPC, so boot() sends an
 *     internal 'ping' RPC as the trigger (its reply is ignored).
 *   - 'boot-error' moves the client to status 'error'; every later call
 *     rejects with 'Container failed to boot' until reset().
 *   - fs events are forwarded to subscribeFs listeners; a '*' payload means
 *     "anything may have changed — re-list the workspace".
 *   - Execs (execCode/execCommand) are CHAINED client-side: overlapping
 *     calls queue instead of failing (the worker additionally guards with a
 *     'Container busy' error). Their promises resolve on 'exec-end'.
 *   - Persistence: precise fs events upsert the changed file into IndexedDB;
 *     '*' events (and directory events, which may hide deletions) schedule a
 *     debounced full rebuild (persistAll). The FIRST ensureWorkspace(ws) of
 *     a session restores the workspace from IndexedDB into the worker.
 */

import type {
  ContainerStatus,
  ContainerFileNode,
  ContainerZipEntry,
  ContainerSearchMatch,
  ContainerFileInfo,
  ContainerDiffLine,
  ContainerExecResult,
  ContainerOp,
} from '@/lib/agent/container-types';

// ────────────────────────────────────────────────────────────────────────────
// Public shapes
// ────────────────────────────────────────────────────────────────────────────

export interface ExecOptions {
  onStdout?(text: string): void;
  onStderr?(text: string): void;
}

/** One changed path of a worker 'fs' event. */
export interface ContainerFsPath {
  path: string;
  dir: boolean;
}

/**
 * What a subscriber receives: the precise changed paths, or '*' when the
 * worker could not track them (exec / zip bulk changes) and the listener
 * should refresh its full listing.
 */
export type ContainerFsPayload = ContainerFsPath[] | '*';

export interface ContainerDownload {
  url: string;
  name: string;
  size: number;
  revoke(): void;
}

// ────────────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────────────

const WORKER_URL = '/rge-container.js';

const DB_NAME = 'rge-agent-container';
const DB_VERSION = 1;
const STORE_FILES = 'files';
const STORE_META = 'meta';

/** Files above this size are never persisted to IndexedDB. */
const MAX_PERSIST_BYTES = 25 * 1024 * 1024;

const DEFAULT_TIMEOUT_MS = 20_000; // list/search/read/write/...
const READ_BYTES_TIMEOUT_MS = 60_000;
/** Internal (persistence) list calls get a generous budget so they survive
 *  long-running execs without failing. */
const PERSIST_LIST_TIMEOUT_MS = 120_000;
/** Execs have no regular timeout (they end via exec-end) — 15 min safety. */
const EXEC_SAFETY_MS = 15 * 60 * 1000;
const PERSIST_DEBOUNCE_MS = 800;

/** One pending RPC. Exec RPCs additionally carry their execId + callbacks. */
interface PendingRpc {
  rpcId: number;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
  /** Set for execCode/execCommand: routes stdout/stderr + exec-end. */
  execId?: string;
  /** Stashed result of the exec RPC reply (the promise resolves on exec-end). */
  execResult?: ContainerExecResult;
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
}

interface FileRecord {
  ws: string;
  path: string;
  blob: Blob;
  size: number;
  updatedAt: number;
  /** Worker mtime of the persisted content; lets persistAll skip re-reads. */
  mtime?: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isFileRecord(v: unknown): v is FileRecord {
  if (!isRecord(v)) return false;
  return (
    typeof v.ws === 'string' &&
    typeof v.path === 'string' &&
    v.blob instanceof Blob &&
    typeof v.size === 'number'
  );
}

/** Best-effort validation of a ContainerExecResult coming off the wire. */
function asExecResult(v: unknown): ContainerExecResult | null {
  if (!isRecord(v)) return null;
  if (
    typeof v.ok !== 'boolean' ||
    typeof v.exitCode !== 'number' ||
    typeof v.output !== 'string' ||
    typeof v.durationMs !== 'number'
  ) {
    return null;
  }
  const result: ContainerExecResult = {
    ok: v.ok,
    exitCode: v.exitCode,
    output: v.output,
    durationMs: v.durationMs,
  };
  if (typeof v.error === 'string') result.error = v.error;
  return result;
}

/**
 * Normalize a workspace id: replace every character outside [A-Za-z0-9_-]
 * with '_' and cap at 64 chars. Exported for reuse by the agent store.
 */
export function sanitizeWsId(id: string): string {
  return String(id ?? '')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 64);
}

// ────────────────────────────────────────────────────────────────────────────
// ContainerClient
// ────────────────────────────────────────────────────────────────────────────

export class ContainerClient {
  // ── state ──
  private status: ContainerStatus = 'idle';
  private statusSubs = new Set<(s: ContainerStatus) => void>();
  private fsSubs = new Set<(ws: string, paths: ContainerFsPayload) => void>();

  // ── worker + rpc plumbing ──
  private worker: Worker | null = null;
  private bootPromise: Promise<void> | null = null;
  private bootResolve: (() => void) | null = null;
  private bootReject: ((e: Error) => void) | null = null;
  private rpcId = 0;
  private execSeq = 0;
  private pending = new Map<number, PendingRpc>();
  private execs = new Map<string, PendingRpc>();
  /** Client-side serialization of execs: one at a time, later ones queue. */
  private execChain: Promise<unknown> = Promise.resolve();

  // ── persistence ──
  private dbPromise: Promise<IDBDatabase> | null = null;
  /** Workspaces already restored from IndexedDB this session. */
  private restored = new Set<string>();
  /** In-flight restore per workspace (dedups concurrent ensureWorkspace). */
  private restorePromises = new Map<string, Promise<void>>();
  /** Workspaces currently restoring (persistence muted during restore). */
  private restoring = new Set<string>();
  private persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private persistInFlight = new Set<string>();

  // ────────────────────────────────────────────────────────────────────────
  // Status + subscriptions
  // ────────────────────────────────────────────────────────────────────────

  getStatus(): ContainerStatus {
    return this.status;
  }

  subscribeStatus(fn: (s: ContainerStatus) => void): () => void {
    this.statusSubs.add(fn);
    try {
      fn(this.status);
    } catch {
      // subscriber bugs never break the client
    }
    return () => {
      this.statusSubs.delete(fn);
    };
  }

  subscribeFs(
    fn: (workspace: string, paths: { path: string; dir: boolean }[] | '*') => void,
  ): () => void {
    this.fsSubs.add(fn);
    return () => {
      this.fsSubs.delete(fn);
    };
  }

  private notifyStatus(): void {
    for (const fn of [...this.statusSubs]) {
      try {
        fn(this.status);
      } catch {
        // subscriber bugs never break the client
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Boot
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Create the worker and await its 'ready' event. Idempotent; rejects with
   * the boot error message on 'boot-error'. The worker boots Pyodide lazily
   * on its first RPC, so boot() sends an internal ping RPC as the trigger.
   */
  async boot(): Promise<void> {
    if (typeof window === 'undefined') throw new Error('Container is browser-only');
    if (this.status === 'ready') return;
    if (this.status === 'error') throw new Error('Container failed to boot');
    if (this.bootPromise) return this.bootPromise;
    this.status = 'booting';
    this.notifyStatus();
    this.bootPromise = new Promise<void>((resolve, reject) => {
      this.bootResolve = resolve;
      this.bootReject = reject;
      const worker = new Worker(WORKER_URL);
      this.worker = worker;
      worker.onmessage = (ev: MessageEvent<unknown>) => {
        this.handleWorkerMessage(ev.data);
      };
      worker.onerror = (ev: ErrorEvent) => {
        // The worker never lets runtime errors bubble, so onerror here means
        // the script failed to load. handleBootError ignores late errors
        // once the container is ready.
        this.handleBootError(ev.message || 'worker failed to load');
      };
      // Trigger the lazy boot inside the worker (the reply is ignored: no
      // pending entry is registered for this id).
      try {
        this.post({ type: 'rpc', id: ++this.rpcId, op: 'ping', args: {} });
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
    return this.bootPromise;
  }

  /** Terminate the worker and return to a fresh 'idle' state. The next call
   *  re-creates the worker and re-restores workspaces from IndexedDB. */
  reset(): void {
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        // already dead
      }
      this.worker = null;
    }
    const err = new Error('Container was reset');
    for (const entry of this.pending.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
    this.execs.clear();
    for (const t of this.persistTimers.values()) clearTimeout(t);
    this.persistTimers.clear();
    this.persistInFlight.clear();
    this.restored.clear();
    this.restoring.clear();
    this.execChain = Promise.resolve();
    const rejectBoot = this.bootReject;
    this.bootPromise = null;
    this.bootResolve = null;
    this.bootReject = null;
    this.status = 'idle';
    this.notifyStatus();
    if (rejectBoot) rejectBoot(err);
  }

  private async ensureBooted(): Promise<void> {
    if (typeof window === 'undefined') throw new Error('Container is browser-only');
    if (this.status === 'error') throw new Error('Container failed to boot');
    if (this.status === 'ready') return;
    await this.boot();
  }

  // ────────────────────────────────────────────────────────────────────────
  // RPC plumbing
  // ────────────────────────────────────────────────────────────────────────

  private post(message: unknown, transfer?: ArrayBuffer[]): void {
    const worker = this.worker;
    if (!worker) throw new Error('Container worker is not running');
    if (transfer && transfer.length > 0) worker.postMessage(message, transfer);
    else worker.postMessage(message);
  }

  private rpc<T>(
    op: ContainerOp,
    args: Record<string, unknown>,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    return this.ensureBooted().then(
      () =>
        new Promise<T>((resolve, reject) => {
          const id = ++this.rpcId;
          const entry: PendingRpc = {
            rpcId: id,
            // narrow cast: worker results are trusted payloads typed by the
            // caller (the worker is same-origin, ours)
            resolve: (value) => resolve(value as T),
            reject,
            timer: null,
          };
          if (timeoutMs > 0) {
            entry.timer = setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`Container op '${op}' timed out`));
            }, timeoutMs);
          }
          this.pending.set(id, entry);
          this.post({ type: 'rpc', id, op, args });
        }),
      (err: unknown) => {
        throw err instanceof Error ? err : new Error(String(err));
      },
    );
  }

  private nextExecId(): string {
    this.execSeq += 1;
    return `exec_${Date.now().toString(36)}_${this.execSeq.toString(36)}`;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Public API — workspaces + files
  // ────────────────────────────────────────────────────────────────────────

  private requireWs(ws: string): string {
    const id = sanitizeWsId(ws);
    if (!id) throw new Error('Invalid workspace id');
    return id;
  }

  /**
   * Ensure the workspace exists in the container. The FIRST ensure per
   * workspace per session also restores its files from IndexedDB.
   */
  async ensureWorkspace(ws: string): Promise<{ root: string }> {
    const id = this.requireWs(ws);
    await this.ensureBooted();
    const res = await this.rpc<{ root: string }>('ensureWorkspace', { workspaceId: id });
    if (!this.restored.has(id)) {
      let restore = this.restorePromises.get(id);
      if (!restore) {
        restore = this.doRestore(id).finally(() => {
          this.restorePromises.delete(id);
        });
        this.restorePromises.set(id, restore);
      }
      await restore.catch(() => {
        // persistence failures never break the container
      });
    }
    return { root: typeof res.root === 'string' ? res.root : `/workspace/${id}` };
  }

  async list(ws: string, path?: string): Promise<{ nodes: ContainerFileNode[]; truncated?: boolean }> {
    const id = this.requireWs(ws);
    const args: Record<string, unknown> = { workspaceId: id };
    if (path !== undefined) args.path = path;
    return this.rpc<{ nodes: ContainerFileNode[]; truncated?: boolean }>('list', args);
  }

  async read(
    ws: string,
    path: string,
    maxBytes?: number,
  ): Promise<{ content: string | null; size: number; truncated?: boolean; binary?: boolean }> {
    const id = this.requireWs(ws);
    const args: Record<string, unknown> = { workspaceId: id, path };
    if (maxBytes !== undefined) args.maxBytes = maxBytes;
    return this.rpc<{ content: string | null; size: number; truncated?: boolean; binary?: boolean }>(
      'read',
      args,
    );
  }

  async readBytes(ws: string, path: string): Promise<ArrayBuffer> {
    const id = this.requireWs(ws);
    const res = await this.rpc<ArrayBuffer>(
      'readBytes',
      { workspaceId: id, path },
      READ_BYTES_TIMEOUT_MS,
    );
    if (!(res instanceof ArrayBuffer)) throw new Error('readBytes returned invalid data');
    return res;
  }

  async write(ws: string, path: string, content: string): Promise<{ path: string; size: number }> {
    const id = this.requireWs(ws);
    return this.rpc<{ path: string; size: number }>('write', {
      workspaceId: id,
      path,
      content,
    });
  }

  async writeBytes(
    ws: string,
    path: string,
    bytes: ArrayBuffer,
  ): Promise<{ path: string; size: number }> {
    const id = this.requireWs(ws);
    // No transfer on purpose: the caller keeps ownership of `bytes`.
    return this.rpc<{ path: string; size: number }>('writeBytes', {
      workspaceId: id,
      path,
      bytes,
    });
  }

  async edit(
    ws: string,
    path: string,
    opts: { find?: string; replace?: string; all?: boolean; content?: string },
  ): Promise<{
    changed: number;
    diff: { filename: string; additions: number; deletions: number; lines: ContainerDiffLine[] };
    diffTruncated?: boolean;
  }> {
    const id = this.requireWs(ws);
    const args: Record<string, unknown> = { workspaceId: id, path };
    if (opts.find !== undefined) args.find = opts.find;
    if (opts.replace !== undefined) args.replace = opts.replace;
    if (opts.all !== undefined) args.all = opts.all;
    if (opts.content !== undefined) args.content = opts.content;
    return this.rpc<{
      changed: number;
      diff: { filename: string; additions: number; deletions: number; lines: ContainerDiffLine[] };
      diffTruncated?: boolean;
    }>('edit', args);
  }

  async delete(ws: string, path: string): Promise<{ deleted: boolean }> {
    const id = this.requireWs(ws);
    return this.rpc<{ deleted: boolean }>('delete', { workspaceId: id, path });
  }

  async mkdir(ws: string, path: string): Promise<{ path: string }> {
    const id = this.requireWs(ws);
    return this.rpc<{ path: string }>('mkdir', { workspaceId: id, path });
  }

  async extractZip(
    ws: string,
    path: string,
    dest?: string,
  ): Promise<{ dest: string; files: { name: string; size: number }[]; count: number }> {
    const id = this.requireWs(ws);
    const args: Record<string, unknown> = { workspaceId: id, path };
    if (dest !== undefined) args.dest = dest;
    return this.rpc<{ dest: string; files: { name: string; size: number }[]; count: number }>(
      'extractZip',
      args,
    );
  }

  async createZip(
    ws: string,
    sources: string[],
    dest: string,
  ): Promise<{ dest: string; count: number; size: number }> {
    const id = this.requireWs(ws);
    return this.rpc<{ dest: string; count: number; size: number }>('createZip', {
      workspaceId: id,
      sources,
      dest,
    });
  }

  async zipList(ws: string, path: string): Promise<{ entries: ContainerZipEntry[]; count: number }> {
    const id = this.requireWs(ws);
    return this.rpc<{ entries: ContainerZipEntry[]; count: number }>('zipList', {
      workspaceId: id,
      path,
    });
  }

  async search(
    ws: string,
    query: string,
    opts?: { path?: string; regex?: boolean; maxResults?: number },
  ): Promise<{ matches: ContainerSearchMatch[]; truncated?: boolean }> {
    const id = this.requireWs(ws);
    const args: Record<string, unknown> = { workspaceId: id, query };
    if (opts?.path !== undefined) args.path = opts.path;
    if (opts?.regex !== undefined) args.regex = opts.regex;
    if (opts?.maxResults !== undefined) args.maxResults = opts.maxResults;
    return this.rpc<{ matches: ContainerSearchMatch[]; truncated?: boolean }>('search', args);
  }

  async fileInfo(ws: string, path: string): Promise<ContainerFileInfo> {
    const id = this.requireWs(ws);
    return this.rpc<ContainerFileInfo>('fileInfo', { workspaceId: id, path });
  }

  // ────────────────────────────────────────────────────────────────────────
  // Public API — execution
  // ────────────────────────────────────────────────────────────────────────

  /** Run python code (or a workspace .py file) in the workspace root. */
  async execCode(
    ws: string,
    opts: { code?: string; file?: string } & ExecOptions,
  ): Promise<ContainerExecResult> {
    const id = this.requireWs(ws);
    const args: Record<string, unknown> = { workspaceId: id, execId: this.nextExecId() };
    if (opts.code !== undefined) args.code = opts.code;
    if (opts.file !== undefined) args.file = opts.file;
    return this.runExec('execCode', args, opts);
  }

  /** Run a mini-shell command line (supports '&&' chains). */
  async execCommand(ws: string, command: string, opts?: ExecOptions): Promise<ContainerExecResult> {
    const id = this.requireWs(ws);
    const args: Record<string, unknown> = {
      workspaceId: id,
      command,
      execId: this.nextExecId(),
    };
    return this.runExec('execCommand', args, opts ?? {});
  }

  /**
   * Serialize execs client-side: each exec starts only after the previous
   * one settled (the worker additionally rejects overlaps with a busy
   * error as a guard).
   */
  private runExec(
    op: 'execCode' | 'execCommand',
    args: Record<string, unknown>,
    opts: ExecOptions,
  ): Promise<ContainerExecResult> {
    const start = (): Promise<ContainerExecResult> => this.startExec(op, args, opts);
    const chained = this.execChain.then(start, start);
    this.execChain = chained.then(
      () => undefined,
      () => undefined,
    );
    return chained;
  }

  private startExec(
    op: 'execCode' | 'execCommand',
    args: Record<string, unknown>,
    opts: ExecOptions,
  ): Promise<ContainerExecResult> {
    return new Promise<ContainerExecResult>((resolve, reject) => {
      void this.ensureBooted().then(
        () => {
          const execId = String(args.execId);
          const entry: PendingRpc = {
            rpcId: 0, // assigned below, before posting
            // narrow cast: the stashed worker result is a ContainerExecResult
            resolve: (value) => resolve(value as ContainerExecResult),
            reject,
            timer: null,
            execId,
            onStdout: opts.onStdout,
            onStderr: opts.onStderr,
          };
          const id = ++this.rpcId;
          entry.rpcId = id;
          entry.timer = setTimeout(() => {
            this.pending.delete(id);
            this.execs.delete(execId);
            reject(new Error('Execution exceeded the 15 minute safety limit'));
          }, EXEC_SAFETY_MS);
          this.pending.set(id, entry);
          this.execs.set(execId, entry);
          this.post({ type: 'rpc', id, op, args });
        },
        (err: unknown) => {
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // Public API — downloads
  // ────────────────────────────────────────────────────────────────────────

  async downloadFile(ws: string, path: string): Promise<ContainerDownload> {
    const id = this.requireWs(ws);
    const buf = await this.readBytes(id, path);
    const name = path.split('/').pop() || path || 'file';
    const blob = new Blob([buf]);
    const url = URL.createObjectURL(blob);
    return {
      url,
      name,
      size: blob.size,
      revoke: () => URL.revokeObjectURL(url),
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // Worker message handling
  // ────────────────────────────────────────────────────────────────────────

  private handleWorkerMessage(data: unknown): void {
    if (!isRecord(data)) return;
    switch (data.type) {
      case 'ready':
        this.handleReady();
        return;
      case 'boot-error':
        this.handleBootError(
          typeof data.message === 'string' ? data.message : 'Unknown boot error',
        );
        return;
      case 'rpc':
        this.handleRpcReply(data);
        return;
      case 'fs':
        this.handleFsWireEvent(data);
        return;
      case 'stdout':
      case 'stderr':
        this.handleStreamEvent(data.type, data);
        return;
      case 'exec-end':
        this.handleExecEnd(data);
        return;
      default:
        return; // unknown event: ignore
    }
  }

  private handleReady(): void {
    if (this.status === 'error') return; // stale late ready after a reset
    this.status = 'ready';
    this.bootPromise = null;
    const resolve = this.bootResolve;
    this.bootResolve = null;
    this.bootReject = null;
    this.notifyStatus();
    if (resolve) resolve();
  }

  private handleBootError(message: string): void {
    if (this.status === 'ready') return; // late/stray error: container works
    console.warn('[rge-container] boot failed:', message);
    this.status = 'error';
    this.bootPromise = null;
    const rejectBoot = this.bootReject;
    this.bootResolve = null;
    this.bootReject = null;
    // The worker stays dead: fail every in-flight RPC and exec.
    const err = new Error(`Container failed to boot: ${message}`);
    for (const entry of this.pending.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
    this.execs.clear();
    this.notifyStatus();
    if (rejectBoot) rejectBoot(new Error(message));
  }

  private handleRpcReply(data: Record<string, unknown>): void {
    const id = data.id;
    if (typeof id !== 'number') return;
    const entry = this.pending.get(id);
    if (!entry) return; // timed out / unknown: ignore
    if (data.ok === true) {
      this.pending.delete(id);
      if (entry.timer) clearTimeout(entry.timer);
      if (entry.execId) {
        // Exec RPCs resolve on exec-end, not on the reply: stash the result.
        entry.execResult =
          asExecResult(data.result) ??
          ({ ok: true, exitCode: 0, output: '', durationMs: 0 } as ContainerExecResult);
        return;
      }
      entry.resolve(data.result);
    } else if (data.ok === false) {
      this.pending.delete(id);
      if (entry.timer) clearTimeout(entry.timer);
      if (entry.execId) this.execs.delete(entry.execId);
      entry.reject(new Error(typeof data.error === 'string' ? data.error : 'Container RPC failed'));
    }
  }

  private handleStreamEvent(kind: 'stdout' | 'stderr', data: Record<string, unknown>): void {
    if (typeof data.execId !== 'string' || typeof data.text !== 'string') return;
    const entry = this.execs.get(data.execId);
    if (!entry) return;
    try {
      if (kind === 'stdout') entry.onStdout?.(data.text);
      else entry.onStderr?.(data.text);
    } catch {
      // subscriber bugs never break routing
    }
  }

  private handleExecEnd(data: Record<string, unknown>): void {
    if (typeof data.execId !== 'string') return;
    const entry = this.execs.get(data.execId);
    if (!entry) return;
    this.execs.delete(data.execId);
    if (entry.timer) clearTimeout(entry.timer);
    const ok = data.ok === true;
    // The worker posts the RPC reply BEFORE exec-end, so entry.execResult is
    // normally set; synthesize a minimal result as a fallback regardless.
    const result: ContainerExecResult =
      entry.execResult ??
      ({
        ok,
        exitCode: ok ? 0 : 1,
        output: '',
        durationMs: typeof data.durationMs === 'number' ? data.durationMs : 0,
        ...(typeof data.error === 'string' ? { error: data.error } : {}),
      } as ContainerExecResult);
    entry.resolve(result);
  }

  /**
   * Wire fs event: { type: 'fs', workspace, paths: [{ path, dir }] } where
   * an entry { path: '*' } means "bulk change — refresh everything". The '*'
   * marker is translated to the '*' payload for subscribers.
   */
  private handleFsWireEvent(data: Record<string, unknown>): void {
    if (typeof data.workspace !== 'string' || !Array.isArray(data.paths)) return;
    const entries: ContainerFsPath[] = [];
    let star = false;
    for (const item of data.paths) {
      if (!isRecord(item)) continue;
      if (typeof item.path !== 'string' || typeof item.dir !== 'boolean') continue;
      if (item.path === '*') {
        star = true;
        continue;
      }
      entries.push({ path: item.path, dir: item.dir });
    }
    const payload: ContainerFsPayload = star ? '*' : entries;

    for (const fn of [...this.fsSubs]) {
      try {
        fn(data.workspace, payload);
      } catch {
        // subscriber bugs never break the client
      }
    }

    // ── persistence ──
    if (typeof window === 'undefined') return;
    if (this.restoring.has(data.workspace)) return; // muted during restore
    if (star) {
      this.schedulePersistAll(data.workspace);
      return;
    }
    let dirEvent = false;
    for (const e of entries) {
      if (e.dir) {
        // A directory event may hide deletions of everything beneath it —
        // only a full rebuild can prune those records.
        dirEvent = true;
        continue;
      }
      void this.upsertPersisted(data.workspace, e.path);
    }
    if (dirEvent) this.schedulePersistAll(data.workspace);
  }

  // ────────────────────────────────────────────────────────────────────────
  // IndexedDB persistence
  // ────────────────────────────────────────────────────────────────────────

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_FILES)) {
          const store = db.createObjectStore(STORE_FILES, { keyPath: ['ws', 'path'] });
          store.createIndex('ws', 'ws', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'ws' });
        }
      };
      req.onsuccess = () => {
        req.result.onversionchange = () => req.result.close();
        resolve(req.result);
      };
      req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
      req.onblocked = () => reject(new Error('IndexedDB open blocked'));
    });
    return this.dbPromise;
  }

  private async getAllFileRecords(ws: string): Promise<FileRecord[]> {
    const db = await this.openDb();
    return new Promise<FileRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_FILES, 'readonly');
      const req = tx.objectStore(STORE_FILES).index('ws').getAll(ws);
      req.onsuccess = () => {
        const rows: unknown[] = req.result ?? [];
        resolve(rows.filter(isFileRecord));
      };
      req.onerror = () => reject(req.error ?? new Error('IDB getAll failed'));
    });
  }

  private async putFileRecord(record: FileRecord): Promise<void> {
    const db = await this.openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_FILES, 'readwrite');
      tx.objectStore(STORE_FILES).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IDB write failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IDB write aborted'));
    });
  }

  private async putMeta(ws: string): Promise<void> {
    const db = await this.openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readwrite');
      tx.objectStore(STORE_META).put({ ws, updatedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IDB meta write failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IDB meta write aborted'));
    });
  }

  /** Delete every file record of `ws` whose path is not in `live`. */
  private async pruneFileRecords(ws: string, live: Set<string>): Promise<void> {
    const db = await this.openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_FILES, 'readwrite');
      const req = tx.objectStore(STORE_FILES).index('ws').openCursor(ws);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const value: unknown = cursor.value;
        if (isFileRecord(value) && !live.has(value.path)) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IDB prune failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IDB prune aborted'));
    });
  }

  /** Persist one changed file (precise fs events). */
  private async upsertPersisted(ws: string, path: string): Promise<void> {
    try {
      const buf = await this.rpc<ArrayBuffer>(
        'readBytes',
        { workspaceId: ws, path },
        READ_BYTES_TIMEOUT_MS,
      );
      if (buf.byteLength > MAX_PERSIST_BYTES) return; // oversized: no-op
      await this.putFileRecord({
        ws,
        path,
        blob: new Blob([buf]),
        size: buf.byteLength,
        updatedAt: Date.now(),
      });
    } catch {
      // The file may have been deleted between the event and this read —
      // rebuild the record set instead.
      this.schedulePersistAll(ws);
    }
  }

  /** Debounced full rebuild of one workspace's records. */
  private schedulePersistAll(ws: string): void {
    if (typeof window === 'undefined') return;
    const prev = this.persistTimers.get(ws);
    if (prev) clearTimeout(prev);
    this.persistTimers.set(
      ws,
      setTimeout(() => {
        this.persistTimers.delete(ws);
        if (this.persistInFlight.has(ws)) {
          // A run is active: re-schedule for after it finishes.
          this.schedulePersistAll(ws);
          return;
        }
        void this.persistAll(ws);
      }, PERSIST_DEBOUNCE_MS),
    );
  }

  /**
   * Rebuild the IndexedDB records for one workspace from the worker's
   * current listing: upsert changed/missing files (mtime+size matched
   * records are skipped), prune records for deleted files, touch meta.
   * Never throws — persistence failures never break the container.
   */
  private async persistAll(ws: string): Promise<void> {
    // Never prune a workspace that has not been restored this session (a
    // fresh/empty worker FS must not wipe persisted data).
    if (!this.restored.has(ws)) return;
    if (this.persistInFlight.has(ws)) {
      this.schedulePersistAll(ws);
      return;
    }
    this.persistInFlight.add(ws);
    try {
      const listed = await this.rpc<{ nodes: ContainerFileNode[] }>(
        'list',
        { workspaceId: ws },
        PERSIST_LIST_TIMEOUT_MS,
      );
      let records: FileRecord[] = [];
      try {
        records = await this.getAllFileRecords(ws);
      } catch {
        records = [];
      }
      const byPath = new Map(records.map((r) => [r.path, r]));
      const live = new Set<string>();
      for (const node of listed.nodes) {
        if (node.dir) continue;
        live.add(node.path);
        const existing = byPath.get(node.path);
        if (existing && existing.size === node.size && existing.mtime === node.mtime) continue;
        if (node.size > MAX_PERSIST_BYTES) continue;
        const buf = await this.rpc<ArrayBuffer>(
          'readBytes',
          { workspaceId: ws, path: node.path },
          READ_BYTES_TIMEOUT_MS,
        ).catch(() => null);
        if (!buf || buf.byteLength > MAX_PERSIST_BYTES) continue;
        await this.putFileRecord({
          ws,
          path: node.path,
          blob: new Blob([buf]),
          size: buf.byteLength,
          updatedAt: Date.now(),
          mtime: node.mtime,
        }).catch(() => {});
      }
      await this.pruneFileRecords(ws, live).catch(() => {});
      await this.putMeta(ws).catch(() => {});
    } catch {
      // persistence failures never break the container
    } finally {
      this.persistInFlight.delete(ws);
    }
  }

  /** Restore one workspace from IndexedDB into the worker (first ensure). */
  private async doRestore(ws: string): Promise<void> {
    if (typeof window === 'undefined') return;
    this.restoring.add(ws);
    try {
      const records = await this.getAllFileRecords(ws);
      for (const rec of records) {
        if (rec.size > MAX_PERSIST_BYTES) continue; // never persisted
        try {
          const buf = await rec.blob.arrayBuffer();
          await this.rpc('writeBytes', { workspaceId: ws, path: rec.path, bytes: buf });
        } catch {
          // one bad record must not abort the whole restore
        }
      }
      // Stamp current worker mtimes into the records so the next persistAll
      // pass does not re-read every restored file.
      try {
        const listed = await this.rpc<{ nodes: ContainerFileNode[] }>(
          'list',
          { workspaceId: ws },
          PERSIST_LIST_TIMEOUT_MS,
        );
        const mtimeByPath = new Map<string, number>();
        for (const node of listed.nodes) {
          if (!node.dir) mtimeByPath.set(node.path, node.mtime);
        }
        for (const rec of records) {
          const mtime = mtimeByPath.get(rec.path);
          if (typeof mtime === 'number' && mtime !== rec.mtime) {
            await this.putFileRecord({ ...rec, mtime }).catch(() => {});
          }
        }
      } catch {
        // optional optimization: ignore failures
      }
    } catch {
      // IndexedDB unavailable/broken: the container still works, just
      // without persistence. Never rethrow.
    } finally {
      this.restoring.delete(ws);
      this.restored.add(ws);
      // Catch up on any fs events that were muted while restoring.
      this.schedulePersistAll(ws);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Singleton
// ────────────────────────────────────────────────────────────────────────────

let containerInstance: ContainerClient | null = null;

/** Lazy singleton — the worker is only created by the first boot(). */
export function getContainer(): ContainerClient {
  if (!containerInstance) containerInstance = new ContainerClient();
  return containerInstance;
}
