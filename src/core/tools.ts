import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  readdirSync,
  mkdirSync,
  realpathSync,
} from 'node:fs';
import { join, resolve, relative, dirname, isAbsolute } from 'node:path';
import * as ripgrep from '@vscode/ripgrep';
import type { ToolSpec } from './llm.js';
import type { Skill } from './skills.js';
import type { PermissionMode } from './config.js';

const execFileAsync = promisify(execFile);

export interface TaskItem {
  id: string;
  text: string;
  status: 'pending' | 'in_progress' | 'done';
}

export type ApprovalKind = 'command' | 'write' | 'mcp';

export interface ToolContext {
  workspace: string;
  permissionMode: PermissionMode;
  skills: Skill[];
  tasks: TaskItem[];
  requestApproval: (summary: string, kind: ApprovalKind) => Promise<boolean>;
  onTaskChange: () => void;
  /** Bitácora de cambios de fichero para diff + Undo. */
  recordChange: (path: string, before: string | null, after: string | null) => void;
  /** Herramientas externas (MCP) registradas dinámicamente. */
  extraTools?: ToolDef[];
}

export interface ToolResult {
  output: string;
  isError?: boolean;
}

export interface ToolDef {
  spec: ToolSpec;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

function str(v: unknown, name: string): string {
  if (typeof v !== 'string' || v.length === 0) throw new Error(`Parámetro requerido: ${name}`);
  return v;
}

/**
 * Puerta de permisos en el borde de ejecución.
 * read-only: niega escrituras, comandos y herramientas externas.
 * ask: confirma cada mutación. full: ejecuta sin confirmación (sin aislamiento del SO).
 */
export async function gate(
  ctx: ToolContext,
  kind: ApprovalKind,
  summary: string,
): Promise<ToolResult | null> {
  if (ctx.permissionMode === 'read-only') {
    return {
      output: `Modo de solo lectura: ${kind === 'command' ? 'comando' : kind === 'mcp' ? 'herramienta externa' : 'escritura'} no permitido. Cambia el modo de permisos para continuar.`,
      isError: true,
    };
  }
  if (ctx.permissionMode === 'ask') {
    const ok = await ctx.requestApproval(summary, kind);
    if (!ok) {
      return {
        output: 'El usuario denegó esta operación.',
        isError: true,
      };
    }
  }
  return null;
}

/**
 * Contención canónica: resuelve symlinks del ancestro existente más profundo
 * y exige que la ruta final quede dentro del workspace real.
 */
export function insideWorkspace(ctx: ToolContext, path: string): string {
  const abs = resolve(ctx.workspace, path);
  const wsReal = existsSync(ctx.workspace) ? realpathSync(ctx.workspace) : resolve(ctx.workspace);
  let probe = abs;
  let suffix = '';
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) break;
    suffix = join(relative(parent, probe), suffix);
    probe = parent;
  }
  let real: string;
  try {
    real = resolve(realpathSync(probe), suffix);
  } catch {
    real = abs;
  }
  const rel = relative(wsReal, real);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Ruta fuera del workspace: ${path}`);
  }
  return real;
}

function readText(abs: string, max = 4 * 1024 * 1024): string | null {
  try {
    if (statSync(abs).size > max) return null;
    const text = readFileSync(abs, 'utf8');
    return text.includes('\u0000') ? null : text;
  } catch {
    return null;
  }
}

const runShell: ToolDef = {
  spec: {
    name: 'run_shell',
    description:
      'Ejecuta un comando de PowerShell en el workspace y devuelve stdout/stderr y código de salida. ' +
      'Úsalo para builds, tests, git y cualquier herramienta de línea de comandos.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Comando PowerShell a ejecutar' },
        timeout_seconds: { type: 'number', description: 'Timeout opcional (por defecto 120)' },
      },
      required: ['command'],
    },
  },
  async run(args, ctx) {
    const command = str(args.command, 'command');
    const timeout = Math.min(Number(args.timeout_seconds ?? 120), 600) * 1000;
    const denied = await gate(ctx, 'command', `Comando: ${command}`);
    if (denied) return denied;
    try {
      const { stdout, stderr } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', command],
        { cwd: ctx.workspace, timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      );
      return { output: `exit=0\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}` };
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message: string; killed?: boolean };
      return {
        output: `error: ${err.killed ? 'timeout' : err.message}\n--- stdout ---\n${err.stdout ?? ''}\n--- stderr ---\n${err.stderr ?? ''}`,
        isError: true,
      };
    }
  },
};

const readFile: ToolDef = {
  spec: {
    name: 'read_file',
    description: 'Lee un fichero de texto del workspace (con numeración de líneas).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Ruta relativa al workspace' },
        offset: { type: 'number', description: 'Primera línea (por defecto 1)' },
        limit: { type: 'number', description: 'Máximo de líneas (por defecto 2000)' },
      },
      required: ['path'],
    },
  },
  async run(args, ctx) {
    const abs = insideWorkspace(ctx, str(args.path, 'path'));
    if (!existsSync(abs)) return { output: `No existe: ${args.path}`, isError: true };
    const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
    const offset = Math.max(1, Number(args.offset ?? 1));
    const limit = Math.max(1, Number(args.limit ?? 2000));
    const slice = lines.slice(offset - 1, offset - 1 + limit);
    return { output: slice.map((l, i) => `${offset + i}: ${l}`).join('\n') };
  },
};

const writeFile: ToolDef = {
  spec: {
    name: 'write_file',
    description: 'Crea o sobrescribe un fichero de texto en el workspace (crea directorios).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Ruta relativa al workspace' },
        content: { type: 'string', description: 'Contenido completo del fichero' },
      },
      required: ['path', 'content'],
    },
  },
  async run(args, ctx) {
    const abs = insideWorkspace(ctx, str(args.path, 'path'));
    const content = str(args.content, 'content');
    const denied = await gate(ctx, 'write', `Escribir ${relative(ctx.workspace, abs)} (${content.length} bytes)`);
    if (denied) return denied;
    const before = existsSync(abs) ? readText(abs) : null;
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
    ctx.recordChange(relative(ctx.workspace, abs), before, content);
    return { output: `Escrito ${args.path} (${content.length} bytes)` };
  },
};

const editFile: ToolDef = {
  spec: {
    name: 'edit_file',
    description:
      'Reemplaza texto exacto en un fichero existente. old_text debe aparecer exactamente una vez salvo que replace_all=true.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_text: { type: 'string' },
        new_text: { type: 'string' },
        replace_all: { type: 'boolean' },
      },
      required: ['path', 'old_text', 'new_text'],
    },
  },
  async run(args, ctx) {
    const abs = insideWorkspace(ctx, str(args.path, 'path'));
    if (!existsSync(abs)) return { output: `No existe: ${args.path}`, isError: true };
    const oldText = str(args.old_text, 'old_text');
    const newText = str(args.new_text, 'new_text');
    const content = readFileSync(abs, 'utf8');
    const count = content.split(oldText).length - 1;
    if (count === 0) return { output: 'old_text no encontrado', isError: true };
    if (count > 1 && !args.replace_all) {
      return { output: `old_text aparece ${count} veces; añade contexto o usa replace_all`, isError: true };
    }
    const denied = await gate(ctx, 'write', `Editar ${relative(ctx.workspace, abs)} (${count} reemplazo(s))`);
    if (denied) return denied;
    const updated = args.replace_all ? content.split(oldText).join(newText) : content.replace(oldText, newText);
    writeFileSync(abs, updated, 'utf8');
    ctx.recordChange(relative(ctx.workspace, abs), content, updated);
    return { output: `Editado ${args.path} (${count} reemplazo(s))` };
  },
};

let rgPathCache: string | null | undefined;
function rgPath(): string | null {
  if (rgPathCache !== undefined) return rgPathCache;
  try {
    rgPathCache = existsSync(ripgrep.rgPath) ? ripgrep.rgPath : null;
  } catch {
    rgPathCache = null;
  }
  return rgPathCache;
}

const searchFiles: ToolDef = {
  spec: {
    name: 'search_files',
    description:
      'Busca una expresión regular en los ficheros de texto del workspace y devuelve coincidencias con fichero y línea. Usa ripgrep cuando está disponible.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Expresión regular' },
        path: { type: 'string', description: 'Subcarpeta opcional donde buscar' },
        max_results: { type: 'number', description: 'Máximo de resultados (por defecto 50)' },
      },
      required: ['pattern'],
    },
  },
  async run(args, ctx) {
    const pattern = str(args.pattern, 'pattern');
    const base = args.path ? insideWorkspace(ctx, str(args.path, 'path')) : ctx.workspace;
    const max = Math.max(1, Math.min(Number(args.max_results ?? 50), 500));

    const rg = rgPath();
    if (rg) {
      try {
        const { stdout } = await execFileAsync(
          rg,
          ['--line-number', '--no-heading', '--color', 'never', '--max-count', String(max), '-e', pattern, base],
          { cwd: ctx.workspace, timeout: 30000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
        );
        const lines = stdout.split(/\r?\n/).filter(Boolean).slice(0, max);
        return {
          output:
            lines
              .map((l) => l.replace(base + '\\', '').replace(base + '/', ''))
              .join('\n') || 'Sin coincidencias',
        };
      } catch (e) {
        const err = e as { code?: number; stdout?: string };
        if (err.code === 1) return { output: 'Sin coincidencias' };
        if (err.code !== 2) {
          // error de rg: cae al recorrido en JS
        } else {
          return { output: `rg error: ${(e as Error).message}`, isError: true };
        }
      }
    }

    // Fallback: recorrido recursivo con RegExp.
    const regex = new RegExp(pattern, 'g');
    const results: string[] = [];
    const walk = (dir: string) => {
      if (results.length >= max) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (results.length >= max) return;
        const p = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (['node_modules', '.git', 'dist', 'out'].includes(entry.name)) continue;
          walk(p);
        } else if (statSync(p).size < 2 * 1024 * 1024) {
          const text = readText(p);
          if (text === null) continue;
          const lines = text.split(/\r?\n/);
          for (let i = 0; i < lines.length && results.length < max; i++) {
            regex.lastIndex = 0;
            if (regex.test(lines[i])) {
              results.push(`${relative(ctx.workspace, p)}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
            }
          }
        }
      }
    };
    walk(base);
    return { output: results.length ? results.join('\n') : 'Sin coincidencias' };
  },
};

const listFiles: ToolDef = {
  spec: {
    name: 'list_files',
    description: 'Lista ficheros y carpetas de una ruta del workspace.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Ruta relativa (por defecto .)' } },
      required: [],
    },
  },
  async run(args, ctx) {
    const abs = args.path ? insideWorkspace(ctx, str(args.path, 'path')) : ctx.workspace;
    const entries = readdirSync(abs, { withFileTypes: true }).slice(0, 300);
    return {
      output: entries.map((e) => `${e.isDirectory() ? 'd' : 'f'} ${e.name}`).join('\n'),
    };
  },
};

const manageTasks: ToolDef = {
  spec: {
    name: 'manage_tasks',
    description:
      'Gestiona la lista de tareas del plan de trabajo. actions: add | set_status | list.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'set_status', 'list'] },
        text: { type: 'string', description: 'Texto de la tarea (para add)' },
        id: { type: 'string', description: 'Id de la tarea (para set_status)' },
        status: { type: 'string', enum: ['pending', 'in_progress', 'done'] },
      },
      required: ['action'],
    },
  },
  async run(args, ctx) {
    const action = str(args.action, 'action');
    if (action === 'add') {
      const id = `t${ctx.tasks.length + 1}`;
      ctx.tasks.push({ id, text: str(args.text, 'text'), status: 'pending' });
      ctx.onTaskChange();
      return { output: `Tarea ${id} añadida` };
    }
    if (action === 'set_status') {
      const task = ctx.tasks.find((t) => t.id === str(args.id, 'id'));
      if (!task) return { output: 'Tarea no encontrada', isError: true };
      task.status = str(args.status, 'status') as TaskItem['status'];
      ctx.onTaskChange();
      return { output: `Tarea ${task.id} -> ${task.status}` };
    }
    return {
      output: ctx.tasks.map((t) => `${t.id} [${t.status}] ${t.text}`).join('\n') || 'Sin tareas',
    };
  },
};

const listSkills: ToolDef = {
  spec: {
    name: 'list_skills',
    description: 'Lista las skills disponibles. Carga una con load_skill cuando encaje con la tarea.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  async run(_args, ctx) {
    return {
      output:
        ctx.skills.map((s) => `- ${s.name}: ${s.description}`).join('\n') || 'No hay skills instaladas',
    };
  },
};

const loadSkill: ToolDef = {
  spec: {
    name: 'load_skill',
    description: 'Carga el contenido completo de una skill por nombre.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
  async run(args, ctx) {
    const skill = ctx.skills.find((s) => s.name === str(args.name, 'name'));
    if (!skill) return { output: 'Skill no encontrada', isError: true };
    return { output: `# Skill: ${skill.name}\n\n${skill.content}` };
  },
};

export const TOOLS: ToolDef[] = [
  runShell,
  readFile,
  writeFile,
  editFile,
  searchFiles,
  listFiles,
  manageTasks,
  listSkills,
  loadSkill,
];

export const TOOL_SPECS: ToolSpec[] = TOOLS.map((t) => t.spec);

export async function executeTool(
  name: string,
  argsJson: string,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool =
    TOOLS.find((t) => t.spec.name === name) ??
    ctx.extraTools?.find((t) => t.spec.name === name);
  if (!tool) return { output: `Herramienta desconocida: ${name}`, isError: true };
  let args: Record<string, unknown> = {};
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch {
    return { output: `Argumentos JSON inválidos: ${argsJson.slice(0, 200)}`, isError: true };
  }
  try {
    return await tool.run(args, ctx);
  } catch (e) {
    return { output: `Error en ${name}: ${(e as Error).message}`, isError: true };
  }
}
