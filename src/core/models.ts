// Modelos que ofrece el endpoint (GET /models, igual en los dos protocolos), no una lista fija.
import { authHeaders, LLMError, type ProviderKind } from './llm';

/** Ids de `{ data: [{ id }] }`, sin duplicados y en orden alfabético para poder escanearlos. */
export function parseModelIds(body: unknown): string[] {
  if (typeof body !== 'object' || body === null || !('data' in body) || !Array.isArray(body.data)) {
    throw new LLMError('Respuesta de /models sin la lista "data"');
  }
  const ids = new Set<string>();
  for (const entry of body.data) {
    if (typeof entry === 'object' && entry !== null && 'id' in entry && typeof entry.id === 'string' && entry.id) {
      ids.add(entry.id);
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

export async function fetchModels(kind: ProviderKind, baseUrl: string, apiKey: string): Promise<string[]> {
  const res = await fetch(`${baseUrl}/models`, { headers: authHeaders(kind, apiKey) });
  if (!res.ok) {
    const text = await res.text();
    throw new LLMError(`GET ${baseUrl}/models respondió ${res.status}: ${text.slice(0, 200)}`);
  }
  return parseModelIds(await res.json());
}
