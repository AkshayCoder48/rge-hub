/**
 * RGE Agent — web container protocol types (PURE — client safe).
 *
 * The container is a PERSISTENT in-browser runtime (Pyodide/Python) inside a
 * Web Worker, owned by public/rge-container.js. The main thread talks to it
 * through the RPC + event protocol below (container-client.ts).
 *
 *   main → worker : { type: 'rpc', id, op, args }
 *   worker → main : { type: 'ready' }
 *                   { type: 'boot-error', message }
 *                   { type: 'rpc', id, ok, result?, error? }
 *                   { type: 'fs', workspace, paths: [{path, dir}] }
 *                   { type: 'stdout'|'stderr', execId, text }
 *                   { type: 'exec-end', execId, ok, error?, durationMs }
 */

/** One node of a recursive workspace listing. */
export interface ContainerFileNode {
  /** Workspace-relative path, e.g. "hub/pack.zip" or "extracted/pack". */
  path: string;
  name: string;
  dir: boolean;
  size: number;
  mtime: number;
}

export interface ContainerSearchMatch {
  path: string;
  line: number;
  text: string;
}

export interface ContainerZipEntry {
  name: string;
  size: number;
}

export interface ContainerFileInfo {
  path: string;
  name: string;
  dir: boolean;
  size: number;
  mtime: number;
  mime?: string;
  /** First 4 KB of the file decoded as UTF-8, when text preview was asked. */
  preview?: string;
  isText?: boolean;
}

export interface ContainerDiffLine {
  kind: 'context' | 'added' | 'removed';
  text: string;
}

export interface ContainerExecResult {
  ok: boolean;
  exitCode: number;
  /** Captured stdout+stderr (already streamed live; this is the summary). */
  output: string;
  error?: string;
  durationMs: number;
}

/** RPC ops implemented by the worker (all scoped to a workspace id). */
export type ContainerOp =
  | 'ensureWorkspace'
  | 'list'
  | 'read'
  | 'readBytes'
  | 'write'
  | 'writeBytes'
  | 'edit'
  | 'delete'
  | 'mkdir'
  | 'extractZip'
  | 'createZip'
  | 'zipList'
  | 'search'
  | 'fileInfo'
  | 'execCode'
  | 'execCommand';

export type ContainerStatus = 'idle' | 'booting' | 'ready' | 'error';
