// Renderer de Turnwise: estado de la sesión y enrutado de eventos del agente
// hacia la bitácora, el panel de revisión, el carril y el composer.
import './types';
import { byId, el } from './dom';
import { clock, diffBlocks, duration, endpointHost } from './format';
import { Transcript } from './transcript';
import { Inspector } from './inspector';
import { Composer } from './composer';
import { renderSidebar } from './sidebar';
import { SettingsDialog, type SettingsOutcome } from './settings';
import type { AgentEvent, ApprovalRequest, ChatMessage, ConfigInfo, FileChangeSummary, ThreadInfo, ThreadSummary } from './types';

const api = window.turnwise;
const COMPACT_RAIL = '(max-width: 820px)';
const COMPACT_REVIEW = '(max-width: 1180px)';
const COMPACTION_PREFIX = '[Contexto compactado';
const ATTACHMENT_MARK = /\n+--- Adjunto:[\s\S]*$/;

const shell = byId('shell', HTMLElement);
const titleEl = byId('thread-title', HTMLElement);
const crumbProject = byId('crumb-project', HTMLElement);
const runStatus = byId('run-status', HTMLElement);
const runLabel = byId('run-label', HTMLElement);
const runClock = byId('run-clock', HTMLElement);
const contextPath = byId('context-path', HTMLElement);
const contextDiff = byId('context-diff', HTMLButtonElement);
const dlgSettings = byId('dlg-settings', HTMLDialogElement);

let cfg: ConfigInfo | null = null;
let threads: ThreadSummary[] = [];
let thread: ThreadInfo | null = null;
let pendingAttachmentIds: string[] = [];
let run: { threadId: string; turnIndex: number; startedAt: number; stopRequested: boolean; failed: boolean; timer: number } | null = null;

/** Estado del turno en la barra superior: en vivo mientras corre, y cómo terminó después. */
type RunState = 'running' | 'waiting' | 'done' | 'stopped' | 'failed';
const RUN_LABELS: Record<RunState, string> = {
  running: 'Trabajando',
  waiting: 'Esperando permiso',
  done: 'Hecho',
  stopped: 'Detenido',
  failed: 'Falló',
};

const transcript = new Transcript(
  byId('log', HTMLElement),
  {
    review: (turnIndex) => void inspector.loadChanges(turnIndex),
    undoTurn: (turnIndex, paths) => undo(turnIndex, paths),
  },
  (id, approved) => {
    void api.respond(id, approved);
    showRunState('running');
  },
);

const inspector = new Inspector({
  api,
  shell,
  threadId: () => thread?.id ?? null,
  undo: (turnIndex, paths) => undo(turnIndex, paths),
});

const composer = new Composer({
  send: (text) => void send(text),
  stop: () => {
    if (run) run.stopRequested = true;
    void api.cancel();
  },
  attach: () => void attach(),
  removeAttachment: (id) => {
    pendingAttachmentIds = pendingAttachmentIds.filter((x) => x !== id);
    syncAttachments();
  },
  setModel: (model) => saveSetting({ model }),
  setEffort: (effort) => saveSetting({ effort }),
  setPermission: (permissionMode) => saveSetting({ permissionMode }),
  configureEndpoint: () => openSettings('endpoint'),
});

const settings = new SettingsDialog(api, (outcome) => void afterSettings(outcome));

// ---------- Carril y cabecera ----------

const threadSearch = byId('thread-search', HTMLInputElement);

async function refreshRail(): Promise<void> {
  threads = await api.threadsList();
  paintRail();
}

function paintRail(): void {
  renderSidebar(
    byId('threads', HTMLElement),
    threads,
    { activeId: thread?.id ?? null, runningId: run?.threadId ?? null, query: threadSearch.value },
    (id) => void openThread(id),
    (path) => void newThread(path),
  );
}

function summaryOf(threadId: string): ThreadSummary | undefined {
  return threads.find((t) => t.id === threadId);
}

function syncHeader(): void {
  const summary = thread ? summaryOf(thread.id) : undefined;
  titleEl.textContent = thread?.title ?? 'Turnwise';
  crumbProject.textContent = summary?.projectName ?? '';
  contextPath.textContent = summary?.projectPath ?? cfg?.workspace ?? '';
  contextPath.title = contextPath.textContent;
}

/** Franja del dock: diffstat vivo de la conversación; desaparece si no hay cambios. */
function syncContextDiff(changes: FileChangeSummary[]): void {
  const live = changes.filter((c) => !c.undone);
  const added = live.reduce((n, c) => n + c.added, 0);
  const removed = live.reduce((n, c) => n + c.removed, 0);
  contextDiff.hidden = live.length === 0;
  byId('context-add', HTMLElement).textContent = `+${added}`;
  byId('context-del', HTMLElement).textContent = `−${removed}`;
  byId('context-blocks', HTMLElement).replaceChildren(
    ...diffBlocks(added, removed).map((k) => el('span', `block block-${k}`)),
  );
}

// ---------- Conversaciones ----------

async function openThread(threadId: string): Promise<void> {
  const t = await api.threadsGet(threadId);
  if (t.error || !t.id) {
    transcript.addNote(t.error ?? 'No se pudo abrir la conversación.', 'error');
    return;
  }
  thread = t;
  pendingAttachmentIds = [];
  syncAttachments();
  composer.setSettings(t.model || cfg?.model || '', t.effort, t.permissionMode);
  await refreshRail();
  syncHeader();
  await inspector.loadChanges();
  inspector.setTasks(t.tasks);
  syncContextDiff(inspector.allChanges());
  renderHistory(t, inspector.allChanges());
  showLastTurnState(t);
  if (window.matchMedia(COMPACT_RAIL).matches) shell.dataset.rail = 'closed';
}

/** Sin carpeta explícita, la nueva conversación sigue en la carpeta de la actual. */
async function newThread(workspace?: string): Promise<void> {
  const where = workspace ?? (thread ? summaryOf(thread.id)?.projectPath : undefined);
  const t = await api.threadsCreate(where ? { workspace: where } : undefined);
  if (t.error) {
    transcript.addNote(t.error, 'error');
    return;
  }
  cfg = await api.configGet();
  await openThread(t.id);
  composer.focus();
}

async function openFolder(): Promise<void> {
  const res = await api.workspacePick();
  if (res.path) await newThread(res.path);
}

/** La lista viene del endpoint; si falla, quedan los modelos configurados y se dice por qué. */
async function loadModels(): Promise<void> {
  const res = await api.modelsList();
  const host = cfg ? endpointHost(cfg.baseUrl) : '';
  composer.setModels(res.models, host);
  const current = thread?.model || cfg?.model || '';
  if (res.error) {
    transcript.addNote(`No pude leer la lista de modelos de ${host} (${res.error}). Muestro solo los configurados.`, 'error');
  } else if (current && !res.models.includes(current)) {
    transcript.addNote(`${current} no está entre los modelos de ${host}. Elige otro en el selector de modelo.`, 'error');
  }
}

function isCompaction(m: ChatMessage): boolean {
  return m.role === 'user' && (m.content ?? '').startsWith(COMPACTION_PREFIX);
}

/** Reconstruye la bitácora desde la historia persistida, un turno por mensaje de usuario. */
function renderHistory(t: ThreadInfo, changes: FileChangeSummary[]): void {
  transcript.clear();
  const userCount = t.history.filter((m) => m.role === 'user' && !isCompaction(m)).length;
  if (userCount === 0) {
    transcript.showEmpty(summaryOf(t.id)?.projectName ?? 'este proyecto');
    warnIfNoKey();
    return;
  }
  // Tras una compactación la historia conserva solo los últimos turnos.
  let turnIndex = t.turns.length - userCount;
  let open = false;
  let skipAck = false;
  const close = (): void => {
    if (!open) return;
    const record = t.turns.find((x) => x.index === turnIndex);
    const elapsed = record?.startedAt && record.finishedAt ? Date.parse(record.finishedAt) - Date.parse(record.startedAt) : null;
    transcript.endTurn(changes, elapsed, false);
    open = false;
  };
  for (const m of t.history) {
    if (isCompaction(m)) {
      transcript.addCompactionMark('Contexto anterior resumido para seguir con espacio');
      skipAck = true;
    } else if (m.role === 'user') {
      close();
      turnIndex++;
      transcript.beginTurn(turnIndex, (m.content ?? '').replace(ATTACHMENT_MARK, ''));
      open = true;
    } else if (m.role === 'assistant') {
      if (skipAck && !m.tool_calls?.length) {
        skipAck = false;
        continue;
      }
      if (m.content) transcript.settleText(m.content);
      for (const call of m.tool_calls ?? []) transcript.startStep(call.id, call.function.name, call.function.arguments, false);
    } else if (m.role === 'tool' && m.tool_call_id) {
      // La historia no guarda si la herramienta falló: no se inventa éxito ni fallo.
      transcript.finishStep(m.tool_call_id, m.content ?? '', null);
    }
  }
  close();
  transcript.scrollToEnd();
}

function warnIfNoKey(): void {
  if (cfg && cfg.apiKeySource === 'none') {
    transcript.addNote('Falta la clave API: el agente no puede responder hasta que la pegues en Configuración.', 'error');
  }
}

// ---------- Turno en curso ----------

async function send(text: string): Promise<void> {
  if (run) return;
  if (!thread) await newThread();
  const t = thread;
  if (!t) return;
  const turnIndex = t.turns.length + 1;
  transcript.beginTurn(turnIndex, text);
  startRun(t.id, turnIndex);
  const res = await api.send(t.id, text, pendingAttachmentIds);
  pendingAttachmentIds = [];
  syncAttachments();
  if (!res.ok) {
    transcript.addNote(res.error ?? 'No se pudo iniciar el turno.', 'error');
    transcript.endTurn([], null, false);
    stopRun();
  }
}

function startRun(threadId: string, turnIndex: number): void {
  const startedAt = performance.now();
  const timer = window.setInterval(() => {
    runClock.textContent = clock(performance.now() - startedAt);
  }, 1000);
  run = { threadId, turnIndex, startedAt, stopRequested: false, failed: false, timer };
  showRunState('running', clock(0));
  composer.setBusy(true);
  void refreshRail();
}

function stopRun(): void {
  if (run) window.clearInterval(run.timer);
  run = null;
  composer.setBusy(false);
}

/** Sin `elapsed`, conserva el tiempo que ya muestra (el cronómetro sigue corriendo). */
function showRunState(state: RunState, elapsed?: string): void {
  runStatus.hidden = false;
  runStatus.dataset.state = state;
  runLabel.textContent = RUN_LABELS[state];
  if (elapsed !== undefined) runClock.textContent = elapsed;
}

/** Al abrir una conversación sin turno en curso: cómo terminó su último turno. */
function showLastTurnState(t: ThreadInfo): void {
  if (run?.threadId === t.id) return;
  const last = t.turns.at(-1);
  if (!last?.startedAt || !last.finishedAt) {
    runStatus.hidden = true;
    return;
  }
  showRunState('done', duration(Date.parse(last.finishedAt) - Date.parse(last.startedAt)));
}

async function finishRun(): Promise<void> {
  const current = run;
  if (!current) return;
  const changes = await api.changesList(current.threadId);
  const elapsed = performance.now() - current.startedAt;
  if (thread?.id === current.threadId) {
    if (current.stopRequested) transcript.addNote('Detenido por ti antes de terminar.');
    transcript.endTurn(changes, elapsed, true);
    showRunState(current.stopRequested ? 'stopped' : current.failed ? 'failed' : 'done', duration(elapsed));
  }
  stopRun();
  if (thread?.id === current.threadId) {
    const fresh = await api.threadsGet(current.threadId);
    if (!fresh.error) thread = fresh;
    await inspector.loadChanges();
    inspector.setTasks(thread.tasks);
    syncContextDiff(inspector.allChanges());
  }
  await refreshRail();
  syncHeader();
}

function handleEvent(evt: AgentEvent): void {
  if (evt.type === 'mcp-status') {
    inspector.setMcp(evt.statuses ?? []);
    return;
  }
  const viewing = !!thread && evt.threadId === thread.id;
  switch (evt.type) {
    case 'delta':
      if (viewing) transcript.appendText(evt.text ?? '');
      break;
    case 'assistant':
      if (viewing) transcript.settleText(evt.text ?? '');
      break;
    case 'tool_start':
      if (viewing) transcript.startStep(evt.callId ?? '', evt.name ?? 'herramienta', evt.args ?? '', true);
      break;
    case 'tool_result':
      if (viewing) transcript.finishStep(evt.callId ?? '', evt.output ?? '', !!evt.isError);
      break;
    case 'compact':
      if (viewing) transcript.addCompactionMark('Contexto anterior resumido para seguir con espacio');
      break;
    case 'tasks':
      if (viewing) inspector.setTasks(evt.tasks ?? []);
      break;
    case 'error':
      if (run) run.failed = true;
      if (viewing) transcript.addNote(evt.message ?? 'Error desconocido del agente.', 'error');
      void finishRun();
      break;
    case 'done':
      void finishRun();
      break;
  }
}

async function handleApproval(req: ApprovalRequest): Promise<void> {
  // La aprobación pertenece al turno en curso: si se está viendo otra conversación, se vuelve a ella.
  if (run && thread?.id !== run.threadId) await openThread(run.threadId);
  showRunState('waiting');
  const allow = transcript.requestApproval(req);
  allow.focus({ preventScroll: true });
}

// ---------- Cambios ----------

async function undo(turnIndex: number, paths: string[]): Promise<void> {
  const t = thread;
  if (!t) return;
  const failures: string[] = [];
  for (const path of paths) {
    const res = await api.changesUndo(t.id, turnIndex, path);
    if (!res.ok) failures.push(`${path}: ${res.error ?? 'error desconocido'}`);
  }
  await openThread(t.id);
  await inspector.loadChanges(turnIndex);
  for (const f of failures) transcript.addNote(`No se pudo deshacer ${f}`, 'error');
}

// ---------- Adjuntos y ajustes ----------

async function attach(): Promise<void> {
  if (!thread) await newThread();
  const t = thread;
  if (!t) return;
  const res = await api.attachmentsAdd(t.id);
  if (res.ok && res.attachment) {
    t.attachments.push(res.attachment);
    pendingAttachmentIds.push(res.attachment.id);
    syncAttachments();
  } else if (res.error) {
    transcript.addNote(res.error, 'error');
  }
}

function syncAttachments(): void {
  composer.setAttachments(thread?.attachments.filter((a) => pendingAttachmentIds.includes(a.id)) ?? []);
}

function saveSetting(patch: Record<string, string>): void {
  void api.configSet(patch);
  if (thread) void api.threadsSettings({ threadId: thread.id, ...patch });
}

function openSettings(focus: 'endpoint' | 'first' = 'first'): void {
  if (cfg) settings.open(cfg, focus);
}

async function afterSettings(outcome: SettingsOutcome): Promise<void> {
  if (outcome.mcpError) transcript.addNote(`MCP no conectado: ${outcome.mcpError}`, 'error');
  cfg = await api.configGet();
  syncHeader();
  if (outcome.endpointChanged) await loadModels();
}

// ---------- Tema y disposición ----------

function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('turnwise-theme', theme);
}

function initialTheme(): 'light' | 'dark' {
  const saved = localStorage.getItem('turnwise-theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Los controles de Windows quedan sobre la cabecera más a la derecha: revisión si está abierta. */
function syncTitlebar(): void {
  const css = getComputedStyle(document.documentElement);
  const color = css.getPropertyValue(shell.dataset.review === 'open' ? '--surface' : '--bg').trim();
  const symbolColor = css.getPropertyValue('--text-2').trim();
  void api.setTitlebar({ color, symbolColor }).then((res) => {
    if (!res.ok) console.error(`Barra de título: ${res.error ?? 'sin detalle'}`);
  });
}

function wireLayout(): void {
  syncTitlebar();
  threadSearch.addEventListener('input', paintRail);
  threadSearch.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && threadSearch.value) {
      e.stopPropagation();
      threadSearch.value = '';
      paintRail();
    }
  });
  new MutationObserver(syncTitlebar).observe(shell, { attributes: true, attributeFilter: ['data-review'] });
  new MutationObserver(syncTitlebar).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (window.matchMedia(COMPACT_RAIL).matches) shell.dataset.rail = 'closed';
  byId('toggle-theme', HTMLButtonElement).addEventListener('click', () =>
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'),
  );
  byId('toggle-rail', HTMLButtonElement).addEventListener('click', () => (shell.dataset.rail = 'open'));
  byId('close-rail', HTMLButtonElement).addEventListener('click', () => (shell.dataset.rail = 'closed'));
  byId('toggle-review', HTMLButtonElement).addEventListener('click', () => inspector.setOpen(!inspector.isOpen()));
  byId('close-review', HTMLButtonElement).addEventListener('click', () => inspector.setOpen(false));
  contextDiff.addEventListener('click', () => {
    inspector.show('diff');
    void inspector.loadChanges();
  });
  byId('new-thread', HTMLButtonElement).addEventListener('click', () => void newThread());
  byId('open-settings', HTMLButtonElement).addEventListener('click', () => openSettings());
  byId('open-folder', HTMLButtonElement).addEventListener('click', () => void openFolder());
  byId('context-where', HTMLButtonElement).addEventListener('click', () => void openFolder());
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      void newThread();
    } else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      void openFolder();
    } else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (window.matchMedia(COMPACT_RAIL).matches) shell.dataset.rail = 'open';
      threadSearch.focus();
      threadSearch.select();
    } else if (e.key === 'Escape' && inspector.isOpen() && window.matchMedia(COMPACT_REVIEW).matches) {
      inspector.setOpen(false);
    }
  });
}

async function init(): Promise<void> {
  applyTheme(initialTheme());
  wireLayout();
  api.onEvent(handleEvent);
  api.onApproval((req) => void handleApproval(req));

  cfg = await api.configGet();
  composer.setModels(cfg.models, endpointHost(cfg.baseUrl));
  composer.setSettings(cfg.model, cfg.effort, cfg.permissionMode);
  inspector.setMcp(await api.mcpStatus());
  await refreshRail();
  if (threads.length > 0) {
    await openThread(threads[0].id);
  } else {
    syncHeader();
    transcript.showEmpty(cfg.workspace.split(/[\\/]/).pop() || 'este proyecto');
    warnIfNoKey();
  }
  if (cfg.warning) transcript.addNote(cfg.warning, 'error');
  await loadModels();
}

void init();
