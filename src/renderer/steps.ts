// Traduce llamadas a herramientas del agente a pasos legibles en español.
// Puro (sin DOM): lo usan la bitácora y el selftest.

export type StepKind = 'read' | 'search' | 'edit' | 'run' | 'plan' | 'skill' | 'mcp' | 'other';

export interface StepDescription {
  kind: StepKind;
  /** Verbo en pasado, para pasos terminados ("Leyó"). */
  verb: string;
  /** Verbo en gerundio, para el paso en curso ("Leyendo"). */
  verbLive: string;
  /** Objeto del paso: ruta, comando o patrón. Vacío si no aplica. */
  target: string;
  /** El objeto es código (ruta/comando) y va en monoespaciada. */
  targetIsCode: boolean;
}

type Args = Record<string, unknown>;

function isArgs(value: unknown): value is Args {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseArgs(raw: string): Args | null {
  if (!raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isArgs(parsed) ? parsed : null;
  } catch {
    // Argumentos no-JSON del modelo: se muestran crudos como objeto del paso.
    return null;
  }
}

function str(args: Args, key: string): string {
  const v = args[key];
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

function firstLine(text: string): string {
  return text.split(/\r?\n/)[0] ?? '';
}

function lineRange(args: Args): string {
  const offset = Number(args.offset);
  const limit = Number(args.limit);
  if (!Number.isFinite(offset) || offset <= 1) return '';
  return Number.isFinite(limit) && limit > 0 ? `:${offset}–${offset + limit - 1}` : `:${offset}`;
}

const TASK_VERBS: Record<string, [string, string]> = {
  add: ['Añadió al plan', 'Añadiendo al plan'],
  set_status: ['Actualizó el plan', 'Actualizando el plan'],
  list: ['Consultó el plan', 'Consultando el plan'],
};

export function describeStep(name: string, rawArgs: string): StepDescription {
  const args = parseArgs(rawArgs);
  if (args === null) {
    return { kind: 'other', verb: name, verbLive: name, target: rawArgs, targetIsCode: true };
  }
  switch (name) {
    case 'read_file':
      return { kind: 'read', verb: 'Leyó', verbLive: 'Leyendo', target: str(args, 'path') + lineRange(args), targetIsCode: true };
    case 'list_files':
      return { kind: 'search', verb: 'Listó', verbLive: 'Listando', target: str(args, 'path') || '.', targetIsCode: true };
    case 'search_files': {
      const where = str(args, 'path');
      const target = where ? `${str(args, 'pattern')}  en ${where}` : str(args, 'pattern');
      return { kind: 'search', verb: 'Buscó', verbLive: 'Buscando', target, targetIsCode: true };
    }
    case 'write_file':
      return { kind: 'edit', verb: 'Escribió', verbLive: 'Escribiendo', target: str(args, 'path'), targetIsCode: true };
    case 'edit_file':
      return { kind: 'edit', verb: 'Editó', verbLive: 'Editando', target: str(args, 'path'), targetIsCode: true };
    case 'run_shell':
      return { kind: 'run', verb: 'Ejecutó', verbLive: 'Ejecutando', target: firstLine(str(args, 'command')), targetIsCode: true };
    case 'manage_tasks': {
      const [verb, verbLive] = TASK_VERBS[str(args, 'action')] ?? TASK_VERBS.list;
      return { kind: 'plan', verb, verbLive, target: str(args, 'text'), targetIsCode: false };
    }
    case 'list_skills':
      return { kind: 'skill', verb: 'Consultó las skills', verbLive: 'Consultando las skills', target: '', targetIsCode: false };
    case 'load_skill':
      return { kind: 'skill', verb: 'Cargó la skill', verbLive: 'Cargando la skill', target: str(args, 'name'), targetIsCode: true };
    default:
      if (name.startsWith('mcp_')) {
        return { kind: 'mcp', verb: 'Llamó a', verbLive: 'Llamando a', target: name.slice(4), targetIsCode: true };
      }
      return { kind: 'other', verb: name, verbLive: name, target: '', targetIsCode: false };
  }
}

const GROUP_PHRASES: Record<StepKind, (n: number) => string> = {
  read: (n) => (n === 1 ? 'leyó 1 archivo' : `leyó ${n} archivos`),
  search: (n) => (n === 1 ? 'hizo 1 búsqueda' : `hizo ${n} búsquedas`),
  edit: (n) => (n === 1 ? 'editó 1 archivo' : `editó ${n} archivos`),
  run: (n) => (n === 1 ? 'ejecutó 1 comando' : `ejecutó ${n} comandos`),
  plan: () => 'actualizó el plan',
  skill: (n) => (n === 1 ? 'cargó 1 skill' : `cargó ${n} skills`),
  mcp: (n) => (n === 1 ? 'usó 1 herramienta externa' : `usó ${n} herramientas externas`),
  other: (n) => (n === 1 ? '1 acción' : `${n} acciones`),
};

const GROUP_ORDER: StepKind[] = ['read', 'search', 'edit', 'run', 'plan', 'skill', 'mcp', 'other'];

/** Resumen de un bloque de pasos: "Leyó 2 archivos · editó 1 archivo". */
export function summarizeSteps(kinds: StepKind[]): string {
  const counts = new Map<StepKind, number>();
  for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1);
  const text = GROUP_ORDER.filter((k) => counts.has(k))
    .map((k) => GROUP_PHRASES[k](counts.get(k) ?? 0))
    .join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
