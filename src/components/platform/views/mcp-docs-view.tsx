'use client';

/**
 * MCP Docs view — the in-app documentation for the self-hosted RGE Hub MCP
 * server (mcp/server.mjs in the repo): what it is, the self-hosting model,
 * quick start, client configuration snippets (Claude Desktop / Cursor /
 * VS Code / Claude Code / Streamable HTTP), the 12 packed tools, and
 * security notes.
 */

import React, { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  Plug,
  Check,
  Copy,
  Server,
  Download,
  KeyRound,
  ShieldCheck,
  AlertCircle,
  ArrowRight,
  Wrench,
  Boxes,
  Lock,
} from 'lucide-react';

// ────────────────────────────────────────────────────────────────────────────
// Shared bits (same language as api-docs-view)
// ────────────────────────────────────────────────────────────────────────────

function CopyButton({ text, label }: { text: string; label?: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
            if (label) toast({ title: 'Copied', description: label });
          })
          .catch(() => toast({ title: 'Copy failed', variant: 'destructive' }));
      }}
      className="shrink-0 p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/10 transition-all duration-300"
      title="Copy to clipboard"
      aria-label="Copy to clipboard"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function CodeBlock({ code, title }: { code: string; title?: string }) {
  return (
    <div className="rounded-xl bg-black/60 border border-white/10 overflow-hidden">
      {title && (
        <div className="flex items-center justify-between gap-2 px-3.5 py-2 border-b border-white/5 bg-white/[0.02]">
          <span className="text-[9px] font-mono uppercase tracking-[0.15em] text-zinc-500">{title}</span>
          <CopyButton text={code} label={title} />
        </div>
      )}
      <div className="relative">
        <pre className="overflow-x-auto custom-scrollbar p-3.5 pr-11 font-mono text-[11px] leading-relaxed text-zinc-300 whitespace-pre">
          {code}
        </pre>
        {!title && (
          <div className="absolute top-2.5 right-2.5">
            <CopyButton text={code} />
          </div>
        )}
      </div>
    </div>
  );
}

const DOWNLOAD_CMD = 'curl -O https://raw.githubusercontent.com/AkshayCoder48/rge-hub/main/mcp/server.mjs';
const CHECK_CMD = 'RGE_API_KEY=kv_live_xxx node server.mjs --check';

const CLIENT_CONFIGS: Array<{ id: string; label: string; code: string; note?: string }> = [
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    note: 'Settings → Developer → Edit Config (claude_desktop_config.json)',
    code: `{
  "mcpServers": {
    "rge-hub": {
      "command": "node",
      "args": ["/absolute/path/to/server.mjs"],
      "env": {
        "RGE_API_KEY": "kv_live_xxx",
        "RGE_BASE_URL": "https://rge-hub.vercel.app"
      }
    }
  }
}`,
  },
  {
    id: 'cursor',
    label: 'Cursor',
    note: '.cursor/mcp.json (project) or ~/.cursor/mcp.json (global)',
    code: `{
  "mcpServers": {
    "rge-hub": {
      "command": "node",
      "args": ["/absolute/path/to/server.mjs"],
      "env": {
        "RGE_API_KEY": "kv_live_xxx"
      }
    }
  }
}`,
  },
  {
    id: 'vscode',
    label: 'VS Code',
    note: '.vscode/mcp.json — then pick the server in Copilot Chat (Agent mode)',
    code: `{
  "servers": {
    "rge-hub": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/server.mjs"],
      "env": {
        "RGE_API_KEY": "kv_live_xxx"
      }
    }
  }
}`,
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    note: 'One-time CLI registration',
    code: `claude mcp add rge-hub \\
  --env RGE_API_KEY=kv_live_xxx \\
  -- node /absolute/path/to/server.mjs`,
  },
  {
    id: 'http',
    label: 'Streamable HTTP',
    note: 'For clients that prefer HTTP — binds 127.0.0.1:3333 by default',
    code: `# 1. start the server
RGE_API_KEY=kv_live_xxx node server.mjs --http 3333

# 2. add an HTTP MCP server pointing at:
#    http://127.0.0.1:3333/mcp`,
  },
];

interface McpTool {
  name: string;
  auth: boolean;
  desc: string;
}

const TOOLS: McpTool[] = [
  { name: 'rge_health', auth: false, desc: 'Instance health (API + storage status)' },
  { name: 'rge_me', auth: true, desc: 'Your profile + upload/follower counts — start here to verify the key' },
  { name: 'rge_list_my_resources', auth: true, desc: 'Your own resources (drafts included), filter by type/published' },
  { name: 'rge_get_resource', auth: false, desc: 'One resource by id (drafts need the owner\u2019s key)' },
  { name: 'rge_create_text_resource', auth: true, desc: 'Create a resource from text content — XML presets, JSON, notes (≤ 2 MB)' },
  { name: 'rge_create_link_resource', auth: true, desc: 'Create a resource pointing at an http(s) URL' },
  { name: 'rge_update_resource', auth: true, desc: 'Update your own resource (title, description, tags, category, published)' },
  { name: 'rge_delete_resource', auth: true, desc: 'Delete your own resource (idempotent)' },
  { name: 'rge_search_resources', auth: false, desc: 'Search public resources by title/description/creator/tags' },
  { name: 'rge_community_feed', auth: false, desc: 'The public community feed, newest first' },
  { name: 'rge_get_user', auth: false, desc: 'Public creator profile by username' },
  { name: 'rge_get_file', auth: false, desc: 'File metadata + permanent download URL' },
];

// ────────────────────────────────────────────────────────────────────────────
// View
// ────────────────────────────────────────────────────────────────────────────

export function McpDocsView({ onOpenApi }: { onOpenApi: () => void }) {
  const [activeClient, setActiveClient] = useState(CLIENT_CONFIGS[0].id);
  const active = CLIENT_CONFIGS.find((c) => c.id === activeClient) ?? CLIENT_CONFIGS[0];

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="rounded-xl border border-white/10 bg-black/60 backdrop-blur-xl p-6 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-[#ef233c]/10 blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#ef233c]/10 border border-[#ef233c]/20 flex items-center justify-center shrink-0">
              <Plug className="w-6 h-6 text-[#ef233c]" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="font-manrope font-semibold text-2xl text-white leading-tight">MCP Server</h1>
              <p className="text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500 mt-1">
                Model Context Protocol · self-hosted · zero dependencies
              </p>
            </div>
            <button
              onClick={onOpenApi}
              className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-[#ef233c]/30 bg-[#ef233c]/10 text-[#ef233c] text-xs font-manrope font-medium hover:bg-[#ef233c]/20 transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] shrink-0"
            >
              Public API <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-sm text-zinc-400 mt-4 leading-relaxed">
            A self-hosted <span className="text-zinc-200 font-medium">Model Context Protocol</span>{' '}
            server that packs the RGE Hub Public API into 12 tools — so AI clients like Claude
            Desktop, Cursor, and VS Code can manage your images, clips, and file/XML resources
            conversationally: <span className="text-zinc-200">“publish this preset”, “search the
            feed for rail edits”, “show my drafts”</span>.
          </p>
          <button
            onClick={onOpenApi}
            className="sm:hidden mt-4 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-[#ef233c]/30 bg-[#ef233c]/10 text-[#ef233c] text-xs font-manrope font-medium"
          >
            Public API docs <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Self-hosting */}
      <section className="rounded-xl border border-[#ef233c]/20 bg-[#ef233c]/[0.04] p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <Server className="w-4 h-4 text-[#ef233c]" />
          <h2 className="font-manrope font-semibold text-white">Self-hosting only</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: Server, title: 'Runs on your machine', desc: 'One plain Node.js ≥ 18 file — no install, no npm packages, no build step' },
            { icon: Lock, title: 'Your key stays local', desc: 'The API key only ever travels from your machine to the Hub instance you point at' },
            { icon: Boxes, title: 'No third parties', desc: 'No hosted/shared MCP endpoint, no external MCP service, no paid dependency' },
          ].map((f) => (
            <div key={f.title} className="p-3.5 rounded-xl bg-black/40 border border-white/5 space-y-1.5">
              <f.icon className="w-4 h-4 text-[#ef233c]" />
              <div className="text-xs font-medium text-white">{f.title}</div>
              <div className="text-[11px] text-zinc-500 leading-relaxed">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Quick start */}
      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <Download className="w-4 h-4 text-[#ef233c]" />
          <h2 className="font-manrope font-semibold text-white">Quick start</h2>
        </div>
        <ol className="space-y-4">
          <li className="flex gap-3">
            <span className="w-6 h-6 rounded-lg bg-[#ef233c]/10 border border-[#ef233c]/20 flex items-center justify-center text-[11px] font-mono font-bold text-[#ef233c] shrink-0">1</span>
            <div className="space-y-2 min-w-0 flex-1">
              <p className="text-sm text-zinc-400">
                Get your API key from{' '}
                <span className="text-zinc-200 font-medium">Settings → Security → “Reveal API key”</span>{' '}
                (<code className="font-mono text-xs text-[#ff8fa3]">kv_live_…</code>).
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="w-6 h-6 rounded-lg bg-[#ef233c]/10 border border-[#ef233c]/20 flex items-center justify-center text-[11px] font-mono font-bold text-[#ef233c] shrink-0">2</span>
            <div className="space-y-2 min-w-0 flex-1">
              <p className="text-sm text-zinc-400">Download the server — a single file, no install:</p>
              <CodeBlock title="terminal" code={DOWNLOAD_CMD} />
            </div>
          </li>
          <li className="flex gap-3">
            <span className="w-6 h-6 rounded-lg bg-[#ef233c]/10 border border-[#ef233c]/20 flex items-center justify-center text-[11px] font-mono font-bold text-[#ef233c] shrink-0">3</span>
            <div className="space-y-2 min-w-0 flex-1">
              <p className="text-sm text-zinc-400">Verify the key and instance, then wire it into your MCP client below:</p>
              <CodeBlock title="terminal" code={CHECK_CMD} />
              <p className="text-[11px] text-zinc-600 leading-relaxed">
                Self-hosting your own Hub instance? Set{' '}
                <code className="font-mono text-zinc-500">RGE_BASE_URL</code> (default{' '}
                <code className="font-mono text-zinc-500">https://rge-hub.vercel.app</code>).
              </p>
            </div>
          </li>
        </ol>
      </section>

      {/* Client configuration */}
      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <Wrench className="w-4 h-4 text-[#ef233c]" />
          <h2 className="font-manrope font-semibold text-white">Client configuration</h2>
        </div>
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-black/60 border border-white/10 w-fit overflow-x-auto max-w-full">
          {CLIENT_CONFIGS.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveClient(c.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${
                activeClient === c.id
                  ? 'bg-[#ef233c]/10 text-white border border-[#ef233c]/30'
                  : 'text-zinc-500 hover:text-white border border-transparent'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        {active.note && <p className="text-[11px] text-zinc-500">{active.note}</p>}
        <CodeBlock title={active.label} code={active.code} />
      </section>

      {/* Tools */}
      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <Wrench className="w-4 h-4 text-[#ef233c]" />
          <h2 className="font-manrope font-semibold text-white">Tools</h2>
          <span className="text-[10px] font-mono text-zinc-600">{TOOLS.length} tools · packed 1:1 from the public API</span>
        </div>
        <div className="rounded-lg border border-white/5 bg-black/40 overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-white/5">
                <th className="px-3 py-2 text-[9px] font-mono uppercase tracking-[0.15em] text-zinc-600">Tool</th>
                <th className="px-3 py-2 text-[9px] font-mono uppercase tracking-[0.15em] text-zinc-600">Auth</th>
                <th className="px-3 py-2 text-[9px] font-mono uppercase tracking-[0.15em] text-zinc-600">Description</th>
              </tr>
            </thead>
            <tbody>
              {TOOLS.map((t) => (
                <tr key={t.name} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors">
                  <td className="px-3 py-2 font-mono text-[11px] text-[#ff8fa3] align-top whitespace-nowrap">{t.name}</td>
                  <td className="px-3 py-2 align-top">
                    {t.auth ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-[#ef233c]/20 bg-[#ef233c]/10 text-[9px] font-manrope uppercase tracking-[0.12em] text-[#ef233c]">
                        <KeyRound className="w-2.5 h-2.5" /> key
                      </span>
                    ) : (
                      <span className="text-[10px] text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-zinc-400 align-top">{t.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-zinc-500 leading-relaxed">
          Create/update calls accept a <code className="font-mono">clientId</code> idempotency key —
          retries with the same key return the same resource instead of duplicating. Rate limits
          (90 req/min per key) surface as tool errors with retry hints.
        </p>
      </section>

      {/* Security */}
      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="w-4 h-4 text-[#ef233c]" />
          <h2 className="font-manrope font-semibold text-white">Security notes</h2>
        </div>
        <ul className="space-y-2.5">
          {[
            'Your API key is equivalent to your account password for API access — never commit it. The client configs above keep it in local files only.',
            'The server sends the key only to your configured RGE_BASE_URL, over HTTPS.',
            'To rotate a leaked key: sign in to the Hub again (login mints a fresh key), then update your env var.',
            'The HTTP transport binds to 127.0.0.1 by default — only use --host 0.0.0.0 on trusted networks.',
          ].map((line) => (
            <li key={line} className="flex items-start gap-2.5">
              <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <span className="text-xs text-zinc-400 leading-relaxed">{line}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
