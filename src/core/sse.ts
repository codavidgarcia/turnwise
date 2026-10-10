// Lector Server-Sent Events compartido por los dos protocolos: entrega el JSON de cada
// línea `data:`. UTF-8 partido entre chunks de red se recompone con TextDecoder en modo stream.

export async function* sseJson(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const decoder = new TextDecoder('utf-8');
  const reader = body.getReader();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        // Una línea `data:` completa que no es JSON es un fallo del servidor, no un chunk a medias.
        throw new Error(`El endpoint envió un evento SSE que no es JSON: ${payload.slice(0, 120)}`);
      }
      yield parsed;
    }
  }
}
