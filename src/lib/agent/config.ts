/**
 * RGE Agent — LLM provider configuration (PURE — client + server safe).
 *
 * The config (including the provider API key) lives in the USER'S BROWSER
 * (localStorage via the zustand persist store) and rides each chat request.
 * The server NEVER persists it. Every client-facing surface masks the key
 * via toPublicConfig()/maskApiKey().
 */

import type { AgentConfig, AgentConfigPublic, AgentProvider } from './types';

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
  const models =
    Array.isArray(cfg.models)
      ? cfg.models
          .filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
          .map((m) => m.trim().slice(0, 120))
          .slice(0, 500)
      : undefined;
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
    ...(models && models.length > 0 ? { models } : {}),
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

/** True when the config can actually run a chat (used for honest errors).
 * Keyless OpenAI-compatible providers are valid — only the base URL is
 * required (the key rides requests when present). */
export function isConfigured(cfg: AgentConfig): boolean {
  if (cfg.provider === 'openai') {
    return !!cfg.baseUrl && /^https?:\/\//.test(cfg.baseUrl);
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
    ...(cfg.models && cfg.models.length > 0 ? { models: cfg.models } : {}),
    hasApiKey: !!cfg.apiKey,
    apiKeyMasked: maskApiKey(cfg.apiKey),
    updatedAt: cfg.updatedAt,
    configured: isConfigured(cfg),
  };
}
