// Búsqueda web (endpoint tipo SearXNG configurable) y lectura segura de URLs.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const MAX_PAGE_CHARS = 15000;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;

function isPrivateIp(ip: string): boolean {
  if (ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  if (ip.startsWith('169.254.')) return true;
  const m = ip.match(/^172\.(\d+)\./);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return true;
  }
  if (ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return true;
  return false;
}

/** Solo HTTPS público: bloquea loopback, RFC1918 y red interna (SSRF). */
export async function assertPublicHttps(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`URL inválida: ${rawUrl}`);
  }
  if (url.protocol !== 'https:') throw new Error('Solo se permiten URLs https');
  const host = url.hostname;
  if (host === 'localhost' || host.endsWith('.local')) throw new Error('Host no permitido');
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error('IP privada no permitida');
  } else {
    const addrs = await lookup(host, { all: true });
    for (const a of addrs) {
      if (isPrivateIp(a.address)) throw new Error('Host resuelve a IP privada');
    }
  }
  return url;
}

export async function webSearch(searchUrl: string, query: string, max = 6): Promise<SearchResult[]> {
  if (!searchUrl) {
    throw new Error(
      'Búsqueda web no configurada. Define TURNWISE_SEARCH_URL (endpoint compatible con SearXNG, p. ej. https://searx.example/search) en la configuración.',
    );
  }
  const url = new URL(searchUrl);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  const res = await fetch(url, {
    headers: { 'user-agent': 'turnwise/0.2.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Búsqueda HTTP ${res.status}`);
  const data = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  return (data.results ?? [])
    .filter((r) => typeof r.url === 'string')
    .slice(0, max)
    .map((r) => ({
      title: r.title ?? '(sin título)',
      url: r.url as string,
      snippet: (r.content ?? '').slice(0, 300),
    }));
}

export async function fetchPage(rawUrl: string): Promise<string> {
  const url = await assertPublicHttps(rawUrl);
  const res = await fetch(url, {
    headers: { 'user-agent': 'turnwise/0.2.0' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} al leer ${url.hostname}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_PAGE_BYTES) throw new Error('Página demasiado grande');
  let html = new TextDecoder('utf-8').decode(buf);
  // Conversión simple HTML -> texto (sin dependencias de render).
  html = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return html.slice(0, MAX_PAGE_CHARS);
}
