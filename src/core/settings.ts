// Ajustes que el usuario cambia desde la app y deben sobrevivir al reinicio.
// Mandan sobre los valores por defecto del .env.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { Effort, PermissionMode } from './config';
import type { ProviderKind } from './llm';

export interface SavedSettings {
  provider?: ProviderKind;
  baseUrl?: string;
  /** Clave API cifrada con safeStorage (DPAPI en Windows), en base64. Nunca en claro. */
  apiKeyEnc?: string;
  model?: string;
  effort?: Effort;
  permissionMode?: PermissionMode;
  workspace?: string;
  searchUrl?: string;
}

export const SETTINGS_FILE = 'settings.json';

const EFFORTS: readonly Effort[] = ['low', 'medium', 'high'];
const PERMISSIONS: readonly PermissionMode[] = ['read-only', 'ask', 'full'];
const PROVIDERS: readonly ProviderKind[] = ['openai', 'anthropic'];

function pick<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return allowed.find((a) => a === value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** Solo conserva campos con forma válida: un valor raro se ignora en vez de romper el arranque. */
export function parseSettings(raw: unknown): SavedSettings {
  if (typeof raw !== 'object' || raw === null) return {};
  const r: Record<string, unknown> = { ...raw };
  const out: SavedSettings = {};
  const provider = pick(r.provider, PROVIDERS);
  if (provider) out.provider = provider;
  const baseUrl = text(r.baseUrl);
  if (baseUrl) out.baseUrl = baseUrl;
  const apiKeyEnc = text(r.apiKeyEnc);
  if (apiKeyEnc) out.apiKeyEnc = apiKeyEnc;
  const model = text(r.model);
  if (model) out.model = model;
  const effort = pick(r.effort, EFFORTS);
  if (effort) out.effort = effort;
  const permissionMode = pick(r.permissionMode, PERMISSIONS);
  if (permissionMode) out.permissionMode = permissionMode;
  const workspace = text(r.workspace);
  if (workspace) out.workspace = workspace;
  if (typeof r.searchUrl === 'string') out.searchUrl = r.searchUrl;
  return out;
}

export function readSettings(path: string): SavedSettings {
  if (!existsSync(path)) return {};
  try {
    return parseSettings(JSON.parse(readFileSync(path, 'utf8')));
  } catch (err) {
    throw new Error(`No pude leer ${path}: ${err instanceof Error ? err.message : String(err)}. Corrige o borra el fichero.`);
  }
}

export function writeSettings(path: string, settings: SavedSettings): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
  renameSync(tmp, path);
}
