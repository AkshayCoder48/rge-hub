/**
 * RGE Agent — per-user LLM provider configuration.
 *
 * Stored in the engine KV (master-authed, server-only) under collection
 * 'agentConfig', key `cfg:${userId}`. The raw apiKey NEVER leaves the
 * server — every client-facing surface uses `toPublicConfig()` masking.
 */

import { kvGet, kvSet } from '../onyxbase';
import type { AgentConfig, AgentConfigPublic, AgentProvider } from './types';

const AGENT_CONFIG_COLLECTION = 'agentConfig';

export const DEFAULT_TEMPERATURE = 0.6;
export const DEFAULT_MAX_TOKENS = 4096;

export function defaultAgentConfig(): AgentConfig {
  return {
    provider: 'zai',
    model: '',
    temperature: DEFAULT_TEMPERATURE,
    maxTokens: DEFAULT_MAX_TOKENS,
  };
}

function configKey(userId: string): string {
  return `cfg:${userId}`;
}

/** Load the stored config (falling back to defaults). Never throws. */
export async function getAgentConfig(userId: string): Promise<AgentConfig> {
  const stored = await kvGet<Partial<AgentConfig>>(configKey(userId), AGENT_CONFIG_COLLECTION).catch(
    () => null
  );
  const base = defaultAgentConfig();
  if (!stored || typeof stored !== 'object') return base;
  return sanitizeConfig({ ...base, ...stored });
}

/**
 * Merge + persist a config patch. Undefined fields keep their stored
 * values; the apiKey follows "empty string clears, masked-looking value
 * keeps the stored key" semantics so the UI can round-trip the mask.
 */
export async function saveAgentConfig(
  userId: string,
  patch: Partial<AgentConfig>
): Promise<AgentConfig> {
  const current = await getAgentConfig(userId);
  const next = sanitizeConfig({ ...current, ...patch });

  // apiKey handling: undefined → keep; '' → clear; masked echo → keep.
  if (patch.apiKey === '') {
    next.apiKey = undefined;
  } else if (typeof patch.apiKey === 'string' && patch.apiKey.includes('…')) {
    next.apiKey = current.apiKey;
  }

  next.updatedAt = new Date().toISOString();
  await kvSet(configKey(userId), next, AGENT_CONFIG_COLLECTION);
  return next;
}

/** Clamp/validate field values into a well-formed AgentConfig. */
export function sanitizeConfig(cfg: AgentConfig): AgentConfig {
  const provider: AgentProvider = cfg.provider === 'openai' ? 'openai' : 'zai';
  let temperature = typeof cfg.temperature === 'number' ? cfg.temperature : DEFAULT_TEMPERATURE;
  if (!Number.isFinite(temperature)) temperature = DEFAULT_TEMPERATURE;
  temperature = Math.max(0, Math.min(2, temperature));
  let maxTokens = typeof cfg.maxTokens === 'number' ? Math.round(cfg.maxTokens) : DEFAULT_MAX_TOKENS;
  if (!Number.isFinite(maxTokens) || maxTokens < 256) maxTokens = DEFAULT_MAX_TOKENS;
  if (maxTokens > 32768) maxTokens = 32768;
  const model = typeof cfg.model === 'string' ? cfg.model.trim().slice(0, 120) : '';
  const baseUrl =
    typeof cfg.baseUrl === 'string' && cfg.baseUrl.trim()
      ? cfg.baseUrl.trim().replace(/\/+$/, '').slice(0, 300)
      : undefined;
  const apiKey =
    typeof cfg.apiKey === 'string' && cfg.apiKey.trim() ? cfg.apiKey.trim().slice(0, 400) : undefined;
  return {
    provider,
    baseUrl: provider === 'openai' ? baseUrl : undefined,
    apiKey: provider === 'openai' ? apiKey : undefined,
    model,
    temperature,
    maxTokens,
    updatedAt: typeof cfg.updatedAt === 'string' ? cfg.updatedAt : undefined,
  };
}

/** Mask an API key: first 4 + … + last 4 (short keys fully masked). */
export function maskApiKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  if (key.length <= 12) return '••••••••';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/** True when the config can actually run a chat (used for honest errors). */
export function isConfigured(cfg: AgentConfig): boolean {
  if (cfg.provider === 'openai') {
    return !!cfg.baseUrl && /^https?:\/\//.test(cfg.baseUrl) && !!cfg.apiKey;
  }
  // 'zai' uses the sandbox-provisioned z-ai-web-dev-sdk credentials.
  return true;
}

/** Client-safe projection (masked key + configured flag). */
export function toPublicConfig(cfg: AgentConfig): AgentConfigPublic {
  return {
    provider: cfg.provider,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
    hasApiKey: !!cfg.apiKey,
    apiKeyMasked: maskApiKey(cfg.apiKey),
    updatedAt: cfg.updatedAt,
    configured: isConfigured(cfg),
  };
}
