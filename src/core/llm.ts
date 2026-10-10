// Modelo de conversación común a los dos protocolos (forma OpenAI) y el cliente
// compatible con OpenAI (chat/completions + tools) con streaming SSE.
import { sseJson } from './sse';

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface StreamCallbacks {
  onText?: (delta: string) => void;
  onToolCallDelta?: (index: number, name: string, argsDelta: string) => void;
  signal?: AbortSignal;
}

/** Lo que el agente necesita de un proveedor, sea cual sea su protocolo. */
export interface ChatModel {
  chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<ChatMessage>;
  chatStream(messages: ChatMessage[], tools: ToolSpec[], cb?: StreamCallbacks): Promise<ChatMessage>;
}

export type ProviderKind = 'openai' | 'anthropic';

export class LLMError extends Error {}

export const MAX_TOOL_ARG_CHARS = 200000;
export const ANTHROPIC_VERSION = '2023-06-01';

/** Cada protocolo se autentica a su manera; el resto de cabeceras es común. */
export function authHeaders(kind: ProviderKind, apiKey: string): Record<string, string> {
  return kind === 'anthropic'
    ? { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION }
    : { authorization: `Bearer ${apiKey}` };
}

/**
 * OpenCode Go pide un identificador de cliente propio y una sesión estable por
 * conversación (x-opencode-session) para routing y caché de prompts; otros
 * proveedores ignoran ambas cabeceras.
 */
export function clientHeaders(sessionId: string): Record<string, string> {
  return { 'content-type': 'application/json', 'user-agent': 'turnwise/0.2.0', 'x-opencode-session': sessionId };
}

export function newSessionId(): string {
  return `turnwise-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function httpError(res: Response): Promise<LLMError> {
  const text = await res.text();
  return new LLMError(`LLM HTTP ${res.status}: ${text.slice(0, 500)}`);
}

interface OpenAIDelta {
  content?: string | null;
  tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
}

interface OpenAIChunk {
  choices?: Array<{ delta?: OpenAIDelta }>;
  error?: { message?: string };
}

export class OpenAIClient implements ChatModel {
  private readonly sessionId: string;

  constructor(
    private readonly cfg: LLMConfig,
    sessionId?: string,
  ) {
    this.sessionId = sessionId ?? newSessionId();
  }

  private buildBody(messages: ChatMessage[], tools: ToolSpec[]): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages,
    };
    if (tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body.tool_choice = 'auto';
    }
    return body;
  }

  private headers(): Record<string, string> {
    return { ...clientHeaders(this.sessionId), ...authHeaders('openai', this.cfg.apiKey) };
  }

  async chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<ChatMessage> {
    const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.buildBody(messages, tools)),
    });
    if (!res.ok) throw await httpError(res);
    const data = (await res.json()) as { choices: Array<{ message: ChatMessage }> };
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new LLMError('Respuesta del modelo sin choices[0].message');
    return msg;
  }

  /**
   * Streaming SSE incremental. Ensambla deltas de texto y de tool_calls
   * (argumentos por fragmentos). Cae a JSON si el servidor no devuelve `text/event-stream`.
   */
  async chatStream(messages: ChatMessage[], tools: ToolSpec[], cb: StreamCallbacks = {}): Promise<ChatMessage> {
    const body = this.buildBody(messages, tools);
    body.stream = true;

    const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: cb.signal,
    });
    if (!res.ok) throw await httpError(res);
    const ctype = res.headers.get('content-type') ?? '';
    if (!ctype.includes('text/event-stream') || !res.body) {
      // Fallback JSON: el proveedor no soporta streaming.
      const data = (await res.json()) as { choices: Array<{ message: ChatMessage }> };
      const msg = data.choices?.[0]?.message;
      if (!msg) throw new LLMError('Respuesta del modelo sin choices[0].message');
      if (msg.content && cb.onText) cb.onText(msg.content);
      return msg;
    }

    let content = '';
    // tool_calls ensamblados por índice (streaming los trocea)
    const tcIndex = new Map<number, { id: string; name: string; args: string }>();

    const applyDelta = (delta: OpenAIDelta): void => {
      if (typeof delta.content === 'string' && delta.content.length > 0) {
        content += delta.content;
        cb.onText?.(delta.content);
      }
      for (const tc of delta.tool_calls ?? []) {
        const idx = typeof tc.index === 'number' ? tc.index : 0;
        let slot = tcIndex.get(idx);
        if (!slot) {
          slot = { id: tc.id ?? `call_${idx}`, name: '', args: '' };
          tcIndex.set(idx, slot);
        }
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.name += tc.function.name;
        if (tc.function?.arguments) {
          slot.args = (slot.args + tc.function.arguments).slice(0, MAX_TOOL_ARG_CHARS);
          cb.onToolCallDelta?.(idx, slot.name, tc.function.arguments);
        }
      }
    };

    for await (const raw of sseJson(res.body)) {
      const chunk = raw as OpenAIChunk; // forma del protocolo OpenAI; los campos se leen opcionales
      if (chunk.error) throw new LLMError(chunk.error.message ?? 'error de streaming');
      const delta = chunk.choices?.[0]?.delta;
      if (delta) applyDelta(delta);
    }

    const toolCalls: ToolCall[] = [...tcIndex.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => ({
        id: v.id,
        type: 'function' as const,
        function: { name: v.name, arguments: v.args },
      }));

    return {
      role: 'assistant',
      content: content.length > 0 ? content : null,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }
}
