'use client';

/**
 * API Docs view — the in-app reference for the RGE Hub Public API v1
 * (/api/v1/*). Covers authentication (the account API key revealed in
 * Settings → Security), the response envelope, every endpoint with
 * copy-paste curl examples, and the error codes.
 *
 * Examples use the RUNTIME origin so they are copy-paste correct on every
 * instance (localhost, preview, production).
 */

import React, { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  Braces,
  Check,
  Copy,
  KeyRound,
  AlertCircle,
  ArrowRight,
  Terminal,
  ShieldCheck,
  Activity,
  Gauge,
} from 'lucide-react';

// ────────────────────────────────────────────────────────────────────────────
// Shared bits
// ────────────────────────────────────────────────────────────────────────────

const BASE_FALLBACK = 'https://rge-hub.vercel.app';

function useBase(): string {
  // Runtime origin for copy-paste-correct examples on every instance
  // (localhost, preview, production). This view only mounts via client-side
  // navigation, so window is always available when it renders.
  return typeof window !== 'undefined' && window.location.origin
    ? window.location.origin
    : BASE_FALLBACK;
}

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

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

const METHOD_CLASS: Record<Method, string> = {
  GET: 'text-emerald-400 border-emerald-400/20 bg-emerald-400/10',
  POST: 'text-[#ef233c] border-[#ef233c]/20 bg-[#ef233c]/10',
  PATCH: 'text-amber-400 border-amber-400/20 bg-amber-400/10',
  DELETE: 'text-red-400 border-red-400/20 bg-red-400/10',
};

function MethodBadge({ method }: { method: Method }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md border font-mono text-[10px] font-bold tracking-wider ${METHOD_CLASS[method]}`}>
      {method}
    </span>
  );
}

type AuthLevel = 'none' | 'key' | 'owner';

function AuthChip({ level }: { level: AuthLevel }) {
  const map: Record<AuthLevel, { label: string; cls: string }> = {
    none: { label: 'No auth', cls: 'text-zinc-400 border-white/10 bg-white/[0.03]' },
    key: { label: 'API key', cls: 'text-[#ef233c] border-[#ef233c]/20 bg-[#ef233c]/10' },
    owner: { label: 'API key · owner', cls: 'text-[#ef233c] border-[#ef233c]/20 bg-[#ef233c]/10' },
  };
  const { label, cls } = map[level];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-manrope uppercase tracking-[0.12em] ${cls}`}>
      <KeyRound className="w-2.5 h-2.5" />
      {label}
    </span>
  );
}

interface EndpointDoc {
  method: Method;
  path: string;
  auth: AuthLevel;
  summary: string;
  description: string;
  params?: Array<{ name: string; type: string; desc: string }>;
  curl: (base: string) => string;
}

const ENDPOINTS: EndpointDoc[] = [
  {
    method: 'GET',
    path: '/api/v1/health',
    auth: 'none',
    summary: 'Instance health',
    description: 'Liveness of the API + storage engine. The cheapest way to check an instance is up — also used by the MCP server\u2019s --check mode.',
    curl: (b) => `curl ${b}/api/v1/health`,
  },
  {
    method: 'GET',
    path: '/api/v1/me',
    auth: 'key',
    summary: 'My account',
    description: 'The authenticated account: profile (safe fields — never the key) and upload/follower counts. The natural first call to verify a key works.',
    curl: (b) => `curl ${b}/api/v1/me \\\n  -H "Authorization: Bearer kv_live_xxx"`,
  },
  {
    method: 'GET',
    path: '/api/v1/resources',
    auth: 'key',
    summary: 'List my resources',
    description: 'Everything you own — images, clips, and files/XMLs — drafts included, newest first.',
    params: [
      { name: 'type', type: 'image | clip | xml', desc: 'Filter by resource type (xml = generic files incl. XML presets)' },
      { name: 'published', type: 'true | false', desc: 'Filter by published state' },
      { name: 'limit', type: '1–200', desc: 'Max results (default 100)' },
    ],
    curl: (b) => `curl "${b}/api/v1/resources?type=xml&limit=20" \\\n  -H "X-API-Key: kv_live_xxx"`,
  },
  {
    method: 'POST',
    path: '/api/v1/resources',
    auth: 'key',
    summary: 'Create a resource',
    description:
      'Two modes. LINK: pass url (http(s)) — the type is guessed from the URL when omitted. TEXT: pass content (≤ 2 MB) — stored as a real file on Hub storage. Both accept the shared fields below.',
    params: [
      { name: 'title', type: 'string', desc: 'Required, 1–200 chars' },
      { name: 'url', type: 'string', desc: 'http(s) link (link mode)' },
      { name: 'content', type: 'string', desc: 'Text file body, ≤ 2 MB (text mode)' },
      { name: 'fileName', type: 'string', desc: 'e.g. "my-preset.xml" (text mode, default file.txt)' },
      { name: 'tags / category / description', type: '—', desc: 'Optional metadata' },
      { name: 'published', type: 'boolean', desc: 'Publish immediately (default true)' },
      { name: 'clientId', type: 'string', desc: 'Idempotency key (8–64 chars [A-Za-z0-9_-]) — retries return the SAME resource instead of duplicating' },
    ],
    curl: (b) => `curl -X POST ${b}/api/v1/resources \\\n  -H "Authorization: Bearer kv_live_xxx" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "title": "My Test Preset",\n    "content": "<preset><version>1.0</version></preset>",\n    "fileName": "my-preset.xml",\n    "tags": ["preset", "api"],\n    "clientId": "my-stable-key-01"\n  }'`,
  },
  {
    method: 'GET',
    path: '/api/v1/resources/{id}',
    auth: 'none',
    summary: 'Get a resource',
    description: 'One resource by id (e.g. xml_ab12cd34). Published resources are public; drafts are visible only to their owner\u2019s key.',
    curl: (b) => `curl ${b}/api/v1/resources/xml_ab12cd34`,
  },
  {
    method: 'PATCH',
    path: '/api/v1/resources/{id}',
    auth: 'owner',
    summary: 'Update my resource',
    description: 'Partial update of your own resource: title, description, tags, category, published.',
    curl: (b) => `curl -X PATCH ${b}/api/v1/resources/xml_ab12cd34 \\\n  -H "Authorization: Bearer kv_live_xxx" \\\n  -H "Content-Type: application/json" \\\n  -d '{ "published": false, "description": "Moved to drafts" }'`,
  },
  {
    method: 'DELETE',
    path: '/api/v1/resources/{id}',
    auth: 'owner',
    summary: 'Delete my resource',
    description: 'Deletes your own resource. Idempotent — deleting an already-deleted id still succeeds.',
    curl: (b) => `curl -X DELETE ${b}/api/v1/resources/xml_ab12cd34 \\\n  -H "Authorization: Bearer kv_live_xxxx"`,
  },
  {
    method: 'GET',
    path: '/api/v1/files/{fileId}',
    auth: 'none',
    summary: 'File metadata + URL',
    description: 'Metadata for a stored file plus its permanent on-domain download URL (a stable address even if the storage host changes).',
    curl: (b) => `curl ${b}/api/v1/files/blb_1ca5e74919a903d45b03d5fe`,
  },
  {
    method: 'GET',
    path: '/api/v1/search',
    auth: 'none',
    summary: 'Search public resources',
    description: 'Full-text search over published resources — title, description, creator, and tags.',
    params: [
      { name: 'q', type: 'string', desc: 'Required, 1–200 chars' },
      { name: 'limit', type: '1–200', desc: 'Max results (default 50)' },
    ],
    curl: (b) => `curl "${b}/api/v1/search?q=rail&limit=10"`,
  },
  {
    method: 'GET',
    path: '/api/v1/community/feed',
    auth: 'none',
    summary: 'Community feed',
    description: 'All published community resources, newest first.',
    params: [{ name: 'limit', type: '1–200', desc: 'Max results (default 50)' }],
    curl: (b) => `curl "${b}/api/v1/community/feed?limit=10"`,
  },
  {
    method: 'GET',
    path: '/api/v1/users/{username}',
    auth: 'none',
    summary: 'Public creator profile',
    description: 'A creator\u2019s public profile by username: follower counts and their published resources.',
    curl: (b) => `curl ${b}/api/v1/users/railguyedits`,
  },
  {
    method: 'GET',
    path: '/api/v1/openapi.json',
    auth: 'none',
    summary: 'OpenAPI 3.1 spec',
    description: 'The whole surface as a machine-readable OpenAPI 3.1 document — for codegen, explorers, and tooling.',
    curl: (b) => `curl ${b}/api/v1/openapi.json`,
  },
];

const ERROR_CODES: Array<{ code: string; meaning: string }> = [
  { code: 'UNAUTHENTICATED', meaning: 'Missing, malformed, or invalid API key' },
  { code: 'RATE_LIMITED', meaning: 'Too many requests — retry after error.retryAfterSecs seconds' },
  { code: 'VALIDATION_ERROR', meaning: 'Invalid input — the message names the field' },
  { code: 'NOT_FOUND', meaning: 'Resource or user does not exist (also returned for drafts you cannot see)' },
  { code: 'FORBIDDEN', meaning: 'Not your resource (update/delete are owner-only)' },
  { code: 'UPLOAD_FAILED', meaning: 'Registration failed — retry with the SAME clientId (never re-upload)' },
  { code: 'UPSTREAM_UNAVAILABLE', meaning: 'Storage briefly throttled — your data is safe, retry shortly' },
  { code: 'ACCOUNT_NOT_FOUND', meaning: 'Key is valid but has no Hub profile — sign in to the Hub once' },
];

// ────────────────────────────────────────────────────────────────────────────
// View
// ────────────────────────────────────────────────────────────────────────────

export function ApiDocsView({ onOpenMcp }: { onOpenMcp: () => void }) {
  const base = useBase();

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="rounded-xl border border-white/10 bg-black/60 backdrop-blur-xl p-6 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-[#ef233c]/10 blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#ef233c]/10 border border-[#ef233c]/20 flex items-center justify-center shrink-0">
              <Braces className="w-6 h-6 text-[#ef233c]" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="font-manrope font-semibold text-2xl text-white leading-tight">Public API</h1>
              <p className="text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500 mt-1">
                RGE Hub API · v1 · /api/v1
              </p>
            </div>
            <button
              onClick={onOpenMcp}
              className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-[#ef233c]/30 bg-[#ef233c]/10 text-[#ef233c] text-xs font-manrope font-medium hover:bg-[#ef233c]/20 transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] shrink-0"
            >
              MCP server <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-sm text-zinc-400 mt-4 leading-relaxed">
            Manage your images, clips, and file/XML resources programmatically — the same API that
            powers the RGE Agent and the self-hosted MCP server. Authenticate with your account
            API key and everything the app can do with resources, the API can do too.
          </p>
          <button
            onClick={onOpenMcp}
            className="sm:hidden mt-4 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-[#ef233c]/30 bg-[#ef233c]/10 text-[#ef233c] text-xs font-manrope font-medium"
          >
            MCP server docs <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Authentication */}
      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <KeyRound className="w-4 h-4 text-[#ef233c]" />
          <h2 className="font-manrope font-semibold text-white">Authentication</h2>
        </div>
        <p className="text-sm text-zinc-400 leading-relaxed">
          Every authenticated call uses your account API key — the same key revealed in{' '}
          <span className="text-zinc-200 font-medium">Settings → Security → “Reveal API key”</span>{' '}
          (format <code className="font-mono text-xs text-[#ff8fa3]">kv_live_…</code>). Send it in
          either header:
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <CodeBlock title="Authorization header" code={`Authorization: Bearer kv_live_xxx`} />
          <CodeBlock title="Dedicated header" code={`X-API-Key: kv_live_xxx`} />
        </div>
        <div className="flex items-start gap-2 p-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.05]">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-zinc-400 leading-relaxed">
            Your key grants full access to your account — keep it secret. It is only ever shown to
            you (its owner) in Settings. If it leaks, sign in to the Hub again: login mints a fresh
            key and the old one rotates out of your profile.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-black/40 border border-white/5">
            <Gauge className="w-4 h-4 text-[#ef233c] shrink-0" />
            <div>
              <div className="text-xs font-medium text-white">90 req/min</div>
              <div className="text-[10px] text-zinc-500">per API key (authenticated)</div>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-xl bg-black/40 border border-white/5">
            <Gauge className="w-4 h-4 text-[#ef233c] shrink-0" />
            <div>
              <div className="text-xs font-medium text-white">30–60 req/min</div>
              <div className="text-[10px] text-zinc-500">per IP (public endpoints)</div>
            </div>
          </div>
        </div>
      </section>

      {/* Response format */}
      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <Activity className="w-4 h-4 text-[#ef233c]" />
          <h2 className="font-manrope font-semibold text-white">Response format</h2>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <CodeBlock
            title="Success — HTTP 200"
            code={`{
  "success": true,
  "data": { … },
  "requestId": "702add66-95d6-…",
  "durationMs": 12
}`}
          />
          <CodeBlock
            title="Failure"
            code={`{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Resource not found."
  },
  "requestId": "38bfd0c6-b763-…"
}`}
          />
        </div>
        <p className="text-xs text-zinc-500 leading-relaxed">
          Every response carries an <code className="font-mono">x-request-id</code> header and a
          machine-readable error code — never a vague “server busy”. Rate-limited responses add{' '}
          <code className="font-mono">retryAfterSecs</code>.
        </p>
      </section>

      {/* Endpoints */}
      <section className="space-y-3">
        <div className="flex items-center gap-2.5 px-1">
          <Terminal className="w-4 h-4 text-[#ef233c]" />
          <h2 className="font-manrope font-semibold text-white">Endpoints</h2>
          <span className="text-[10px] font-mono text-zinc-600">{ENDPOINTS.length} routes</span>
        </div>
        {ENDPOINTS.map((ep) => (
          <article
            key={`${ep.method} ${ep.path}`}
            className="rounded-xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.04] transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] p-5 space-y-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <MethodBadge method={ep.method} />
              <code className="font-mono text-sm text-zinc-200 break-all">{ep.path}</code>
              <span className="flex-1" />
              <AuthChip level={ep.auth} />
            </div>
            <div>
              <h3 className="text-sm font-medium text-white">{ep.summary}</h3>
              <p className="text-xs text-zinc-500 leading-relaxed mt-1">{ep.description}</p>
            </div>
            {ep.params && ep.params.length > 0 && (
              <div className="rounded-lg border border-white/5 bg-black/40 overflow-hidden">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-white/5">
                      <th className="px-3 py-1.5 text-[9px] font-mono uppercase tracking-[0.15em] text-zinc-600">Param</th>
                      <th className="px-3 py-1.5 text-[9px] font-mono uppercase tracking-[0.15em] text-zinc-600 hidden sm:table-cell">Type</th>
                      <th className="px-3 py-1.5 text-[9px] font-mono uppercase tracking-[0.15em] text-zinc-600">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ep.params.map((p) => (
                      <tr key={p.name} className="border-b border-white/5 last:border-0">
                        <td className="px-3 py-1.5 font-mono text-[11px] text-[#ff8fa3] align-top whitespace-nowrap">{p.name}</td>
                        <td className="px-3 py-1.5 font-mono text-[11px] text-zinc-500 align-top hidden sm:table-cell whitespace-nowrap">{p.type}</td>
                        <td className="px-3 py-1.5 text-[11px] text-zinc-400 align-top">{p.desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <CodeBlock title={`curl — ${ep.method} ${ep.path}`} code={ep.curl(base)} />
          </article>
        ))}
      </section>

      {/* Errors */}
      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="w-4 h-4 text-[#ef233c]" />
          <h2 className="font-manrope font-semibold text-white">Error codes</h2>
        </div>
        <div className="rounded-lg border border-white/5 bg-black/40 overflow-hidden">
          <table className="w-full text-left">
            <tbody>
              {ERROR_CODES.map((e) => (
                <tr key={e.code} className="border-b border-white/5 last:border-0">
                  <td className="px-3 py-2 font-mono text-[11px] text-[#ff8fa3] align-top whitespace-nowrap">{e.code}</td>
                  <td className="px-3 py-2 text-[11px] text-zinc-400 align-top">{e.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
