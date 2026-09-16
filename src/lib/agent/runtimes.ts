/**
 * RGE Agent — code-execution runtime catalog (PURE — client + server safe).
 *
 * execute_code supports 25 languages across three tiers:
 *
 *   local  — Python 3.12 in the browser web container (Pyodide). Persistent
 *            per-chat workspace, live streaming stdout. The default and the
 *            workhorse for XML/ZIP editing jobs.
 *   server — Node.js / Bash executed in a hardened sandbox on the RGE Hub
 *            server (isolated /tmp dir, empty environment, 25s kill, output
 *            caps). Workspace files travel in (files[]) and changed files
 *            travel back — so scripts read/write the same workspace.
 *   remote — 20 more languages via the free public Compiler Explorer
 *            executor (compile + run, ephemeral, no workspace files).
 */

export type ExecTier = 'local' | 'server' | 'remote';

export interface RuntimeDef {
  /** Human label shown in the terminal block header. */
  label: string;
  tier: ExecTier;
  /** Compiler id for remote (Compiler Explorer) runtimes. */
  compilerId?: string;
}

export const EXEC_RUNTIMES: Record<string, RuntimeDef> = {
  // local (browser web container)
  python: { label: 'Python 3.12', tier: 'local' },

  // server sandbox (real Node.js / Bash on the RGE Hub server)
  node: { label: 'Node.js', tier: 'server' },
  javascript: { label: 'JavaScript (Node.js)', tier: 'server' },
  bash: { label: 'Bash', tier: 'server' },

  // remote (Compiler Explorer public executor — free, keyless)
  c: { label: 'C · gcc 16.2', tier: 'remote', compilerId: 'cg162' },
  cpp: { label: 'C++ · gcc 16.2', tier: 'remote', compilerId: 'g162' },
  csharp: { label: 'C# · .NET 9', tier: 'remote', compilerId: 'dotnet90csharpcoreclr' },
  fsharp: { label: 'F# · .NET 9', tier: 'remote', compilerId: 'dotnet90fsharpcoreclr' },
  go: { label: 'Go 1.24', tier: 'remote', compilerId: 'gl12413' },
  java: { label: 'Java · JDK 25', tier: 'remote', compilerId: 'java2501' },
  kotlin: { label: 'Kotlin 2.2', tier: 'remote', compilerId: 'kotlinc2220' },
  swift: { label: 'Swift 6.3', tier: 'remote', compilerId: 'swift633' },
  ruby: { label: 'Ruby 3.4', tier: 'remote', compilerId: 'ruby347' },
  rust: { label: 'Rust 1.98', tier: 'remote', compilerId: 'r1980' },
  zig: { label: 'Zig 0.16', tier: 'remote', compilerId: 'z0160' },
  dart: { label: 'Dart 3.7', tier: 'remote', compilerId: 'dart373' },
  lua: { label: 'Lua 5.4', tier: 'remote', compilerId: 'lua547' },
  julia: { label: 'Julia 1.12', tier: 'remote', compilerId: 'julia_1_12_5' },
  perl: { label: 'Perl 5.44', tier: 'remote', compilerId: 'perl5440' },
  haskell: { label: 'Haskell · GHC 9.12', tier: 'remote', compilerId: 'ghc9122' },
  crystal: { label: 'Crystal 1.9', tier: 'remote', compilerId: 'crystal192' },
  d: { label: 'D · ldc 1.42', tier: 'remote', compilerId: 'ldc1_42' },
  fortran: { label: 'Fortran · gfortran 16.2', tier: 'remote', compilerId: 'gfortran162' },
  pascal: { label: 'Pascal · fpc 3.2', tier: 'remote', compilerId: 'fpc322' },
  ocaml: { label: 'OCaml 5.2', tier: 'remote', compilerId: 'ocaml5200' },
};

/** Common aliases normalized to canonical keys. */
const ALIASES: Record<string, string> = {
  py: 'python',
  python3: 'python',
  js: 'node',
  typescript: 'node', // TS type syntax is stripped-safe only for plain JS — run via Node
  ts: 'node',
  sh: 'bash',
  shell: 'bash',
  'c++': 'cpp',
  'cxx': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  'f#': 'fsharp',
  golang: 'go',
  rs: 'rust',
  rb: 'ruby',
};

/** Normalize any user/model-provided language id to a canonical runtime key. */
export function normalizeExecLanguage(raw: string): string | null {
  const key = String(raw || '').trim().toLowerCase();
  if (!key) return null;
  if (key in EXEC_RUNTIMES) return key;
  if (key in ALIASES) return ALIASES[key];
  return null;
}

/** Every accepted language name (for the execute_code tool enum). */
export const EXEC_LANGUAGE_NAMES = Object.keys(EXEC_RUNTIMES);

/** One-line guidance per tier for the system prompt / tool description. */
export function execLanguageDoc(): string {
  const byTier = (t: ExecTier) =>
    Object.entries(EXEC_RUNTIMES)
      .filter(([, d]) => d.tier === t)
      .map(([name]) => name)
      .join(', ');
  return [
    `local (persistent workspace, live stdout): ${byTier('local')}`,
    `server sandbox (workspace files sync in/out, 25s limit): ${byTier('server')}`,
    `remote executor (ephemeral snippets, compile may take seconds, no workspace files): ${byTier('remote')}`,
  ].join('\n');
}
