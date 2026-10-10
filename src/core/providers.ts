// Un proveedor = protocolo + URL base + clave. El agente solo ve ChatModel.
import { AnthropicClient } from './anthropic';
import { OpenAIClient, type ChatModel, type LLMConfig, type ProviderKind } from './llm';

export const PROVIDER_KINDS: readonly ProviderKind[] = ['openai', 'anthropic'];

/** URL base de cada protocolo, con su /v1: a ella se añaden /chat/completions, /messages o /models. */
export const DEFAULT_BASE_URL: Record<ProviderKind, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
};

export function createChatModel(kind: ProviderKind, cfg: LLMConfig, sessionId?: string): ChatModel {
  return kind === 'anthropic' ? new AnthropicClient(cfg, sessionId) : new OpenAIClient(cfg, sessionId);
}

/** Valida y normaliza la URL base que escribe el usuario: http(s) y sin barra final. */
export function normalizeBaseUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error(`"${input.trim()}" no es una URL. Escribe la URL base completa, p. ej. ${DEFAULT_BASE_URL.openai}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`La URL base debe empezar por https:// (o http:// para un servidor local), no ${url.protocol}`);
  }
  return url.toString().replace(/\/+$/, '');
}
