'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/hooks/use-toast';
import { useResourceStore } from '@/lib/resource-store';
import type { Resource } from '@/lib/resources';
import {
  X,
  Upload,
  FileCode,
  Film,
  Image as ImageIcon,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Ban,
  ChevronDown,
} from 'lucide-react';
import {
  type UploadErrorCode,
  uploadErrorMessage,
} from '@/lib/upload-errors';
import { uploadInChunks, DIRECT_UPLOAD_LIMIT } from '@/lib/chunked-client';
import { GETSHARED_MAX_BYTES } from '@/lib/getshared';
import { uploadToGetshared } from '@/lib/getshared-client';
import { isQuaxEligible } from '@/lib/quax';
import { Link2, ImagePlus } from 'lucide-react';

/**
 * Upload pipeline UI — explicit state machine (PRD §8, §20, §21, §36, §37, §48).
 *
 * Per-file lifecycle:
 *   queued → uploading → uploaded → persisting → verifying → ready
 *                                                 ↘ failed (retryable) / cancelled
 *
 * - Real upload progress via XHR (bytes, %, MB/s, ETA) — never faked.
 * - Phase 1 (file transfer) and Phase 2 (DB registration) are separate states
 *   with separate retries: a registration failure reuses the uploaded fileId
 *   instead of re-uploading (PRD §22, §23).
 * - "Upload complete" is only shown after storage + DB verification (PRD §2).
 * - Multiple files are processed as a queue, one at a time, to stay friendly
 *   to storage rate limits.
 */

// Keep in sync with MAX_SIMPLE_UPLOAD_BYTES in src/lib/onyxbase.ts (server).
// Files up to this size go through our own storage pipeline (permanent).
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
// Bigger clips/files (up to 5GB) upload straight from the browser to getshared
// and are stored as URL-only records (no bytes/base64 in OnyxBase).
const MAX_EXTERNAL_BYTES = GETSHARED_MAX_BYTES;

type ItemStatus =
  | 'queued'
  | 'uploading'
  | 'uploaded'
  | 'persisting'
  | 'verifying'
  | 'ready'
  | 'failed'
  | 'cancelled';

interface ItemProgress {
  loaded: number;
  total: number;
  pct: number;
  speedBps: number | null;
  etaSecs: number | null;
}

interface QueueItem {
  uid: string;
  clientId: string;
  file: File;
  title: string;
  status: ItemStatus;
  progress: ItemProgress;
  errorCode: UploadErrorCode | null;
  error: string | null;
  fileId?: string;
  fileUrl?: string;
  resourceId?: string;
  timings?: Record<string, number>;
  /** Which backend stored this file (set during transfer). */
  via?: 'hub' | 'getshared' | 'quax';
  /** Optional cover thumbnail (all types). Uploaded as an image first. */
  thumbnailFile?: File;
  thumbnailPreview?: string;
  thumbnailFileId?: string;
  thumbnailUrl?: string;
}

interface UploadModalProps {
  type: 'image' | 'clip' | 'xml';
  onClose: () => void;
  onSuccess: () => void;
  /** Prefilled files (e.g. SpeedRamp studio publish) — queued on open. */
  initialFiles?: File[];
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg', 'bmp', 'ico', 'tiff', 'tif'];
const CLIP_EXTS = ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', '3gp', 'ogv'];

function extOf(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

function fmtBytes(n: number): string {
  if (!n || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtSpeed(bps: number | null): string {
  if (bps === null || !isFinite(bps) || bps <= 0) return '';
  if (bps < 1024) return `${bps.toFixed(0)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / 1024 / 1024).toFixed(2)} MB/s`;
}

function fmtEta(secs: number | null): string {
  if (secs === null || !isFinite(secs) || secs < 0) return '';
  if (secs < 1) return '<1s left';
  if (secs < 60) return `~${Math.ceil(secs)}s left`;
  return `~${Math.floor(secs / 60)}m ${Math.ceil(secs % 60)}s left`;
}

function makeUid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function makeClientId(): string {
  // [a-z0-9] only, 8-64 chars — satisfies the server idempotency format.
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

const STATUS_LABEL: Record<ItemStatus, string> = {
  queued: 'Queued',
  uploading: 'Uploading',
  uploaded: 'Uploaded',
  persisting: 'Saving',
  verifying: 'Verifying',
  ready: 'Ready',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function UploadModal({ type, onClose, onSuccess, initialFiles }: UploadModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const upsertLocal = useResourceStore((s) => s.upsertLocal);

  const [step, setStep] = useState<'select' | 'queue'>('select');
  const [items, setItems] = useState<QueueItem[]>([]);
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [published, setPublished] = useState(true);
  const [running, setRunning] = useState(false);
  const [selectTab, setSelectTab] = useState<'file' | 'link'>('file');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [linkSaving, setLinkSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const thumbInputRef = useRef<HTMLInputElement>(null);
  const thumbTargetUid = useRef<string | null>(null);

  const itemsRef = useRef<QueueItem[]>([]);
  const xhrRefs = useRef(new Map<string, XMLHttpRequest>());
  const gsAbortRefs = useRef(new Map<string, AbortController>());
  const speedRefs = useRef(new Map<string, { loaded: number; t: number; smooth: number | null }>());
  const stopRef = useRef(false);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Abort any in-flight transfers on unmount.
  useEffect(() => {
    const m = xhrRefs.current;
    const g = gsAbortRefs.current;
    return () => {
      m.forEach((xhr) => {
        try {
          xhr.abort();
        } catch {}
      });
      m.clear();
      g.forEach((ctrl) => {
        try {
          ctrl.abort();
        } catch {}
      });
      g.clear();
    };
  }, []);

  const TypeIcon = type === 'image' ? ImageIcon : type === 'clip' ? Film : FileCode;
  // "Files" accepts anything (xml, zip, pdf, apk, ...); clips stay video-only.
  const accept = type === 'image' ? 'image/*' : type === 'clip' ? 'video/*' : undefined;
  const typeLabel = type === 'xml' ? 'file' : type;
  const sizeLimit = type === 'image' ? MAX_UPLOAD_BYTES : MAX_EXTERNAL_BYTES;

  const updateItem = useCallback((uid: string, patch: Partial<QueueItem>) => {
    setItems((prev) => prev.map((it) => (it.uid === uid ? { ...it, ...patch } : it)));
  }, []);

  const getItem = useCallback((uid: string): QueueItem | undefined => {
    return itemsRef.current.find((it) => it.uid === uid);
  }, []);

  // ---------- file selection ----------

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const arr = Array.from(files);
      if (arr.length === 0) return;
      const fresh: QueueItem[] = arr.map((file) => ({
        uid: makeUid(),
        clientId: makeClientId(),
        file,
        title: file.name.replace(/\.[^/.]+$/, ''),
        status: 'queued' as ItemStatus,
        progress: { loaded: 0, total: file.size, pct: 0, speedBps: null, etaSecs: null },
        errorCode: null,
        error: null,
      }));
      setItems((prev) => [...prev, ...fresh]);
      setStep('queue');
    },
    []
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  // Prefilled files (e.g. SpeedRamp studio "Upload to Community").
  // StrictMode-safe: the consumed flag survives mount/unmount/remount.
  const prefillConsumed = useRef(false);
  useEffect(() => {
    if (initialFiles && initialFiles.length > 0 && !prefillConsumed.current) {
      prefillConsumed.current = true;
      addFiles(initialFiles);
    }
  }, [initialFiles, addFiles]);

  // ---------- validation (PRD §38, §39) ----------

  const validateItem = useCallback(
    (item: QueueItem): { ok: true } | { ok: false; code: UploadErrorCode; error: string } => {
      const { file } = item;
      if (!item.title.trim()) {
        return { ok: false, code: 'UPLOAD_STORAGE_ERROR', error: 'Title is required' };
      }
      if (file.size === 0) {
        return { ok: false, code: 'UPLOAD_STORAGE_ERROR', error: 'File is empty (0 bytes)' };
      }
      // Images ride our own pipeline (50MB); clips/files above 50MB go to
      // getshared direct from the browser (5GB max, URL-only record).
      const limit = type === 'image' ? MAX_UPLOAD_BYTES : MAX_EXTERNAL_BYTES;
      if (file.size > limit) {
        return {
          ok: false,
          code: 'FILE_SIZE_ERROR',
          error: `"${file.name}" is ${fmtBytes(file.size)} — limit is ${fmtBytes(limit)} per file.`,
        };
      }
      const ext = extOf(file.name);
      const mime = (file.type || '').toLowerCase();
      if (type === 'image' && !(mime.startsWith('image/') || IMAGE_EXTS.includes(ext))) {
        return { ok: false, code: 'FILE_TYPE_ERROR', error: `"${file.name}" is not an image file.` };
      }
      if (type === 'clip' && !(mime.startsWith('video/') || CLIP_EXTS.includes(ext))) {
        return { ok: false, code: 'FILE_TYPE_ERROR', error: `"${file.name}" is not a video file.` };
      }
      // type 'xml' ("Files") accepts any file — no extension check.
      return { ok: true };
    },
    [type]
  );

  // ---------- Phase 1: file transfer with real progress ----------
  //
  // Small files use a single XHR (real upload progress). Large files are
  // sliced into chunks (defeats the ~4.5MB Vercel request cap) and the
  // server assembles + stores them via /api/resources/upload-complete.

  interface TransferResult {
    fileId: string;
    fileUrl: string;
    fileName: string;
    mimeType: string;
    size: number;
    storageUrl?: string;
    mirrorUrl?: string;
    mirrorHost?: string;
    bytesStored?: boolean;
    bytesShards?: number;
    timings?: Record<string, number>;
  }

  const uploadTransferChunked = useCallback(
    async (item: QueueItem): Promise<TransferResult> => {
      updateItem(item.uid, {
        progress: { loaded: 0, total: item.file.size, pct: 0, speedBps: null, etaSecs: null },
      });
      const t0 = Date.now();
      const { uploadId } = await uploadInChunks(item.file, {
        onProgress: (p) => {
          const elapsed = Math.max((Date.now() - t0) / 1000, 0.001);
          const speed = p.sentBytes / elapsed;
          updateItem(item.uid, {
            progress: {
              loaded: p.sentBytes,
              total: p.totalBytes,
              pct: Math.min(95, p.pct),
              speedBps: speed,
              etaSecs: speed > 0 ? (p.totalBytes - p.sentBytes) / speed : null,
            },
          });
        },
      });
      updateItem(item.uid, {
        progress: { loaded: item.file.size, total: item.file.size, pct: 97, speedBps: null, etaSecs: null },
      });
      const res = await fetch('/api/resources/upload-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId,
          fileName: item.file.name,
          mimeType: item.file.type || 'application/octet-stream',
          label: `${type}_${item.clientId}`,
          kind: type,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw {
          code: (data.code as UploadErrorCode) || 'UPLOAD_STORAGE_ERROR',
          error: (data.error as string) || `Upload failed (HTTP ${res.status})`,
        };
      }
      updateItem(item.uid, {
        progress: { loaded: item.file.size, total: item.file.size, pct: 100, speedBps: null, etaSecs: null },
      });
      return {
        fileId: data.fileId as string,
        fileUrl: data.url as string,
        fileName: (data.fileName as string) || item.file.name,
        mimeType: (data.mimeType as string) || item.file.type,
        size: (data.size as number) ?? item.file.size,
        storageUrl: data.storageUrl as string | undefined,
        mirrorUrl: data.mirrorUrl as string | undefined,
        mirrorHost: data.mirrorHost as string | undefined,
        bytesStored: data.bytesStored as boolean | undefined,
        bytesShards: data.bytesShards as number | undefined,
        timings: data.timings as Record<string, number> | undefined,
      };
    },
    [type, updateItem]
  );

  // Small qu.ax relay (single request, permanent storage): real XHR progress.
  const uploadTransferQuaxSingle = useCallback(
    (item: QueueItem): Promise<TransferResult> => {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRefs.current.set(item.uid, xhr);
        updateItem(item.uid, { via: 'quax' });
        xhr.upload.onprogress = (ev) => {
          if (!ev.lengthComputable) return;
          updateItem(item.uid, {
            progress: {
              loaded: ev.loaded,
              total: ev.total,
              pct: Math.min(99, Math.round((ev.loaded / ev.total) * 100)),
              speedBps: null,
              etaSecs: null,
            },
          });
        };
        xhr.onreadystatechange = () => {
          if (xhr.readyState !== XMLHttpRequest.DONE) return;
          xhrRefs.current.delete(item.uid);
          if (xhr.status === 0) {
            reject({ code: 'UPLOAD_CANCELLED' as UploadErrorCode, cancelled: true });
            return;
          }
          let data: Record<string, unknown> = {};
          try {
            data = JSON.parse(xhr.responseText || '{}');
          } catch {}
          if (xhr.status >= 200 && xhr.status < 300 && data.ok) {
            updateItem(item.uid, {
              progress: { loaded: item.file.size, total: item.file.size, pct: 100, speedBps: null, etaSecs: null },
            });
            resolve({
              fileId: data.fileId as string,
              fileUrl: data.url as string,
              fileName: (data.fileName as string) || item.file.name,
              mimeType: (data.mimeType as string) || item.file.type,
              size: (data.size as number) ?? item.file.size,
              storageUrl: data.storageUrl as string | undefined,
              mirrorHost: ((data.mirrorHost as string) || 'quax') as string,
            });
          } else {
            reject({
              code: (data.code as UploadErrorCode) || 'UPLOAD_STORAGE_ERROR',
              error: (data.error as string) || `qu.ax relay failed (HTTP ${xhr.status}).`,
            });
          }
        };
        xhr.onerror = () => {
          xhrRefs.current.delete(item.uid);
          reject({ code: 'UPLOAD_NETWORK_ERROR' as UploadErrorCode, error: 'Network error during upload.' });
        };
        const formData = new FormData();
        formData.append('file', item.file);
        formData.append('kind', type);
        xhr.open('POST', '/api/quax/upload');
        xhr.send(formData);
      });
    },
    [type, updateItem]
  );

  // Large qu.ax relay (chunked staging, then one permanent qu.ax POST).
  const uploadTransferQuaxChunked = useCallback(
    async (item: QueueItem): Promise<TransferResult> => {
      updateItem(item.uid, {
        via: 'quax',
        progress: { loaded: 0, total: item.file.size, pct: 0, speedBps: null, etaSecs: null },
      });
      const t0 = Date.now();
      const { uploadId } = await uploadInChunks(item.file, {
        onProgress: (p) => {
          const elapsed = Math.max((Date.now() - t0) / 1000, 0.001);
          const speed = p.sentBytes / elapsed;
          updateItem(item.uid, {
            progress: {
              loaded: p.sentBytes,
              total: p.totalBytes,
              pct: Math.min(95, p.pct),
              speedBps: speed,
              etaSecs: speed > 0 ? (p.totalBytes - p.sentBytes) / speed : null,
            },
          });
        },
      });
      updateItem(item.uid, {
        progress: { loaded: item.file.size, total: item.file.size, pct: 97, speedBps: null, etaSecs: null },
      });
      const res = await fetch('/api/quax/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId,
          fileName: item.file.name,
          mimeType: item.file.type || 'application/octet-stream',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw {
          code: (data.code as UploadErrorCode) || 'UPLOAD_STORAGE_ERROR',
          error: (data.error as string) || `qu.ax relay failed (HTTP ${res.status}).`,
        };
      }
      updateItem(item.uid, {
        progress: { loaded: item.file.size, total: item.file.size, pct: 100, speedBps: null, etaSecs: null },
      });
      return {
        fileId: data.fileId as string,
        fileUrl: data.url as string,
        fileName: (data.fileName as string) || item.file.name,
        mimeType: (data.mimeType as string) || item.file.type,
        size: (data.size as number) ?? item.file.size,
        storageUrl: data.storageUrl as string | undefined,
        mirrorHost: ((data.mirrorHost as string) || 'quax') as string,
      };
    },
    [updateItem]
  );

  // Large clips/files (>50MB, up to 5GB) upload straight from the browser to
  // getshared and are stored as URL-only records (no bytes/base64 in OnyxBase).
  const uploadTransferGetshared = useCallback(
    async (item: QueueItem): Promise<TransferResult> => {
      const ctrl = new AbortController();
      gsAbortRefs.current.set(item.uid, ctrl);
      updateItem(item.uid, {
        via: 'getshared',
        progress: { loaded: 0, total: item.file.size, pct: 0, speedBps: null, etaSecs: null },
      });
      const t0 = Date.now();
      try {
        const g = await uploadToGetshared(item.file, {
          signal: ctrl.signal,
          onProgress: (p) => {
            const elapsed = Math.max((Date.now() - t0) / 1000, 0.001);
            const speed = p.loaded / elapsed;
            updateItem(item.uid, {
              progress: {
                loaded: p.loaded,
                total: p.total,
                pct: p.pct,
                speedBps: speed,
                etaSecs: speed > 0 ? (p.total - p.loaded) / speed : null,
              },
            });
          },
        });
        updateItem(item.uid, {
          progress: { loaded: item.file.size, total: item.file.size, pct: 100, speedBps: null, etaSecs: null },
        });
        return {
          fileId: g.fileId,
          fileUrl: g.downloadUrl,
          fileName: item.file.name,
          mimeType: item.file.type || 'application/octet-stream',
          size: item.file.size,
          storageUrl: g.shareUrl,
          mirrorHost: 'getshared',
          timings: { total_upload_ms: Date.now() - t0, attempts: 1 },
        };
      } catch (err) {
        if ((err as Error)?.name === 'AbortError' || ctrl.signal.aborted) {
          throw { code: 'UPLOAD_CANCELLED' as UploadErrorCode, cancelled: true };
        }
        throw {
          code: 'UPLOAD_STORAGE_ERROR' as UploadErrorCode,
          error: err instanceof Error ? err.message : 'Large-file upload failed.',
        };
      } finally {
        gsAbortRefs.current.delete(item.uid);
      }
    },
    [updateItem]
  );

  const uploadTransfer = useCallback(
    async (item: QueueItem): Promise<TransferResult> => {
      // Clips/files: qu.ax permanent storage when eligible (hub relay — qu.ax
      // has no CORS), else getshared direct from the browser (up to 5GB).
      // qu.ax failures auto-fall-back to getshared so the item still uploads.
      if (type !== 'image') {
        if (isQuaxEligible(item.file.name, item.file.size)) {
          try {
            if (item.file.size > DIRECT_UPLOAD_LIMIT) {
              return await uploadTransferQuaxChunked(item);
            }
            return await uploadTransferQuaxSingle(item);
          } catch (e) {
            if ((e as { cancelled?: boolean })?.cancelled) throw e;
            // Fall through to getshared.
          }
        }
        return uploadTransferGetshared(item);
      }
      // Images: our own pipeline (permanent backend bytes + imghosting mirror).
      // Chunked path for files over the single-request ceiling.
      if (item.file.size > DIRECT_UPLOAD_LIMIT) {
        return uploadTransferChunked(item);
      }
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRefs.current.set(item.uid, xhr);
        speedRefs.current.set(item.uid, { loaded: 0, t: Date.now(), smooth: null });

        xhr.upload.onprogress = (ev) => {
          if (!ev.lengthComputable) return;
          const now = Date.now();
          const sample = speedRefs.current.get(item.uid) || { loaded: 0, t: now, smooth: null as number | null };
          const dt = Math.max((now - sample.t) / 1000, 0.001);
          const instant = (ev.loaded - sample.loaded) / dt;
          const smooth = sample.smooth === null ? instant : sample.smooth * 0.7 + instant * 0.3;
          speedRefs.current.set(item.uid, { loaded: ev.loaded, t: now, smooth });
          const pct = ev.total > 0 ? Math.min(99, Math.round((ev.loaded / ev.total) * 100)) : 0;
          const eta = smooth > 0 && ev.total > 0 ? (ev.total - ev.loaded) / smooth : null;
          updateItem(item.uid, {
            progress: { loaded: ev.loaded, total: ev.total, pct, speedBps: smooth, etaSecs: eta },
          });
        };

        xhr.onreadystatechange = () => {
          if (xhr.readyState !== XMLHttpRequest.DONE) return;
          xhrRefs.current.delete(item.uid);
          if (xhr.status === 0) {
            // Aborted (cancel) — the cancel handler sets status; just settle.
            reject({ code: 'UPLOAD_CANCELLED' as UploadErrorCode, cancelled: true });
            return;
          }
          let data: Record<string, unknown> = {};
          try {
            data = JSON.parse(xhr.responseText || '{}');
          } catch {}
          if (xhr.status >= 200 && xhr.status < 300 && data.ok) {
            updateItem(item.uid, {
              progress: { loaded: item.file.size, total: item.file.size, pct: 100, speedBps: null, etaSecs: null },
            });
            resolve({
              fileId: data.fileId as string,
              fileUrl: data.url as string,
              fileName: (data.fileName as string) || item.file.name,
              mimeType: (data.mimeType as string) || item.file.type,
              size: (data.size as number) ?? item.file.size,
              storageUrl: data.storageUrl as string | undefined,
              mirrorUrl: data.mirrorUrl as string | undefined,
              mirrorHost: data.mirrorHost as string | undefined,
              bytesStored: data.bytesStored as boolean | undefined,
              bytesShards: data.bytesShards as number | undefined,
              timings: data.timings as Record<string, number> | undefined,
            });
          } else {
            const code = (data.code as UploadErrorCode) || 'UPLOAD_STORAGE_ERROR';
            const detail = (data.error as string) || `HTTP ${xhr.status}`;
            const retryAfter = data.retryAfter as number | undefined;
            reject({
              code,
              error:
                code === 'UPLOAD_THROTTLED' && retryAfter
                  ? `Storage is busy. Retry in ~${retryAfter}s.`
                  : detail,
              retryAfter: typeof retryAfter === 'number' ? retryAfter : undefined,
            });
          }
        };

        xhr.onerror = () => {
          xhrRefs.current.delete(item.uid);
          reject({ code: 'UPLOAD_NETWORK_ERROR' as UploadErrorCode, error: 'Network error during upload.' });
        };
        xhr.ontimeout = () => {
          xhrRefs.current.delete(item.uid);
          reject({ code: 'UPLOAD_TIMEOUT' as UploadErrorCode, error: 'Upload timed out.' });
        };

        const formData = new FormData();
        formData.append('file', item.file);
        formData.append('kind', type);
        formData.append('label', `${type}_${item.clientId}`);
        xhr.open('POST', '/api/resources/upload');
        // Hard client ceiling: the server answers <=55s (48s race +
        // overhead) or never — never stare at 100% forever.
        xhr.timeout = 58000;
        xhr.send(formData);
      });
    },
    [type, updateItem, uploadTransferChunked, uploadTransferGetshared, uploadTransferQuaxSingle, uploadTransferQuaxChunked]
  );

  // ---------- Phase 2: DB registration (idempotent) ----------

  const registerResource = useCallback(
    async (
      item: QueueItem,
      transfer: TransferResult
    ): Promise<{ resource: Resource; verified: boolean; pendingVerification: boolean }> => {
      const tagsArray = tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      // Bounded wait: the server answers in seconds when healthy; if the
      // backend is flooded the request is aborted here so "Saving…" can never
      // spin forever. Retry is safe (same clientId → idempotent, deduped).
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 65000);
      let res: Response;
      try {
        res = await fetch('/api/resources/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: ctrl.signal,
          body: JSON.stringify({
          type,
          title: item.title.trim(),
          description,
          fileId: transfer.fileId,
          downloadUrl: transfer.fileUrl,
          thumbnailFileId: item.thumbnailFileId,
          thumbnailUrl: item.thumbnailUrl,
          fileName: transfer.fileName,
          mimeType: transfer.mimeType,
          size: transfer.size,
          storageUrl: transfer.storageUrl,
          mirrorUrl: transfer.mirrorUrl,
          mirrorHost: transfer.mirrorHost,
          bytesStored: transfer.bytesStored,
          bytesShards: transfer.bytesShards,
          tags: tagsArray,
          published,
          clientId: item.clientId,
        }),
        });
      } catch (e) {
        clearTimeout(timer);
        throw {
          code: 'UPLOAD_TIMEOUT' as UploadErrorCode,
          error: 'Saving timed out — your file is kept, retry saving (no re-upload needed).',
        };
      }
      clearTimeout(timer);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        return { resource: data.resource as Resource, verified: true, pendingVerification: false };
      }
      if (res.status === 202 && data.code === 'DATABASE_VERIFICATION_ERROR' && data.resource) {
        // Write accepted, read-back still pending — verify without re-uploading.
        return { resource: data.resource as Resource, verified: false, pendingVerification: true };
      }
      const code = (data.code as UploadErrorCode) || 'DATABASE_REGISTRATION_ERROR';
      throw { code, error: (data.error as string) || 'Failed to save resource.' };
    },
    [type, description, tags, published]
  );

  // ---------- Phase 3: lightweight verification (PRD §49) ----------

  const verifyResourceRecord = useCallback(
    async (resourceId: string): Promise<Resource> => {
      let lastErr = 'Verification failed';
      for (let attempt = 0; attempt < 5; attempt++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 25000);
        try {
          const res = await fetch(
            `/api/resources/verify?id=${encodeURIComponent(resourceId)}&type=${encodeURIComponent(type)}`,
            { cache: 'no-store', signal: ctrl.signal }
          );
          const data = await res.json().catch(() => ({}));
          clearTimeout(timer);
          if (data.ok && data.verified && data.resource) {
            return data.resource as Resource;
          }
          lastErr = (data.error as string) || 'Not yet confirmed';
        } catch {
          clearTimeout(timer);
          lastErr = 'Network error during verification';
        }
        await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
      }
      throw { code: 'DATABASE_VERIFICATION_ERROR' as UploadErrorCode, error: lastErr };
    },
    [type]
  );

  // ---------- optional cover thumbnail (all types) ----------
  // Small image uploaded through our own image pipeline (mirrored like images).
  const uploadThumbnail = useCallback(
    async (item: QueueItem): Promise<{ thumbnailFileId: string; thumbnailUrl: string }> => {
      const thumb = item.thumbnailFile!;
      if (thumb.size <= DIRECT_UPLOAD_LIMIT) {
        const formData = new FormData();
        formData.append('file', thumb);
        formData.append('kind', 'image');
        formData.append('label', `thumb_${item.clientId}`);
        const res = await fetch('/api/resources/upload', {
          method: 'POST',
          body: formData,
          signal: AbortSignal.timeout(58000),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          throw { code: (data.code as UploadErrorCode) || 'UPLOAD_STORAGE_ERROR', error: (data.error as string) || 'Thumbnail upload failed.' };
        }
        return {
          thumbnailFileId: data.fileId as string,
          thumbnailUrl: ((data.mirrorUrl as string) || (data.url as string)) as string,
        };
      }
      // Large cover image → chunked path, then assemble as an image.
      const { uploadId } = await uploadInChunks(thumb, {});
      const res = await fetch('/api/resources/upload-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId,
          fileName: thumb.name,
          mimeType: thumb.type || 'image/*',
          label: `thumb_${item.clientId}`,
          kind: 'image',
        }),
        signal: AbortSignal.timeout(58000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw { code: (data.code as UploadErrorCode) || 'UPLOAD_STORAGE_ERROR', error: (data.error as string) || 'Thumbnail upload failed.' };
      }
      return {
        thumbnailFileId: data.fileId as string,
        thumbnailUrl: ((data.mirrorUrl as string) || (data.url as string)) as string,
      };
    },
    []
  );

  // ---------- per-item pipeline ----------

  const processItem = useCallback(
    async (uid: string, opts: { skipTransfer?: boolean } = {}) => {
      const item = getItem(uid);
      if (!item || stopRef.current) return;
      if (item.status === 'ready' || item.status === 'cancelled') return;

      // Validate first — never start a long upload for a rejected file.
      const check = validateItem({ ...item, title: getItem(uid)?.title ?? item.title });
      if (!check.ok) {
        updateItem(uid, { status: 'failed', errorCode: check.code, error: check.error });
        return;
      }

      try {
        // ---- Phase 0: cover thumbnail (optional; skipped on registration-only retry) ----
        // BEST-EFFORT: a cover must never kill the upload — continue
        // without one if the thumbnail leg fails.
        const thumbCheck = getItem(uid)!;
        if (!opts.skipTransfer && thumbCheck.thumbnailFile && !thumbCheck.thumbnailFileId) {
          try {
            const t = await uploadThumbnail(thumbCheck);
            if (stopRef.current) return;
            updateItem(uid, { thumbnailFileId: t.thumbnailFileId, thumbnailUrl: t.thumbnailUrl });
          } catch (e) {
            if (stopRef.current) return;
            console.warn('[upload] cover thumbnail failed (non-fatal, continuing):', e);
          }
        }

        // ---- Phase 1: transfer (skipped on registration-only retry) ----
        let transfer: { fileId: string; fileUrl: string; fileName: string; mimeType: string; size: number };
        let timings = item.timings;
        const current = getItem(uid)!;
        if (opts.skipTransfer && current.fileId && current.fileUrl) {
          transfer = {
            fileId: current.fileId,
            fileUrl: current.fileUrl,
            fileName: current.file.name,
            mimeType: current.file.type,
            size: current.file.size,
          };
        } else {
          updateItem(uid, {
            status: 'uploading',
            errorCode: null,
            error: null,
            progress: { loaded: 0, total: current.file.size, pct: 0, speedBps: null, etaSecs: null },
          });
          // ONE automatic re-upload on throttling: the server asked us
          // to come back after N seconds — honor it once, then surface.
          let t: TransferResult;
          try {
            t = await uploadTransfer(current);
          } catch (e) {
            const terr = e as { code?: UploadErrorCode; retryAfter?: number };
            if (terr.code === 'UPLOAD_THROTTLED' && !stopRef.current) {
              const waitSecs = Math.min(Math.max(terr.retryAfter ?? 25, 5), 35);
              await new Promise((r) => setTimeout(r, waitSecs * 1000));
              if (stopRef.current) return;
              updateItem(uid, { status: 'uploading' });
              t = await uploadTransfer(getItem(uid)!);
            } else {
              throw e;
            }
          }
          transfer = t;
          timings = t.timings;
          if (stopRef.current) return;
          updateItem(uid, { fileId: t.fileId, fileUrl: t.fileUrl, timings: t.timings, status: 'uploaded' });
        }

        // ---- Phase 2: registration ----
        updateItem(uid, { status: 'persisting' });
        let reg: { resource: Resource; verified: boolean; pendingVerification: boolean };
        try {
          reg = await registerResource(getItem(uid)!, transfer);
        } catch (e) {
          // ONE automatic re-save: the file is already stored (phase 1
          // done), and a failed save almost always means "backend pacing
          // window was armed" — 14s later the window is clear and the
          // same clientId dedupes, so this retry is free and safe. Any
          // other error (auth/timeout/cancel) throws straight through.
          const rerr = e as { code?: UploadErrorCode };
          if (rerr.code === 'DATABASE_REGISTRATION_ERROR' && !stopRef.current) {
            await new Promise((r) => setTimeout(r, 14000));
            if (stopRef.current) return;
            updateItem(uid, { status: 'persisting' });
            reg = await registerResource(getItem(uid)!, transfer);
          } else {
            throw e;
          }
        }
        if (stopRef.current) return;

        // ---- Phase 3: verification ----
        updateItem(uid, { status: 'verifying', resourceId: reg.resource.id, timings });
        const confirmed = reg.verified ? reg.resource : await verifyResourceRecord(reg.resource.id);
        if (stopRef.current) return;

        // Write-through into the store so profile/community update instantly.
        upsertLocal(confirmed);
        updateItem(uid, { status: 'ready', resourceId: confirmed.id, errorCode: null, error: null });
      } catch (e) {
        const err = e as { code?: UploadErrorCode; error?: string; cancelled?: boolean };
        if (err.cancelled || getItem(uid)?.status === 'cancelled') {
          updateItem(uid, { status: 'cancelled' });
          return;
        }
        updateItem(uid, {
          status: 'failed',
          errorCode: err.code || 'UNKNOWN_ERROR',
          error: err.error || uploadErrorMessage(err.code || 'UNKNOWN_ERROR'),
        });
      }
    },
    [getItem, validateItem, updateItem, uploadTransfer, registerResource, verifyResourceRecord, upsertLocal, uploadThumbnail]
  );

  // ---------- queue runner ----------

  const runQueue = useCallback(
    async (onlyUid?: string) => {
      if (running) return;
      if (!user) {
        toast({ title: 'Login required', description: 'Please log in to upload.', variant: 'destructive' });
        return;
      }
      stopRef.current = false;
      setRunning(true);
      try {
        const order = onlyUid ? [onlyUid] : itemsRef.current.map((it) => it.uid);
        for (const uid of order) {
          if (stopRef.current) break;
          const it = getItem(uid);
          if (!it) continue;
          if (!onlyUid && (it.status === 'ready' || it.status === 'cancelled')) continue;
          if (!onlyUid && it.status === 'failed') continue; // failed items retry manually
          await processItem(uid);
        }
      } finally {
        setRunning(false);
      }
    },
    [running, user, toast, getItem, processItem]
  );

  const cancelItem = useCallback(
    (uid: string) => {
      const xhr = xhrRefs.current.get(uid);
      if (xhr) {
        try {
          xhr.abort();
        } catch {}
      }
      const gs = gsAbortRefs.current.get(uid);
      if (gs) {
        try {
          gs.abort();
        } catch {}
      }
      const it = getItem(uid);
      if (it && it.status !== 'ready') {
        updateItem(uid, { status: 'cancelled', errorCode: 'UPLOAD_CANCELLED', error: null });
      }
    },
    [getItem, updateItem]
  );

  const cancelAll = useCallback(() => {
    stopRef.current = true;
    xhrRefs.current.forEach((xhr) => {
      try {
        xhr.abort();
      } catch {}
    });
    gsAbortRefs.current.forEach((ctrl) => {
      try {
        ctrl.abort();
      } catch {}
    });
    setItems((prev) =>
      prev.map((it) =>
        it.status === 'ready' || it.status === 'failed'
          ? it
          : { ...it, status: 'cancelled' as ItemStatus, errorCode: 'UPLOAD_CANCELLED' as UploadErrorCode }
      )
    );
    setRunning(false);
  }, []);

  const retryItem = useCallback(
    (uid: string) => {
      const it = getItem(uid);
      if (!it) return;
      // Registration/verification failures reuse the uploaded file (no re-upload).
      const skipTransfer =
        !!it.fileId &&
        !!it.fileUrl &&
        (it.errorCode === 'DATABASE_REGISTRATION_ERROR' || it.errorCode === 'DATABASE_VERIFICATION_ERROR');
      updateItem(uid, { status: 'queued', errorCode: null, error: null });
      // Defer so the status paint happens before the pipeline re-runs.
      setTimeout(() => {
        if (skipTransfer) {
          setRunning(true);
          processItem(uid, { skipTransfer: true }).finally(() => setRunning(false));
        } else {
          runQueue(uid);
        }
      }, 30);
    },
    [getItem, updateItem, processItem, runQueue]
  );

  const removeItem = useCallback(
    (uid: string) => {
      cancelItem(uid);
      setItems((prev) => prev.filter((it) => it.uid !== uid));
    },
    [cancelItem]
  );

  const handleClose = useCallback(() => {
    cancelAll();
    onClose();
  }, [cancelAll, onClose]);

  const readyCount = items.filter((it) => it.status === 'ready').length;
  const failedCount = items.filter((it) => it.status === 'failed').length;
  const pendingCount = items.filter((it) => it.status === 'queued' || it.status === 'cancelled').length;
  const activeCount = items.filter((it) =>
    ['uploading', 'uploaded', 'persisting', 'verifying'].includes(it.status)
  ).length;
  const allTerminal = items.length > 0 && pendingCount === 0 && activeCount === 0 && !running;

  const phaseLine = (it: QueueItem): string => {
    switch (it.status) {
      case 'queued':
        return 'Queued — waiting to start';
      case 'uploading': {
        const p = it.progress;
        const parts = [`Uploading ${it.file.name}… ${p.pct}%`, `${fmtBytes(p.loaded)} / ${fmtBytes(p.total)}`];
        const sp = fmtSpeed(p.speedBps);
        if (sp) parts.push(sp);
        const eta = fmtEta(p.etaSecs);
        if (eta) parts.push(eta);
        return parts.join(' · ');
      }
      case 'uploaded':
        return 'File uploaded. Saving resource…';
      case 'persisting':
        return 'File uploaded. Saving resource…';
      case 'verifying':
        return 'Saved. Confirming persistence…';
      case 'ready':
        return 'Upload complete';
      case 'failed':
        return it.error || uploadErrorMessage(it.errorCode || 'UNKNOWN_ERROR');
      case 'cancelled':
        return 'Upload cancelled';
    }
  };

  // ---------- direct file link (no upload; URL-only record) ----------
  const saveLink = useCallback(async () => {
    const url = linkUrl.trim();
    if (!/^https?:\/\/.+\..+/.test(url)) {
      toast({ title: 'Invalid link', description: 'Paste a full http(s) URL.', variant: 'destructive' });
      return;
    }
    const title = linkTitle.trim() || url;
    if (!user) {
      toast({ title: 'Login required', description: 'Please log in to add a link.', variant: 'destructive' });
      return;
    }
    setLinkSaving(true);
    try {
      const tagsArray = tags.split(',').map((t) => t.trim()).filter(Boolean);
      let fileName = url;
      try {
        const u = new URL(url);
        fileName = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || u.hostname);
      } catch {}
      const res = await fetch('/api/resources/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          title,
          description,
          fileId: `ext:link:${makeClientId()}`,
          downloadUrl: url,
          fileName,
          mimeType: 'text/uri-list',
          tags: tagsArray,
          published,
          clientId: makeClientId(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error((data.error as string) || 'Failed to save link.');
      }
      upsertLocal(data.resource as Resource);
      toast({ title: 'Link added!', description: published ? 'Published to community.' : 'Saved as draft.' });
      onSuccess();
      onClose();
    } catch (err) {
      toast({
        title: 'Could not save link',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setLinkSaving(false);
    }
  }, [linkUrl, linkTitle, user, tags, description, published, type, toast, upsertLocal, onSuccess, onClose]);

  // ---------- per-row thumbnail picker (clips + files) ----------
  const pickThumbnail = useCallback((uid: string) => {
    thumbTargetUid.current = uid;
    thumbInputRef.current?.click();
  }, []);

  const onThumbnailChosen = useCallback(
    (files: FileList | null) => {
      const uid = thumbTargetUid.current;
      thumbTargetUid.current = null;
      if (!uid || !files || files.length === 0) return;
      const f = files[0];
      if (!f.type.startsWith('image/')) {
        toast({ title: 'Invalid thumbnail', description: 'Please choose an image file.', variant: 'destructive' });
        return;
      }
      if (f.size > 10 * 1024 * 1024) {
        toast({ title: 'Thumbnail too large', description: 'Cover image must be under 10MB.', variant: 'destructive' });
        return;
      }
      const prev = getItem(uid)?.thumbnailPreview;
      if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
      updateItem(uid, { thumbnailFile: f, thumbnailPreview: URL.createObjectURL(f), thumbnailFileId: undefined, thumbnailUrl: undefined });
    },
    [getItem, updateItem, toast]
  );

  const clearThumbnail = useCallback(
    (uid: string) => {
      const prev = getItem(uid)?.thumbnailPreview;
      if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
      updateItem(uid, { thumbnailFile: undefined, thumbnailPreview: undefined, thumbnailFileId: undefined, thumbnailUrl: undefined });
    },
    [getItem, updateItem]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] flex flex-col bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#ef233c]/15 flex items-center justify-center">
              <TypeIcon className="w-4 h-4 text-[#ef233c]" />
            </div>
            <div>
              <h2 className="font-manrope font-semibold text-lg text-white">Upload {typeLabel}{type === 'xml' ? 's & share links' : 's'}</h2>
              <p className="text-[10px] font-manrope uppercase tracking-wider text-zinc-500">
                {step === 'select'
                  ? 'Choose files'
                  : `${items.length} file${items.length === 1 ? '' : 's'} · ${readyCount} ready${failedCount ? ` · ${failedCount} failed` : ''}${running ? ' · uploading…' : ''}`}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
          {step === 'select' && type === 'xml' && (
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setSelectTab('file')}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${selectTab === 'file' ? 'bg-[#ef233c]/15 text-white border border-[#ef233c]/30' : 'bg-black/40 text-zinc-500 border border-white/10 hover:text-white'}`}
              >
                <Upload className="w-4 h-4" /> Upload files
              </button>
              <button
                onClick={() => setSelectTab('link')}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${selectTab === 'link' ? 'bg-[#ef233c]/15 text-white border border-[#ef233c]/30' : 'bg-black/40 text-zinc-500 border border-white/10 hover:text-white'}`}
              >
                <Link2 className="w-4 h-4" /> Add link
              </button>
            </div>
          )}

          {step === 'select' && (selectTab === 'file' || type !== 'xml') && (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="rounded-2xl border-2 border-dashed border-white/10 bg-black/40 p-10 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-[#ef233c]/30 hover:bg-black/60 transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
            >
              <div className="w-14 h-14 rounded-2xl bg-[#ef233c]/10 flex items-center justify-center">
                <Upload className="w-6 h-6 text-[#ef233c]" />
              </div>
              <div className="text-center">
                <p className="font-inter text-sm text-white">Drop your {typeLabel} files here</p>
                <p className="font-inter text-xs text-zinc-500 mt-1">
                  or click to browse — multiple files allowed (max {fmtBytes(sizeLimit)} each)
                  {type !== 'image' && ' · permanent storage up to 256MB, direct upload up to 5GB'}
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={accept}
                multiple
                onChange={(e) => {
                  if (e.target.files?.length) addFiles(e.target.files);
                  e.target.value = '';
                }}
                className="hidden"
              />
            </div>
          )}

          {step === 'select' && type === 'xml' && selectTab === 'link' && (
            <div className="rounded-2xl border border-white/10 bg-black/40 p-5 space-y-3">
              <div>
                <label className="text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500 block mb-1.5">
                  File link (Google Drive, getshared, Dropbox, direct URL…)
                </label>
                <input
                  type="url"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://…"
                  className="w-full px-3 py-2 rounded-xl bg-black/60 border border-white/10 font-inter text-sm text-white placeholder:text-zinc-700 focus:border-[#ef233c]/40 focus:outline-none transition-colors"
                />
              </div>
              <div>
                <label className="text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500 block mb-1.5">
                  Title
                </label>
                <input
                  type="text"
                  value={linkTitle}
                  onChange={(e) => setLinkTitle(e.target.value)}
                  placeholder="My shared file"
                  className="w-full px-3 py-2 rounded-xl bg-black/60 border border-white/10 font-inter text-sm text-white placeholder:text-zinc-700 focus:border-[#ef233c]/40 focus:outline-none transition-colors"
                />
              </div>
              <button
                onClick={saveLink}
                disabled={linkSaving || !linkUrl.trim()}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-full bg-[#ef233c] hover:bg-red-700 text-white text-sm font-medium disabled:opacity-50 transition-all"
              >
                <Link2 className="w-4 h-4" />
                {linkSaving ? 'Saving…' : 'Save link'}
              </button>
              <p className="text-[11px] font-inter text-zinc-600 text-center">
                The link is saved as-is — no file is uploaded.
              </p>
            </div>
          )}

          {step === 'queue' && (
            <div className="space-y-4">
              {/* Shared details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500 block mb-1.5">
                    Description (applies to all)
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    disabled={running}
                    className="w-full px-3 py-2 rounded-xl bg-black/60 border border-white/10 font-inter text-sm text-white resize-none focus:border-[#ef233c]/40 focus:outline-none transition-colors disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500 block mb-1.5">
                    Tags (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="WAP7, IndianRailways"
                    disabled={running}
                    className="w-full px-3 py-2 rounded-xl bg-black/60 border border-white/10 font-inter text-sm text-white placeholder:text-zinc-700 focus:border-[#ef233c]/40 focus:outline-none transition-colors disabled:opacity-50"
                  />
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={published}
                      onChange={(e) => setPublished(e.target.checked)}
                      disabled={running}
                      className="w-4 h-4 rounded accent-[#ef233c] disabled:opacity-50"
                    />
                    <span className="font-inter text-sm text-zinc-300">Publish to community</span>
                  </label>
                </div>
              </div>

              {/* Queue */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500">
                    Upload queue
                  </p>
                  {!running && (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="text-[11px] font-inter text-zinc-500 hover:text-white transition-colors"
                    >
                      + Add more
                    </button>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={accept}
                  multiple
                  onChange={(e) => {
                    if (e.target.files?.length) addFiles(e.target.files);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
                <input
                  ref={thumbInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    onThumbnailChosen(e.target.files);
                    e.target.value = '';
                  }}
                  className="hidden"
                />

                <div className="space-y-2.5">
                  {items.map((it) => {
                    const isActive = ['uploading', 'uploaded', 'persisting', 'verifying'].includes(it.status);
                    return (
                      <div
                        key={it.uid}
                        className={`rounded-xl border p-3 transition-colors ${
                          it.status === 'ready'
                            ? 'border-emerald-500/20 bg-emerald-500/[0.03]'
                            : it.status === 'failed'
                              ? 'border-[#ef233c]/25 bg-[#ef233c]/[0.03]'
                              : 'border-white/10 bg-black/40'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg bg-[#ef233c]/10 flex items-center justify-center shrink-0 overflow-hidden">
                            {it.thumbnailPreview ? (
                              <img src={it.thumbnailPreview} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <TypeIcon className="w-4 h-4 text-[#ef233c]" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <label className="block text-[9px] font-manrope uppercase tracking-[0.2em] text-zinc-500 mb-1">
                              Title
                            </label>
                            <input
                              value={it.title}
                              onChange={(e) => updateItem(it.uid, { title: e.target.value })}
                              disabled={running && isActive}
                              placeholder="Write a title for this upload…"
                              maxLength={120}
                              className="w-full bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 font-inter text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-[#ef233c]/50 transition-colors disabled:opacity-70"
                            />
                            <p className="text-[10px] font-manrope text-zinc-500 truncate">
                              {it.file.name} · {fmtBytes(it.file.size)}
                              {type !== 'image' && (isQuaxEligible(it.file.name, it.file.size) ? ' · permanent storage' : it.file.size > MAX_UPLOAD_BYTES ? ' · large file, direct upload' : ' · direct upload')}
                            </p>
                            {!running && (it.status === 'queued' || it.status === 'cancelled' || it.status === 'failed') && (
                              <button
                                onClick={() => (it.thumbnailFile ? clearThumbnail(it.uid) : pickThumbnail(it.uid))}
                                className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-inter text-zinc-500 hover:text-white transition-colors"
                              >
                                <ImagePlus className="w-3 h-3" />
                                {it.thumbnailFile ? `Cover: ${it.thumbnailFile.name} (remove)` : 'Add cover thumbnail'}
                              </button>
                            )}
                          </div>
                          <span
                            className={`shrink-0 text-[9px] font-manrope uppercase tracking-wider px-2 py-1 rounded-md border ${
                              it.status === 'ready'
                                ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
                                : it.status === 'failed'
                                  ? 'text-[#ef233c] border-[#ef233c]/30 bg-[#ef233c]/10'
                                  : isActive
                                    ? 'text-amber-300 border-amber-500/30 bg-amber-500/10'
                                    : 'text-zinc-400 border-white/10 bg-white/[0.03]'
                            }`}
                          >
                            {STATUS_LABEL[it.status]}
                          </span>
                          {it.status === 'ready' ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                          ) : it.status === 'failed' ? (
                            <AlertTriangle className="w-4 h-4 text-[#ef233c] shrink-0" />
                          ) : null}
                          {!running && (it.status === 'queued' || it.status === 'cancelled' || it.status === 'failed') && (
                            <button
                              onClick={() => removeItem(it.uid)}
                              className="p-1 rounded-md text-zinc-600 hover:text-white hover:bg-white/5 transition-all shrink-0"
                              title="Remove from queue"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {isActive && running && (
                            <button
                              onClick={() => cancelItem(it.uid)}
                              className="p-1 rounded-md text-zinc-500 hover:text-white hover:bg-white/5 transition-all shrink-0"
                              title="Cancel this upload"
                            >
                              <Ban className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        {/* Progress bar (real transfer progress) */}
                        {(it.status === 'uploading' || it.status === 'uploaded' || it.status === 'persisting' || it.status === 'verifying' || it.status === 'ready') && (
                          <div className="mt-2.5 h-1.5 rounded-full bg-white/5 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-200 ${
                                it.status === 'ready' ? 'bg-emerald-500' : 'bg-[#ef233c]'
                              }`}
                              style={{
                                width: `${it.status === 'ready' ? 100 : it.status === 'uploading' ? it.progress.pct : 100}%`,
                              }}
                            />
                          </div>
                        )}
                        <p className={`mt-1.5 font-inter text-[11px] leading-relaxed ${it.status === 'failed' ? 'text-[#ef233c]/90' : it.status === 'ready' ? 'text-emerald-400/90' : 'text-zinc-400'}`}>
                          {phaseLine(it)}
                        </p>

                        {/* Retry actions */}
                        {it.status === 'failed' && !running && (
                          <div className="mt-2 flex items-center gap-2">
                            <button
                              onClick={() => retryItem(it.uid)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#ef233c]/10 border border-[#ef233c]/25 text-[11px] font-medium text-[#ef233c] hover:bg-[#ef233c]/20 transition-all"
                            >
                              <RotateCcw className="w-3 h-3" />
                              {it.fileId && (it.errorCode === 'DATABASE_REGISTRATION_ERROR' || it.errorCode === 'DATABASE_VERIFICATION_ERROR')
                                ? 'Retry save (no re-upload)'
                                : 'Retry upload'}
                            </button>
                            {it.errorCode && (
                              <span className="text-[9px] font-manrope text-zinc-600">{it.errorCode}</span>
                            )}
                          </div>
                        )}

                        {/* Timing diagnostics */}
                        {it.timings && (it.status === 'ready' || it.status === 'failed') && (
                          <details className="mt-2 group">
                            <summary className="flex items-center gap-1 text-[10px] font-manrope text-zinc-600 hover:text-zinc-400 cursor-pointer list-none">
                              <ChevronDown className="w-3 h-3 transition-transform group-open:rotate-180" />
                              Transfer timings
                            </summary>
                            <div className="mt-1 pl-4 text-[10px] font-mono text-zinc-600">
                              <p>init: {it.timings.upload_init_ms ?? 0}ms · transfer: {it.timings.transfer_ms ?? 0}ms · finalize: {it.timings.storage_finalize_ms ?? 0}ms · total: {it.timings.total_upload_ms ?? 0}ms · attempts: {it.timings.attempts ?? 1}</p>
                            </div>
                          </details>
                        )}
                      </div>
                    );
                  })}
                  {items.length === 0 && (
                    <div className="rounded-xl border border-white/10 bg-black/40 p-6 text-center">
                      <p className="font-inter text-sm text-zinc-500">Queue is empty.</p>
                      <button
                        onClick={() => setStep('select')}
                        className="mt-2 text-xs text-[#ef233c] hover:text-white transition-colors"
                      >
                        Choose files
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/5 shrink-0 flex items-center gap-2">
          {step === 'queue' && !allTerminal && !running && pendingCount > 0 && (
            <button
              onClick={() => runQueue()}
              disabled={items.length === 0}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-full bg-[#ef233c] hover:bg-red-700 text-white text-sm font-medium disabled:opacity-50 transition-all duration-300"
            >
              <Upload className="w-4 h-4" />
              Start upload{pendingCount > 1 ? ` (${pendingCount})` : ''}
            </button>
          )}
          {step === 'queue' && running && (
            <button
              onClick={cancelAll}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-full bg-white/[0.05] border border-white/10 text-zinc-200 text-sm font-medium hover:bg-white/10 transition-all duration-300"
            >
              <Ban className="w-4 h-4" /> Cancel all
            </button>
          )}
          {step === 'queue' && allTerminal && (
            <div className="flex-1 flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2 px-4 py-2.5 rounded-full bg-white/[0.03] border border-white/10">
                {failedCount === 0 ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-[#ef233c] shrink-0" />
                )}
                <p className="font-inter text-xs text-zinc-300">
                  {readyCount} uploaded{failedCount ? ` · ${failedCount} failed` : ''}
                  {readyCount > 0 && (published ? ' · published' : ' · saved as draft')}
                </p>
              </div>
              <button
                onClick={() => {
                  if (readyCount > 0) {
                    toast({
                      title: 'Uploaded!',
                      description: `${readyCount} file${readyCount === 1 ? '' : 's'} ${published ? 'published' : 'saved'}`,
                    });
                    onSuccess();
                  } else {
                    handleClose();
                  }
                }}
                className="px-6 py-2.5 rounded-full bg-[#ef233c] hover:bg-red-700 text-white text-sm font-medium transition-all duration-300"
              >
                Done
              </button>
            </div>
          )}
          {step === 'select' && (
            <p className="flex-1 text-center font-inter text-[11px] text-zinc-600">
              Files are stored permanently — they survive refresh and stay until you delete them.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
