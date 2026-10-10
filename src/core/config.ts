import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderKind } from './llm';

export type PermissionMode = 'read-only' | 'ask' | 'full';
export type Effort = 'low' | 'medium' | 'high';

export interface McpServerConfig {
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  enabled: boolean;
}

export interface AppConfig {
  provider: ProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  models: string[];
  effort: Effort;
  workspace: string;
  permissionMode: PermissionMode;
  maxSteps: number;
  searchUrl: string;
  mcpServers: McpServerConfig[];
}

function parseDotEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

export function loadConfig(appRoot: string): AppConfig {
  const env = { ...parseDotEnv(join(appRoot, '.env')), ...process.env };
  const mode = (env.TURNWISE_PERMISSION_MODE ?? 'ask') as PermissionMode;
  return {
    provider: env.TURNWISE_PROVIDER === 'anthropic' ? 'anthropic' : 'openai',
    baseUrl: (env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
    apiKey: env.OPENAI_API_KEY ?? '',
    model: env.OPENAI_MODEL ?? 'gpt-4.1',
    // Respaldo si el endpoint no lista sus modelos: TURNWISE_MODELS=a,b,c en .env.
    models: (env.TURNWISE_MODELS ?? '').split(',').map((m) => m.trim()).filter(Boolean),
    effort: (env.TURNWISE_EFFORT ?? 'medium') as Effort,
    workspace: env.TURNWISE_WORKSPACE ?? process.cwd(),
    permissionMode: ['read-only', 'ask', 'full'].includes(mode) ? mode : 'ask',
    maxSteps: Number(env.TURNWISE_MAX_STEPS ?? '40'),
    searchUrl: (env.TURNWISE_SEARCH_URL ?? '').replace(/\/$/, ''),
    mcpServers: [],
  };
}
