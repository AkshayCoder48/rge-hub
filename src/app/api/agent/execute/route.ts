/**
 * POST /api/agent/execute — multi-language code execution for RGE Agent.
 *
 * Tiers:
 *   node / javascript / bash → REAL runtimes in a hardened sandbox on this
 *     server: isolated /tmp dir (the workspace files sent along are written
 *     into it), EMPTY environment (no secrets reach the child), 25s kill,
 *     256KB output caps. Changed/new text files are streamed back so the
 *     browser workspace stays in sync. stdout/stderr stream LIVE over SSE.
 *   20+ more languages → proxied to the free public Compiler Explorer
 *     executor (keyless, honest errors when unreachable).
 *
 * Body: {
 *   language: string            — 'node' | 'bash' | 'c' | 'go' | …
 *   code: string                — the source to run (≤ 256KB)
 *   files?: {path, content}[]   — workspace files to stage (server tier, ≤ 40 × 128KB)
 *   stdin?: string              — optional stdin (≤ 64KB)
 * }
 *
 * Response: text/event-stream
 *   data: {"type":"start","runtime":"Node.js v20.x"}
 *   data: {"type":"stdout","text":"…"} / {"type":"stderr","text":"…"}
 *   data: {"type":"files","files":[{path,content}]}      (server tier)
 *   data: {"type":"exit","code":0,"signal":null,"durationMs":812,"ok":true}
 *   data: {"type":"error","message":"…"}                  — honest failure
 */
import { NextRequest, NextResponse } from 'next/server';
import { spawn, type ChildProcess, type SpawnOptions } from 'child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat, symlink, access } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { getSession } from '@/lib/session';
import { normalizeExecLanguage, EXEC_RUNTIMES } from '@/lib/agent/runtimes';

// Reference the curated npm modules so the output tracer keeps them in the
// lambda bundle (complete copies are forced via outputFileTracingIncludes).
import * as bundledAdmZip from 'adm-zip';
import * as bundledDateFns from 'date-fns';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

void bundledAdmZip;
void bundledDateFns;

/** npm packages sandboxed Node code may require() (resolved from cwd/node_modules
 *  symlinks + NODE_PATH). */
const CURATED_NPM_MODULES = ['adm-zip', 'date-fns'];

/** Candidate roots that may hold complete node_modules copies (dev + lambda). */
function nodeModuleRoots(): string[] {
  return [
    path.join(process.cwd(), 'node_modules'),
    '/var/task/node_modules',
    '/var/task/.next/server/node_modules',
  ].filter(Boolean);
}

const MAX_CODE_CHARS = 256 * 1024;
const MAX_FILES = 40;
const MAX_FILE_BYTES = 128 * 1024;
const MAX_STDIN_CHARS = 64 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024; // per stream (stdout / stderr)
const RETURN_MAX_FILES = 40;
const RETURN_MAX_FILE_BYTES = 128 * 1024;
const CHILD_TIMEOUT_MS = 25_000;
const REMOTE_TIMEOUT_MS = 50_000;

interface StagedFile {
  path: string;
  content: string;
}

interface SanitizedInput {
  language: string;
  code: string;
  files: StagedFile[];
  stdin: string;
}

function sanitizeInput(body: Record<string, unknown> | null): { ok: true; value: SanitizedInput } | { ok: false; message: string } {
  const language = normalizeExecLanguage(String(body?.language ?? ''));
  if (!language) {
    return { ok: false, message: `Unsupported language "${String(body?.language ?? '').slice(0, 40)}".` };
  }
  const code = String(body?.code ?? '');
  if (!code.trim()) return { ok: false, message: 'Provide code to execute.' };
  if (code.length > MAX_CODE_CHARS) return { ok: false, message: `Code exceeds ${MAX_CODE_CHARS / 1024}KB.` };

  const files: StagedFile[] = [];
  if (Array.isArray(body?.files)) {
    for (const f of body.files.slice(0, MAX_FILES)) {
      if (!f || typeof f !== 'object') continue;
      const p = String((f as StagedFile).path ?? '').trim();
      const content = String((f as StagedFile).content ?? '');
      // Zip-slip guard: relative paths only, no traversal.
      if (!p || p.startsWith('/') || p.includes('..')) continue;
      if (content.length > MAX_FILE_BYTES) continue;
      files.push({ path: p, content });
    }
  }
  const stdin = String(body?.stdin ?? '').slice(0, MAX_STDIN_CHARS);
  return { ok: true, value: { language, code, files, stdin } };
}

/** Read a file, returning null when it is binary or too large. */
async function readTextFileIfSmall(abs: string): Promise<string | null> {
  try {
    const st = await stat(abs);
    if (!st.isFile() || st.size > RETURN_MAX_FILE_BYTES) return null;
    const buf = await readFile(abs);
    if (buf.includes(0)) return null; // binary
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

/** Collect (path → text) under a dir, bounded. */
async function collectTextFiles(root: string, absDir: string, out: StagedFile[], depth = 0): Promise<void> {
  if (out.length >= RETURN_MAX_FILES || depth > 6) return;
  const entries = await readdir(absDir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (out.length >= RETURN_MAX_FILES) return;
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const abs = path.join(absDir, e.name);
    if (e.isDirectory()) {
      await collectTextFiles(root, abs, out, depth + 1);
    } else if (e.isFile()) {
      const text = await readTextFileIfSmall(abs);
      if (text !== null) out.push({ path: path.relative(root, abs).split(path.sep).join('/'), content: text });
    }
  }
}

export async function POST(request: NextRequest) {
  const requestId = `exec_${Date.now().toString(36)}`;

  const sessionResult = await getSession();
  if (sessionResult.status !== 'ok') {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' }, requestId },
      { status: 401 }
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = sanitizeInput(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: parsed.message }, requestId },
      { status: 400 }
    );
  }
  const { language, code, files, stdin } = parsed.value;
  const def = EXEC_RUNTIMES[language];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const finish = () => {
        if (!closed) {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
          closed = true;
        }
      };

      try {
        if (def.tier === 'server') {
          await runServerTier(language, code, files, stdin, send);
        } else {
          await runRemoteTier(code, stdin, def.compilerId as string, def.label, send);
        }
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : 'Execution failed.' });
      }
      finish();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'x-request-id': requestId,
    },
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Server tier — real Node.js / Bash in a hardened sandbox
// ────────────────────────────────────────────────────────────────────────────

async function runServerTier(
  language: string,
  code: string,
  files: StagedFile[],
  stdin: string,
  send: (event: Record<string, unknown>) => void
): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'rge-exec-'));
  try {
    // Stage workspace files.
    for (const f of files) {
      const abs = path.join(dir, f.path);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, f.content, 'utf8');
    }

    // Stage curated npm modules: symlink the bundled copies into
    // <execdir>/node_modules so plain require('<pkg>') resolves from cwd.
    for (const pkg of CURATED_NPM_MODULES) {
      for (const root of nodeModuleRoots()) {
        const from = path.join(root, pkg);
        try {
          await access(path.join(from, 'package.json')); // complete package present
          await mkdir(path.join(dir, 'node_modules'), { recursive: true });
          await symlink(from, path.join(dir, 'node_modules', pkg), 'dir').catch(() => undefined);
          break;
        } catch {
          /* try next root */
        }
      }
    }

    const isBash = language === 'bash';
    const bin = isBash ? '/bin/bash' : process.execPath;
    const args = isBash ? ['--noprofile', '--norc', '-c', code] : ['-e', code];

    // The child env is DELIBERATELY minimal: no secrets, just PATH (for bash
    // subprocesses) and NODE_PATH (so require() can find the curated modules).
    const env: NodeJS.ProcessEnv = isBash
      ? {
          PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
          NODE_ENV: process.env.NODE_ENV || 'production',
        }
      : {
          PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
          NODE_ENV: process.env.NODE_ENV || 'production',
          NODE_PATH: nodeModuleRoots().join(':'),
        };

    const started = Date.now();
    await new Promise<void>((resolve) => {
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let stdoutCut = false;
      let stderrCut = false;

      send({
        type: 'start',
        runtime: isBash ? 'Bash (server sandbox)' : `Node.js ${process.version} (server sandbox)`,
        filesStaged: files.length,
      });

      const spawnOpts: SpawnOptions = {
        cwd: dir,
        env,
        timeout: CHILD_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      };
      const child: ChildProcess = spawn(bin, args, spawnOpts);

      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdoutBytes >= MAX_OUTPUT_BYTES) {
          if (!stdoutCut) {
            stdoutCut = true;
            send({ type: 'stdout', text: '… (output truncated at 256KB)' });
          }
          return;
        }
        stdoutBytes += chunk.length;
        send({ type: 'stdout', text: chunk.toString('utf8') });
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderrBytes >= MAX_OUTPUT_BYTES) {
          if (!stderrCut) {
            stderrCut = true;
            send({ type: 'stderr', text: '… (stderr truncated at 256KB)' });
          }
          return;
        }
        stderrBytes += chunk.length;
        send({ type: 'stderr', text: chunk.toString('utf8') });
      });

      if (stdin) {
        child.stdin?.write(stdin);
      }
      child.stdin?.end();

      child.on('error', (err) => {
        send({
          type: 'exit',
          code: 127,
          signal: null,
          durationMs: Date.now() - started,
          ok: false,
          message: `${isBash ? 'bash' : 'node'} failed to start: ${err.message}`,
        });
        resolve();
      });

      child.on('close', async (exitCode, signal) => {
        const timedOut = signal === 'SIGKILL';
        // Stream back changed/new text files so the browser workspace syncs.
        try {
          const collected: StagedFile[] = [];
          await collectTextFiles(dir, dir, collected);
          const sentMap = new Map(files.map((f) => [f.path, f.content]));
          const changed = collected.filter((f) => sentMap.get(f.path) !== f.content);
          if (changed.length > 0) send({ type: 'files', files: changed });
        } catch {
          /* best effort */
        }
        send({
          type: 'exit',
          code: exitCode ?? 1,
          signal,
          durationMs: Date.now() - started,
          ok: exitCode === 0 && !timedOut,
          ...(timedOut ? { message: `Execution exceeded ${CHILD_TIMEOUT_MS / 1000}s and was killed.` } : {}),
        });
        resolve();
      });
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Remote tier — Compiler Explorer public executor (free, keyless)
// ────────────────────────────────────────────────────────────────────────────

interface CeLine {
  text?: string;
}

async function runRemoteTier(
  code: string,
  stdin: string,
  compilerId: string,
  label: string,
  send: (event: Record<string, unknown>) => void
): Promise<void> {
  const started = Date.now();
  send({ type: 'start', runtime: `${label} (remote executor — compiling…)` });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
  try {
    const res = await fetch(`https://godbolt.org/api/compiler/${encodeURIComponent(compilerId)}/compile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'rge-hub-agent (code execution for signed-in users)',
      },
      body: JSON.stringify({
        source: code,
        options: {
          userArguments: '',
          executeParameters: { args: [], stdin },
          filters: { execute: true },
          compilerOptions: { executorRequest: true },
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      send({
        type: 'error',
        message:
          res.status === 429
            ? 'The remote executor rate-limited this request — retry in a moment or use a local language (python/node/bash).'
            : `The remote executor is unavailable (HTTP ${res.status}). Try again, or use python/node/bash which run without it.`,
      });
      return;
    }

    const result = (await res.json()) as {
      code?: number;
      didExecute?: boolean;
      stdout?: CeLine[];
      stderr?: CeLine[];
      buildResult?: { stderr?: CeLine[]; code?: number };
    };

    // Compile errors surface in buildResult.stderr.
    const compileErrs = (result.buildResult?.stderr ?? []).map((l) => l.text ?? '').join('\n').trim();
    if ((result.buildResult?.code ?? 0) !== 0 && compileErrs) {
      for (const line of compileErrs.split('\n').slice(0, 80)) {
        if (line.trim()) send({ type: 'stderr', text: `${line}\n` });
      }
      send({ type: 'exit', code: 1, signal: null, durationMs: Date.now() - started, ok: false, message: 'Compilation failed.' });
      return;
    }

    if (result.didExecute === false) {
      send({ type: 'error', message: 'This runtime compiled but the executor could not run the program.' });
      return;
    }

    const stdout = (result.stdout ?? []).map((l) => l.text ?? '').join('\n');
    const stderr = (result.stderr ?? []).map((l) => l.text ?? '').join('\n');
    if (stdout) send({ type: 'stdout', text: stdout });
    if (stderr) send({ type: 'stderr', text: stderr });

    const exitCode = typeof result.code === 'number' ? result.code : 0;
    send({
      type: 'exit',
      code: exitCode,
      signal: null,
      durationMs: Date.now() - started,
      ok: exitCode === 0,
      ...(exitCode !== 0 ? { message: `Program exited with code ${exitCode}.` } : {}),
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    send({
      type: 'error',
      message: aborted
        ? `The remote executor took over ${REMOTE_TIMEOUT_MS / 1000}s (compiles can be slow) — try a lighter snippet or a local language (python/node/bash).`
        : `Could not reach the remote executor: ${err instanceof Error ? err.message : String(err)}. Local languages (python/node/bash) still work.`,
    });
  } finally {
    clearTimeout(timer);
  }
}
