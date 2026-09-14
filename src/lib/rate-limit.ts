/**
 * In-memory sliding-window rate limiter (PRD §39 / OnyxBase PRD §39).
 *
 * Lightweight, per-instance (serverless instances each enforce their own
 * window — an acceptable best-effort bound that stops accidental floods
 * like OTP re-request spam without hammering any backend).
 *
 * Semantics:
 *   allow(key, limit, windowMs) → { allowed, retryAfterSecs, remaining }
 *
 * NOT a security boundary — a distributed attacker can exceed this — but it
 * protects the backing services (MCPEmails 100/min key limit, AI SENSE
 * 5,000 req/IP/24h, Telegram pacing) from ordinary user behavior.
 */

interface Window {
  hits: number[];
}

const windows = new Map<string, Window>();

/** Periodically drop stale windows so the map cannot grow unbounded. */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
let lastSweep = 0;

function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, w] of windows) {
    // Windows with no hit in the last hour are dead.
    if (w.hits.length === 0 || now - w.hits[w.hits.length - 1] > 60 * 60 * 1000) {
      windows.delete(key);
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the oldest hit leaves the window (for Retry-After). */
  retryAfterSecs?: number;
}

export function allow(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);
  let w = windows.get(key);
  if (!w) {
    w = { hits: [] };
    windows.set(key, w);
  }
  // Drop hits outside the window.
  while (w.hits.length > 0 && now - w.hits[0] >= windowMs) {
    w.hits.shift();
  }
  if (w.hits.length >= limit) {
    const retryAfterMs = windowMs - (now - w.hits[0]);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSecs: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }
  w.hits.push(now);
  return { allowed: true, remaining: limit - w.hits.length };
}

/** Extract a best-effort client IP from proxy headers (display/rate-limit only). */
export function clientIpFrom(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}
