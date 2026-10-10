// Formatos de datos de la UI (puros, sin DOM).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Hora relativa compacta para el carril: "ahora", "12 min", "3 h", "2 d", "8 oct". */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Math.max(0, now - t);
  if (diff < MINUTE) return 'ahora';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} d`;
  return new Date(t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '');
}

/** Duración legible: "0,4 s", "12 s", "2 min 14 s", "1 h 3 min". */
export function duration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 10_000) return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Cronómetro del turno en curso: "0:42", "12:05". */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function splitPath(path: string): { dir: string; base: string } {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i < 0 ? { dir: '', base: path } : { dir: path.slice(0, i + 1), base: path.slice(i + 1) };
}

export type DiffBlock = 'add' | 'del' | 'none';

export const DIFF_BLOCKS = 5;

/**
 * Diffstat en bloques: los bloques llenos crecen con el volumen (1 por línea hasta 5)
 * y se reparten en proporción real añadido/eliminado.
 */
export function diffBlocks(added: number, removed: number): DiffBlock[] {
  const total = added + removed;
  const filled = Math.min(DIFF_BLOCKS, total);
  const addBlocks = total === 0 ? 0 : Math.round((filled * added) / total);
  const blocks: DiffBlock[] = [];
  for (let i = 0; i < DIFF_BLOCKS; i++) {
    blocks.push(i < addBlocks ? 'add' : i < filled ? 'del' : 'none');
  }
  return blocks;
}

/** Nombres de fichero para una línea: "stream.ts", "stream.ts y llm.ts", "stream.ts, llm.ts y 3 más". */
export function fileSummary(paths: string[]): string {
  const names = paths.map((p) => splitPath(p).base);
  if (names.length <= 2) return names.join(' y ');
  return `${names.slice(0, 2).join(', ')} y ${names.length - 2} más`;
}

/** Host del endpoint para mostrarlo ("opencode.ai"); lo que no es URL se muestra tal cual. */
export function endpointHost(baseUrl: string): string {
  return URL.canParse(baseUrl) ? new URL(baseUrl).host : baseUrl;
}

/** Minúsculas y sin tildes: "migración" encuentra "Migracion" y al revés. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
