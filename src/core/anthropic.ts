// Cliente compatible con la Messages API de Anthropic. El agente sigue hablando en la
// forma OpenAI (ChatMessage); aquí se traduce a bloques en la ida y de vuelta.
import { sseJson } from './sse';
import {
  authHeaders,
  clientHeaders,
  httpError,
  newSessionId,
  LLMError,
  MAX_TOOL_ARG_CHARS,
  type ChatMessage,
  type ChatModel,
  type LLMConfig,
  type StreamCallbacks,
  type ToolCall,
  type ToolSpec,
} from './llm';

/** La Messages API exige max_tokens; 16k deja escribir un fichero entero en una llamada. */
const MAX_OUTPUT_TOKENS = 16384;

export type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicBlock[];
}

export interface AnthropicRequest {
  system?: string;
  messages: AnthropicMessage[];
  tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
}

/** Argumentos que el modelo dejó mal formados se reenvían tal cual, no se descartan. */
function toolInput(args: string): unknown {
  if (!args.trim()) return {};
  try {
    return JSON.parse(args);
  } catch {
    return { raw: args };
  }
}

/**
 * ChatMessage[] → Messages API: el system va aparte, los resultados de herramienta son
 * bloques del usuario y los turnos consecutivos del mismo rol se funden (la API exige alternancia).
 */
export function toAnthropicRequest(messages: ChatMessage[], tools: ToolSpec[]): AnthropicRequest {
  const system: string[] = [];
  const out: AnthropicMessage[] = [];
  const push = (role: AnthropicMessage['role'], blocks: AnthropicBlock[]): void => {
    if (blocks.length === 0) return;
    const last = out.at(-1);
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const m of messages) {
    if (m.role === 'system') {
      if (m.content) system.push(m.content);
    } else if (m.role === 'tool') {
      push('user', [{ type: 'tool_result', tool_use_id: m.tool_call_id ?? '', content: m.content ?? '' }]);
    } else if (m.role === 'assistant') {
      const blocks: AnthropicBlock[] = m.content ? [{ type: 'text', text: m.content }] : [];
      for (const c of m.tool_calls ?? []) {
        blocks.push({ type: 'tool_use', id: c.id, name: c.function.name, input: toolInput(c.function.arguments) });
      }
      push('assistant', blocks);
    } else if (m.content) {
      push('user', [{ type: 'text', text: m.content }]);
    }
  }
  const req: AnthropicRequest = { messages: out };
  if (system.length > 0) req.system = system.join('\n\n');
  if (tools.length > 0) {
    req.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  }
  return req;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Bloques de una respuesta completa → ChatMessage. Los bloques de razonamiento se omiten. */
export function fromAnthropicContent(content: unknown): ChatMessage {
  if (!Array.isArray(content)) throw new LLMError('Respuesta de /messages sin "content"');
  let text = '';
  const calls: ToolCall[] = [];
  for (const b of content) {
    if (!isRecord(b)) continue;
    if (b.type === 'text') text += str(b.text);
    if (b.type === 'tool_use') {
      calls.push({ id: str(b.id), type: 'function', function: { name: str(b.name), arguments: JSON.stringify(b.input ?? {}) } });
    }
  }
  return { role: 'assistant', content: text || null, tool_calls: calls.length > 0 ? calls : undefined };
}

/** Ensambla los eventos de streaming de la Messages API en un ChatMessage. */
export class AnthropicStream {
  private text = '';
  private readonly tools = new Map<number, { ordinal: number; id: string; name: string; args: string }>();

  constructor(private readonly cb: StreamCallbacks = {}) {}

  push(event: unknown): void {
    if (!isRecord(event)) return;
    if (event.type === 'error') {
      const msg = isRecord(event.error) ? str(event.error.message) : '';
      throw new LLMError(msg || 'error de streaming');
    }
    const index = typeof event.index === 'number' ? event.index : -1;
    if (event.type === 'content_block_start' && isRecord(event.content_block) && event.content_block.type === 'tool_use') {
      const b = event.content_block;
      this.tools.set(index, { ordinal: this.tools.size, id: str(b.id), name: str(b.name), args: '' });
      return;
    }
    if (event.type !== 'content_block_delta' || !isRecord(event.delta)) return;
    const d = event.delta;
    if (d.type === 'text_delta') {
      const t = str(d.text);
      if (!t) return;
      this.text += t;
      this.cb.onText?.(t);
    } else if (d.type === 'input_json_delta') {
      const slot = this.tools.get(index);
      const part = str(d.partial_json);
      if (!slot || !part) return;
      slot.args = (slot.args + part).slice(0, MAX_TOOL_ARG_CHARS);
      this.cb.onToolCallDelta?.(slot.ordinal, slot.name, part);
    }
  }

  result(): ChatMessage {
    const calls: ToolCall[] = [...this.tools.values()]
      .sort((a, b) => a.ordinal - b.ordinal)
      // Una herramienta sin argumentos no emite input_json_delta: su entrada es {}.
      .map((t) => ({ id: t.id, type: 'function' as const, function: { name: t.name, arguments: t.args || '{}' } }));
    return { role: 'assistant', content: this.text || null, tool_calls: calls.length > 0 ? calls : undefined };
  }
}

export class AnthropicClient implements ChatModel {
  private readonly sessionId: string;

  constructor(
    private readonly cfg: LLMConfig,
    sessionId?: string,
  ) {
    this.sessionId = sessionId ?? newSessionId();
  }

  private request(messages: ChatMessage[], tools: ToolSpec[], stream: boolean, signal?: AbortSignal): Promise<Response> {
    const body = { model: this.cfg.model, max_tokens: MAX_OUTPUT_TOKENS, stream, ...toAnthropicRequest(messages, tools) };
    return fetch(`${this.cfg.baseUrl}/messages`, {
      method: 'POST',
      headers: { ...clientHeaders(this.sessionId), ...authHeaders('anthropic', this.cfg.apiKey) },
      body: JSON.stringify(body),
      signal,
    });
  }

  async chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<ChatMessage> {
    const res = await this.request(messages, tools, false);
    if (!res.ok) throw await httpError(res);
    const data: unknown = await res.json();
    return fromAnthropicContent(isRecord(data) ? data.content : undefined);
  }

  async chatStream(messages: ChatMessage[], tools: ToolSpec[], cb: StreamCallbacks = {}): Promise<ChatMessage> {
    const res = await this.request(messages, tools, true, cb.signal);
    if (!res.ok) throw await httpError(res);
    const ctype = res.headers.get('content-type') ?? '';
    if (!ctype.includes('text/event-stream') || !res.body) {
      const data: unknown = await res.json();
      const msg = fromAnthropicContent(isRecord(data) ? data.content : undefined);
      if (msg.content) cb.onText?.(msg.content);
      return msg;
    }
    const stream = new AnthropicStream(cb);
    for await (const event of sseJson(res.body)) stream.push(event);
    return stream.result();
  }
}
