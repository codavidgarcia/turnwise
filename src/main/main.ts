import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
  type IpcMainInvokeEvent,
} from 'electron';
import { join, resolve, basename, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, unlinkSync, statSync } from 'node:fs';
import { structuredPatch } from 'diff';
import { loadConfig, type AppConfig, type PermissionMode, type Effort } from '../core/config';
import type { ProviderKind } from '../core/llm';
import { fetchModels } from '../core/models';
import { createChatModel, normalizeBaseUrl, PROVIDER_KINDS } from '../core/providers';
import { readSettings, writeSettings, SETTINGS_FILE, type SavedSettings } from '../core/settings';
import { Agent, type AgentEvent } from '../core/agent';
import { loadSkills, type Skill } from '../core/skills';
import { type TaskItem, type ToolContext, type ApprovalKind, type ToolResult } from '../core/tools';
import {
  Store,
  type FileChange,
  type Thread,
  type TurnRecord,
  nowIso,
  adoptLegacyStore,
  LEGACY_DATA_DIR,
  LEGACY_STORE_FILE,
  STORE_FILE,
} from '../core/store';
import { McpManager, type McpServerStatus } from '../core/mcp';
import { webSearch, fetchPage, type SearchResult } from '../core/websearch';
import { createWorktree, listWorktrees, launchWindowsSandbox } from '../core/workspace-tools';

const isSmokeTest = process.argv.includes('--smoke-test');

let win: BrowserWindow | null = null;
let config: AppConfig;
let skills: Skill[] = [];
let store: Store;
let settingsPath = '';
/** Problema al arrancar que el usuario debe ver (p. ej. settings.json ilegible). */
let startupWarning: string | null = null;
let modelCache: string[] | null = null;
/** De dónde sale la clave en uso: guardada desde la app (cifrada), del .env o ninguna. */
let apiKeySource: 'settings' | 'env' | 'none' = 'none';
let savedApiKeyEnc: string | undefined;
const mcp = new McpManager();

const pendingApprovals = new Map<string, (approved: boolean) => void>();
let approvalSeq = 0;

/** Un solo run activo; guarda el thread y el estado de su turno. */
let activeRun: { threadId: string; agent: Agent; turnChanges: FileChange[] } | null = null;

/** Generado por `npm run icons`; si falta, Electron usa su icono sin avisar (el smoke lo detecta). */
function appIconPath(): string {
  return join(appRoot(), 'assets', 'icon.ico');
}

function appRoot(): string {
  return app.getAppPath();
}

function hashText(text: string | null): string {
  return text === null ? 'null' : createHash('sha256').update(text, 'utf8').digest('hex');
}

function trustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? '';
  return url.startsWith('file://') && url.includes('index.html');
}

function handle(channel: string, fn: (event: IpcMainInvokeEvent, payload: any) => unknown): void {
  ipcMain.handle(channel, (event, payload) => {
    if (!trustedSender(event)) throw new Error(`Origen no de confianza para ${channel}`);
    return fn(event, payload);
  });
}

function broadcast(evt: Record<string, unknown>): void {
  win?.webContents.send('turnwise:event', evt);
}

/** Cada conversación trabaja en la carpeta de su proyecto, no en la última abierta. */
function workspaceOf(threadId: string): string {
  return store.findProjectOfThread(threadId)?.path ?? config.workspace;
}

function activeWorkspace(): string {
  const active = store.getActive();
  return active ? workspaceOf(active.id) : config.workspace;
}

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

function encryptKey(key: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Este equipo no ofrece cifrado del sistema para guardar la clave. Ponla en OPENAI_API_KEY del .env.');
  }
  return safeStorage.encryptString(key).toString('base64');
}

function applySaved(saved: SavedSettings): void {
  if (saved.provider) config.provider = saved.provider;
  if (saved.baseUrl) config.baseUrl = saved.baseUrl;
  if (saved.model) config.model = saved.model;
  if (saved.effort) config.effort = saved.effort;
  if (saved.permissionMode) config.permissionMode = saved.permissionMode;
  if (saved.workspace) config.workspace = saved.workspace;
  if (saved.searchUrl !== undefined) config.searchUrl = saved.searchUrl;
  if (saved.apiKeyEnc) {
    config.apiKey = safeStorage.decryptString(Buffer.from(saved.apiKeyEnc, 'base64'));
    savedApiKeyEnc = saved.apiKeyEnc;
    apiKeySource = 'settings';
  }
}

interface ProviderDraft {
  provider?: unknown;
  baseUrl?: unknown;
  apiKey?: unknown;
}

/** Valida lo que llega del formulario; una clave vacía significa "conservar la actual". */
function readDraft(p: ProviderDraft | undefined): { provider: ProviderKind; baseUrl: string; apiKey: string } {
  const provider = PROVIDER_KINDS.find((k) => k === p?.provider);
  if (!provider) throw new Error('Elige el protocolo: compatible con OpenAI o con Anthropic.');
  const baseUrl = normalizeBaseUrl(typeof p?.baseUrl === 'string' ? p.baseUrl : '');
  const apiKey = typeof p?.apiKey === 'string' ? p.apiKey.trim() : '';
  return { provider, baseUrl, apiKey };
}

function persistSettings(): void {
  writeSettings(settingsPath, {
    provider: config.provider,
    baseUrl: config.baseUrl,
    apiKeyEnc: savedApiKeyEnc,
    model: config.model,
    effort: config.effort,
    permissionMode: config.permissionMode,
    workspace: config.workspace,
    searchUrl: config.searchUrl,
  });
}

function createAgentContext(threadId: string): ToolContext {
  const thread = store.findThread(threadId);
  return {
    workspace: workspaceOf(threadId),
    permissionMode: thread?.permissionMode ?? config.permissionMode,
    skills,
    tasks: thread ? thread.tasks : [],
    requestApproval: (summary: string, kind: ApprovalKind) =>
      new Promise<boolean>((resolveApproval) => {
        const id = `a${++approvalSeq}`;
        pendingApprovals.set(id, resolveApproval);
        win?.webContents.send('turnwise:approval', { id, summary, kind });
      }),
    onTaskChange: () => {
      const t = store.findThread(threadId);
      broadcast({ type: 'tasks', threadId, tasks: t?.tasks ?? [] });
    },
    recordChange: (path: string, before: string | null, after: string | null) => {
      const change: FileChange = {
        path,
        before,
        after,
        beforeHash: hashText(before),
        afterHash: hashText(after),
        undone: false,
      };
      if (activeRun && activeRun.threadId === threadId) activeRun.turnChanges.push(change);
      broadcast({ type: 'change', threadId, change: { ...change, before: undefined, after: undefined } });
    },
    extraTools: mcp.tools(),
  };
}

interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  model: string;
  turns: number;
}

function threadSummaries(): ThreadSummary[] {
  const out: ThreadSummary[] = [];
  for (const p of store.listProjects()) {
    for (const t of p.threads) {
      out.push({
        id: t.id,
        title: t.title,
        updatedAt: t.updatedAt,
        projectId: p.id,
        projectName: p.name,
        projectPath: p.path,
        model: t.model || config.model,
        turns: t.turns.length,
      });
    }
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

function publicThread(t: Thread) {
  return {
    id: t.id,
    title: t.title,
    model: t.model || config.model,
    effort: t.effort,
    permissionMode: t.permissionMode,
    history: t.history,
    turns: t.turns,
    tasks: t.tasks,
    attachments: t.attachments.map((a) => ({ id: a.id, name: a.name, size: a.size, kind: a.kind })),
  };
}

function registerIpc(): void {
  handle('turnwise:config:get', () => ({
    provider: config.provider,
    baseUrl: config.baseUrl,
    apiKeySource,
    apiKeyHint: config.apiKey.length >= 8 ? config.apiKey.slice(-4) : '',
    model: config.model,
    models: config.models,
    effort: config.effort,
    workspace: config.workspace,
    permissionMode: config.permissionMode,
    searchConfigured: config.searchUrl.length > 0,
    searchUrl: config.searchUrl,
    warning: startupWarning,
  }));

  handle('turnwise:models:list', async () => {
    const configured = [...new Set([config.model, ...config.models])];
    if (!config.apiKey) return { models: configured, error: 'falta la clave API; añádela en Configuración' };
    try {
      modelCache ??= await fetchModels(config.provider, config.baseUrl, config.apiKey);
      return { models: modelCache };
    } catch (e) {
      return { models: configured, error: (e as Error).message };
    }
  });

  handle('turnwise:provider:test', async (_e, p: ProviderDraft) => {
    try {
      const draft = readDraft(p);
      const key = draft.apiKey || config.apiKey;
      if (!key) return { ok: false, error: 'Falta la clave API.' };
      const models = await fetchModels(draft.provider, draft.baseUrl, key);
      return { ok: true, count: models.length };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  handle('turnwise:provider:set', (_e, p: ProviderDraft) => {
    try {
      const draft = readDraft(p);
      if (draft.apiKey) {
        savedApiKeyEnc = encryptKey(draft.apiKey);
        config.apiKey = draft.apiKey;
        apiKeySource = 'settings';
      }
      config.provider = draft.provider;
      config.baseUrl = draft.baseUrl;
      modelCache = null;
      persistSettings();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  handle('turnwise:workspace:pick', async () => {
    if (!win) return { canceled: true };
    const res = await dialog.showOpenDialog(win, {
      title: 'Abrir carpeta',
      defaultPath: activeWorkspace(),
      properties: ['openDirectory'],
    });
    const path = res.filePaths[0];
    return res.canceled || !path ? { canceled: true } : { path };
  });

  handle(
    'turnwise:config:set',
    (
      _e,
      p: {
        model?: string;
        effort?: Effort;
        permissionMode?: PermissionMode;
        searchUrl?: string;
      },
    ) => {
      if (p.model && typeof p.model === 'string') config.model = p.model;
      if (p.effort && ['low', 'medium', 'high'].includes(p.effort)) config.effort = p.effort;
      if (p.permissionMode && ['read-only', 'ask', 'full'].includes(p.permissionMode)) {
        config.permissionMode = p.permissionMode;
      }
      if (typeof p.searchUrl === 'string') config.searchUrl = p.searchUrl.replace(/\/$/, '');
      persistSettings();
      return { ok: true };
    },
  );

  handle('turnwise:window:titlebar', (_e, p: { color?: unknown; symbolColor?: unknown }) => {
    const { color, symbolColor } = p ?? {};
    if (typeof color !== 'string' || typeof symbolColor !== 'string' || !CSS_HEX.test(color) || !CSS_HEX.test(symbolColor)) {
      return { ok: false, error: 'Colores de barra no válidos: se esperan #rrggbb' };
    }
    win?.setTitleBarOverlay({ color, symbolColor, height: TITLEBAR_HEIGHT });
    return { ok: true };
  });

  handle('turnwise:threads:list', () => threadSummaries());

  handle('turnwise:threads:create', (_e, p: { workspace?: string }) => {
    const path = p?.workspace ? resolve(p.workspace) : config.workspace;
    if (!isDirectory(path)) return { error: `La carpeta ${path} no existe o no es una carpeta.` };
    // La última carpeta abierta es la de partida la próxima vez.
    if (path !== config.workspace) {
      config.workspace = path;
      persistSettings();
    }
    const project = store.ensureProject(path, basename(path));
    const thread = store.createThread(project.id, {
      model: config.model,
      effort: config.effort,
      permissionMode: config.permissionMode,
    });
    return thread ? publicThread(thread) : { error: 'Proyecto no encontrado' };
  });

  handle('turnwise:threads:get', (_e, threadId: string) => {
    const t = store.findThread(threadId);
    return t ? publicThread(t) : { error: 'Conversación no encontrada' };
  });

  handle('turnwise:threads:delete', (_e, threadId: string) => {
    if (activeRun?.threadId === threadId) return { ok: false, error: 'Hay una tarea en curso' };
    return { ok: store.deleteThread(threadId) };
  });

  handle('turnwise:threads:rename', (_e, p: { threadId: string; title: string }) => {
    store.updateThread(p.threadId, (t) => {
      t.title = String(p.title).slice(0, 120) || t.title;
    });
    return { ok: true };
  });

  handle('turnwise:threads:settings', (_e, p: { threadId: string; model?: string; effort?: Effort; permissionMode?: PermissionMode }) => {
    store.updateThread(p.threadId, (t) => {
      if (p.model) t.model = p.model;
      if (p.effort) t.effort = p.effort;
      if (p.permissionMode) t.permissionMode = p.permissionMode;
    });
    return { ok: true };
  });

  handle('turnwise:agent:send', async (_e, p: { threadId: string; text: string; attachmentIds?: string[] }) => {
    const text = String(p?.text ?? '').trim();
    if (!text) return { ok: false, error: 'Mensaje vacío' };
    if (activeRun) return { ok: false, error: 'Ya hay una tarea en curso' };
    const thread = store.findThread(p.threadId);
    if (!thread) return { ok: false, error: 'Conversación no encontrada' };

    // Adjuntos de texto se inyectan como contexto no fiable.
    let fullText = text;
    for (const att of thread.attachments) {
      if (p.attachmentIds?.includes(att.id)) {
        const attText = store.attachmentText(att);
        if (attText) {
          fullText += `\n\n--- Adjunto: ${att.name} (contenido no fiable) ---\n${attText}\n--- fin adjunto ---`;
        }
      }
    }

    store.updateThread(thread.id, (t) => {
      if (t.title === 'Nueva conversación') t.title = text.slice(0, 60);
    });

    const llm = createChatModel(
      config.provider,
      { baseUrl: config.baseUrl, apiKey: config.apiKey, model: thread.model || config.model },
      `turnwise-${thread.id}`,
    );
    const agent = new Agent(
      llm,
      createAgentContext(thread.id),
      { maxSteps: config.maxSteps, effort: thread.effort },
      thread.history,
    );
    const turnChanges: FileChange[] = [];
    activeRun = { threadId: thread.id, agent, turnChanges };
    const startedAt = nowIso();

    void agent
      .run(fullText, (evt: AgentEvent) => broadcast({ ...evt, threadId: thread.id }))
      .then(() => {
        const history = agent.getHistory();
        store.updateThread(thread.id, (t) => {
          t.history = history;
          const turn: TurnRecord = {
            index: t.turns.length + 1,
            userText: text,
            startedAt,
            finishedAt: nowIso(),
            summary: '',
            changes: turnChanges,
          };
          t.turns.push(turn);
        });
      })
      .finally(() => {
        if (activeRun?.threadId === thread.id) activeRun = null;
      });
    return { ok: true };
  });

  handle('turnwise:agent:cancel', () => {
    activeRun?.agent.cancel();
    return { ok: true };
  });

  handle('turnwise:approval:respond', (_e, p: { id: string; approved: boolean }) => {
    const resolveApproval = pendingApprovals.get(p.id);
    if (resolveApproval) {
      pendingApprovals.delete(p.id);
      resolveApproval(!!p.approved);
    }
    return { ok: true };
  });

  // ---- Cambios y Undo ----
  handle('turnwise:changes:list', (_e, threadId: string) => {
    const t = store.findThread(threadId);
    return (t?.turns ?? []).flatMap((turn) =>
      turn.changes.map((c) => {
        const patch = structuredPatch('a', 'b', c.before ?? '', c.after ?? '', '', '', { context: 0 });
        let added = 0;
        let removed = 0;
        for (const h of patch.hunks) {
          for (const l of h.lines) {
            if (l.startsWith('+')) added++;
            else if (l.startsWith('-')) removed++;
          }
        }
        return {
          turnIndex: turn.index,
          path: c.path,
          beforeHash: c.beforeHash,
          afterHash: c.afterHash,
          undone: c.undone,
          created: c.before === null,
          added,
          removed,
        };
      }),
    );
  });

  handle(
    'turnwise:changes:diff',
    (_e, p: { threadId: string; turnIndex: number; path: string }) => {
      const t = store.findThread(p.threadId);
      const turn = t?.turns.find((x) => x.index === p.turnIndex);
      const change = turn?.changes.find((c) => c.path === p.path);
      if (!change) return { error: 'Cambio no encontrado' };
      const patch = structuredPatch(
        change.path,
        change.path,
        change.before ?? '',
        change.after ?? '',
        '',
        '',
        { context: 3 },
      );
      return {
        path: change.path,
        created: change.before === null,
        hunks: patch.hunks.map((h) => ({
          oldStart: h.oldStart,
          newStart: h.newStart,
          lines: h.lines,
        })),
      };
    },
  );

  handle(
    'turnwise:changes:undo',
    (_e, p: { threadId: string; turnIndex: number; path: string }) => {
      const t = store.findThread(p.threadId);
      const turn = t?.turns.find((x) => x.index === p.turnIndex);
      const change = turn?.changes.find((c) => c.path === p.path);
      if (!change) return { ok: false, error: 'Cambio no encontrado' };
      if (change.undone) return { ok: false, error: 'Ya estaba deshecho' };
      const abs = resolve(workspaceOf(p.threadId), change.path);
      const current = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
      // Compare-and-swap: si el fichero cambió después, no se pisa.
      if (hashText(current) !== change.afterHash) {
        return {
          ok: false,
          error: 'El fichero ha cambiado después de este turno; Deshacer lo sobrescribiría. Revisa el diff a mano.',
        };
      }
      if (change.before === null) {
        if (existsSync(abs)) unlinkSync(abs);
      } else {
        writeFileSync(abs, change.before, 'utf8');
      }
      store.updateThread(p.threadId, () => {
        change.undone = true;
      });
      broadcast({ type: 'change-undone', threadId: p.threadId, path: change.path, turnIndex: p.turnIndex });
      return { ok: true };
    },
  );

  // ---- Adjuntos ----
  handle('turnwise:attachments:add', async (_e, threadId: string) => {
    const res = await dialog.showOpenDialog(win!, {
      title: 'Adjuntar fichero',
      properties: ['openFile'],
      filters: [
        { name: 'Texto y código', extensions: ['txt', 'md', 'ts', 'js', 'json', 'csv', 'log', 'html', 'css', 'py', 'rs', 'go', 'java', 'c', 'h', 'cpp'] },
        { name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
        { name: 'Todos', extensions: ['*'] },
      ],
    });
    if (res.canceled || res.filePaths.length === 0) return { ok: false };
    const stored = store.storeAttachment(threadId, res.filePaths[0]);
    return stored
      ? { ok: true, attachment: { id: stored.id, name: stored.name, size: stored.size, kind: stored.kind } }
      : { ok: false, error: 'No se pudo copiar el fichero' };
  });

  // ---- Skills / tareas ----
  handle('turnwise:skills:list', () =>
    skills.map((s) => ({ name: s.name, description: s.description })),
  );
  handle('turnwise:tasks:list', (_e, threadId: string) => store.findThread(threadId)?.tasks ?? []);

  // ---- MCP ----
  handle('turnwise:mcp:status', (): McpServerStatus[] => mcp.statuses());
  handle('turnwise:mcp:connect', async (_e, server: AppConfig['mcpServers'][number]) => {
    const status = await mcp.connect(server);
    broadcast({ type: 'mcp-status', statuses: mcp.statuses() });
    return status;
  });
  handle('turnwise:mcp:disconnect', async (_e, name: string) => {
    await mcp.disconnect(name);
    broadcast({ type: 'mcp-status', statuses: mcp.statuses() });
    return { ok: true };
  });

  // ---- Web ----
  handle('turnwise:web:search', async (_e, query: string): Promise<SearchResult[]> => {
    return webSearch(config.searchUrl, String(query ?? '').slice(0, 300));
  });
  handle('turnwise:web:fetch', async (_e, url: string) => {
    try {
      return { ok: true, text: await fetchPage(String(url)) };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  // ---- Worktrees y sandbox ----
  handle('turnwise:worktree:create', async (_e, branch: string) => {
    try {
      return { ok: true, ...(await createWorktree(activeWorkspace(), String(branch))) };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
  handle('turnwise:worktree:list', async () => listWorktrees(activeWorkspace()));
  handle('turnwise:sandbox:launch', async () => launchWindowsSandbox(activeWorkspace()));
}

/** Altura de la barra de la app; el renderer la lee como env(titlebar-area-height). */
const TITLEBAR_HEIGHT = 48;
/** Colores que acepta la barra: los tokens del renderer llegan como hex. */
const CSS_HEX = /^#[0-9a-fA-F]{6}$/;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Turnwise',
    icon: appIconPath(),
    // Lienzo claro hasta que el renderer pinta; luego manda los colores de su tema.
    backgroundColor: '#f5f6f7',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#f5f6f7', symbolColor: '#56626b', height: TITLEBAR_HEIGHT },
    webPreferences: {
      preload: join(appRoot(), 'dist/preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void win.loadFile(join(appRoot(), 'dist/renderer/index.html'));
  win.on('closed', () => {
    win = null;
  });
}

const SMOKE_RENDER_DEADLINE_MS = 10_000;
const SMOKE_POLL_MS = 200;
/** 'ok' si los controles de Windows van superpuestos y la barra de la app les deja su hueco. */
const TITLEBAR_PROBE = `(() => {
  const o = navigator.windowControlsOverlay;
  if (!o || !o.visible) return 'sin-overlay';
  const r = o.getTitlebarAreaRect();
  const controls = window.innerWidth - r.x - r.width;
  const pad = parseFloat(getComputedStyle(document.querySelector('.topbar')).paddingRight);
  return controls > 0 && pad >= controls ? 'ok' : 'solapa:' + Math.round(pad) + '<' + Math.round(controls);
})()`;
/** Verdadero si alguna fuente de la página cargó y ninguna falló (CSP o fichero ausente). */
const FONT_PROBE =
  "document.fonts.ready.then(() => { const f = [...document.fonts]; return f.some((x) => x.status === 'loaded') && !f.some((x) => x.status === 'error'); })";

/**
 * Smoke real: el renderer debe pintar la bitácora (vacío o turnos) con el preload
 * y la CSP de producción, sin errores de consola. Sale con código 1 si no.
 */
function runSmokeTest(w: BrowserWindow): void {
  const errors: string[] = [];
  w.webContents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(details.message);
  });
  w.webContents.once('did-finish-load', async () => {
    const deadline = Date.now() + SMOKE_RENDER_DEADLINE_MS;
    let rendered = false;
    while (!rendered && Date.now() < deadline) {
      rendered = (await w.webContents.executeJavaScript("!!document.querySelector('#log .empty, #log .turn')")) === true;
      if (!rendered) await new Promise((r) => setTimeout(r, SMOKE_POLL_MS));
    }
    const hasIcon = existsSync(appIconPath());
    const fonts = (await w.webContents.executeJavaScript(FONT_PROBE)) === true;
    const titlebar = String(await w.webContents.executeJavaScript(TITLEBAR_PROBE));
    const summary = `skills=${skills.length} projects=${store.listProjects().length} icon=${hasIcon} fonts=${fonts} titlebar=${titlebar}`;
    if (rendered && hasIcon && fonts && titlebar === 'ok' && errors.length === 0) {
      console.log(`SMOKE_OK renderer-painted ${summary}`);
    } else {
      console.log(`SMOKE_FAIL rendered=${rendered} ${summary}`);
      for (const e of errors) console.log(`  console.error: ${e}`);
      process.exitCode = 1;
    }
    app.quit();
  });
}

void app.whenReady().then(() => {
  config = loadConfig(appRoot());
  config.workspace = resolve(appRoot(), '..');
  const userData = app.getPath('userData');
  settingsPath = join(userData, SETTINGS_FILE);
  apiKeySource = config.apiKey ? 'env' : 'none';
  try {
    applySaved(readSettings(settingsPath));
  } catch (e) {
    startupWarning = `Ajustes guardados no aplicados: ${(e as Error).message}`;
  }
  if (process.env.TURNWISE_WORKSPACE) config.workspace = resolve(process.env.TURNWISE_WORKSPACE);
  if (!isDirectory(config.workspace)) config.workspace = resolve(appRoot(), '..');
  skills = loadSkills(join(appRoot(), 'skills'));
  const storePath = join(userData, STORE_FILE);
  const legacyPath = join(dirname(userData), LEGACY_DATA_DIR, LEGACY_STORE_FILE);
  if (adoptLegacyStore(legacyPath, storePath)) console.log(`Store adoptado desde ${legacyPath}`);
  store = new Store(storePath);
  registerIpc();
  createWindow();

  if (isSmokeTest && win) runSmokeTest(win);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
