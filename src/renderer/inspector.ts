// Panel de revisión: Diff (ficheros por turno + visor con números de línea), Plan y Fuentes.
// La lista de ficheros no se reordena al seleccionar: el visor vive debajo.
import { el, icon, button, byId } from './dom';
import { splitPath, plural } from './format';
import type { DiffView, FileChangeSummary, McpStatus, TurnwiseApi, SearchResult, TaskInfo } from './types';

export type InspectorTab = 'diff' | 'plan' | 'sources';

export interface InspectorDeps {
  api: TurnwiseApi;
  shell: HTMLElement;
  threadId: () => string | null;
  undo: (turnIndex: number, paths: string[]) => Promise<void>;
}

const TASK_STATUS: Record<string, { label: string; icon: string }> = {
  done: { label: 'Hecho', icon: 'i-check' },
  in_progress: { label: 'En curso', icon: 'i-progress' },
  pending: { label: 'Pendiente', icon: 'i-circle' },
};

function tabOf(tab: HTMLElement): InspectorTab {
  return tab.dataset.tab === 'plan' ? 'plan' : tab.dataset.tab === 'sources' ? 'sources' : 'diff';
}

export class Inspector {
  private changes: FileChangeSummary[] = [];
  private selected: { turnIndex: number; path: string } | null = null;

  private readonly filesEl = byId('diff-files', HTMLElement);
  private readonly viewerEl = byId('diff-viewer', HTMLElement);
  private readonly tasksEl = byId('plan-list', HTMLElement);
  private readonly sourcesEl = byId('sources-results', HTMLElement);
  private readonly mcpEl = byId('mcp-state', HTMLElement);

  constructor(private readonly deps: InspectorDeps) {
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-tab]')];
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => this.show(tabOf(tab)));
      // Patrón de tablist: las flechas mueven foco y selección.
      tab.addEventListener('keydown', (e) => {
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (step === 0) return;
        e.preventDefault();
        const next = tabs[(i + step + tabs.length) % tabs.length];
        this.show(tabOf(next));
        next.focus();
      });
    });
    this.wireSources();
  }

  // ---------- Apertura ----------

  isOpen(): boolean {
    return this.deps.shell.dataset.review === 'open';
  }

  setOpen(open: boolean): void {
    this.deps.shell.dataset.review = open ? 'open' : 'closed';
  }

  show(tab: InspectorTab): void {
    this.setOpen(true);
    for (const t of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
      const active = t.dataset.tab === tab;
      t.setAttribute('aria-selected', String(active));
      t.tabIndex = active ? 0 : -1;
    }
    for (const panel of document.querySelectorAll<HTMLElement>('[data-panel]')) {
      panel.hidden = panel.dataset.panel !== tab;
    }
  }

  // ---------- Diff ----------

  async loadChanges(focusTurn?: number): Promise<void> {
    const threadId = this.deps.threadId();
    this.changes = threadId ? await this.deps.api.changesList(threadId) : [];
    this.renderFiles();
    const first = focusTurn === undefined ? undefined : this.changes.find((c) => c.turnIndex === focusTurn);
    if (first) {
      this.show('diff');
      await this.select(first);
    } else if (this.selected && !this.changes.some((c) => this.isSelected(c))) {
      this.selected = null;
      this.viewerEl.replaceChildren();
    }
  }

  allChanges(): FileChangeSummary[] {
    return this.changes;
  }

  private isSelected(c: FileChangeSummary): boolean {
    return !!this.selected && this.selected.turnIndex === c.turnIndex && this.selected.path === c.path;
  }

  private renderFiles(): void {
    this.filesEl.replaceChildren();
    if (this.changes.length === 0) {
      this.filesEl.appendChild(el('p', 'panel-empty', 'Esta conversación aún no ha tocado ficheros.'));
      return;
    }
    const byTurn = new Map<number, FileChangeSummary[]>();
    for (const c of this.changes) byTurn.set(c.turnIndex, [...(byTurn.get(c.turnIndex) ?? []), c]);
    for (const [turnIndex, list] of [...byTurn].sort((a, b) => b[0] - a[0])) {
      const group = el('section', 'file-group');
      const head = el('header', 'file-group-head');
      head.appendChild(el('span', undefined, `Turno ${turnIndex}`));
      head.appendChild(el('span', 'file-group-count', plural(list.length, 'archivo', 'archivos')));
      group.appendChild(head);
      const ul = el('ul', 'file-list');
      for (const c of list) ul.appendChild(this.fileRow(c));
      group.appendChild(ul);
      this.filesEl.appendChild(group);
    }
  }

  private fileRow(c: FileChangeSummary): HTMLElement {
    const li = el('li', 'file-row');
    if (c.undone) li.classList.add('is-undone');
    const pick = el('button', 'file-pick');
    pick.type = 'button';
    if (this.isSelected(c)) pick.setAttribute('aria-current', 'true');
    pick.title = c.path;
    pick.dataset.turn = String(c.turnIndex);
    pick.dataset.path = c.path;
    pick.appendChild(el('span', `file-status ${c.created ? 'is-new' : ''}`, c.created ? 'A' : 'M'));
    const { dir, base } = splitPath(c.path);
    const path = el('span', 'path');
    path.appendChild(el('span', 'path-base', base));
    if (dir) path.appendChild(el('span', 'path-dir', dir));
    pick.appendChild(path);
    const figs = el('span', 'figs');
    figs.appendChild(el('span', 'fig-add', `+${c.added}`));
    figs.appendChild(el('span', 'fig-del', `−${c.removed}`));
    pick.appendChild(figs);
    pick.addEventListener('click', () => void this.select(c));
    li.appendChild(pick);
    return li;
  }

  private async select(c: FileChangeSummary): Promise<void> {
    const threadId = this.deps.threadId();
    if (!threadId) return;
    this.selected = { turnIndex: c.turnIndex, path: c.path };
    for (const b of this.filesEl.querySelectorAll<HTMLButtonElement>('.file-pick')) {
      const match = b.dataset.turn === String(c.turnIndex) && b.dataset.path === c.path;
      if (match) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    }
    const diff = await this.deps.api.changesDiff(threadId, c.turnIndex, c.path);
    this.renderDiff(c, diff);
  }

  private renderDiff(c: FileChangeSummary, diff: DiffView): void {
    this.viewerEl.replaceChildren();
    const head = el('header', 'viewer-head');
    const title = el('span', 'viewer-path', c.path);
    title.title = c.path;
    head.appendChild(title);
    if (!c.undone) {
      const undo = button('btn btn-quiet btn-sm', 'Deshacer archivo', () => {
        undo.disabled = true;
        void this.deps.undo(c.turnIndex, [c.path]);
      });
      head.appendChild(undo);
    } else {
      head.appendChild(el('span', 'tag', 'deshecho'));
    }
    this.viewerEl.appendChild(head);

    if (diff.error) {
      this.viewerEl.appendChild(el('p', 'panel-error', diff.error));
      return;
    }
    const table = el('div', 'diff');
    table.setAttribute('role', 'table');
    table.setAttribute('aria-label', `Diff de ${c.path}`);
    for (const hunk of diff.hunks) {
      table.appendChild(el('div', 'diff-hunk', `@@ −${hunk.oldStart} +${hunk.newStart} @@`));
      let oldNo = hunk.oldStart;
      let newNo = hunk.newStart;
      for (const line of hunk.lines) {
        const sign = line.charAt(0);
        const kind = sign === '+' ? 'add' : sign === '-' ? 'del' : 'ctx';
        const row = el('div', `diff-line is-${kind}`);
        row.setAttribute('role', 'row');
        row.appendChild(el('span', 'ln', kind === 'add' ? '' : String(oldNo)));
        row.appendChild(el('span', 'ln', kind === 'del' ? '' : String(newNo)));
        row.appendChild(el('span', 'sign', kind === 'ctx' ? '' : sign === '-' ? '−' : '+'));
        row.appendChild(el('span', 'code', line.slice(1)));
        table.appendChild(row);
        if (kind !== 'add') oldNo++;
        if (kind !== 'del') newNo++;
      }
    }
    this.viewerEl.appendChild(table);
  }

  // ---------- Plan ----------

  setTasks(tasks: TaskInfo[]): void {
    this.tasksEl.replaceChildren();
    const count = document.getElementById('plan-count');
    const open = tasks.filter((t) => t.status !== 'done').length;
    if (count) count.textContent = open > 0 ? String(open) : '';
    if (tasks.length === 0) {
      this.tasksEl.appendChild(el('li', 'panel-empty', 'El agente aún no ha escrito un plan en esta conversación.'));
      return;
    }
    for (const t of tasks) {
      const status = TASK_STATUS[t.status] ?? TASK_STATUS.pending;
      const li = el('li', `plan-item is-${t.status}`);
      const mark = icon(status.icon, 'icon plan-icon');
      li.appendChild(mark);
      const text = el('span', 'plan-text', t.text);
      li.appendChild(text);
      li.setAttribute('aria-label', `${status.label}: ${t.text}`);
      this.tasksEl.appendChild(li);
    }
  }

  // ---------- Fuentes ----------

  setMcp(statuses: McpStatus[]): void {
    const connected = statuses.filter((s) => s.connected);
    this.mcpEl.textContent =
      connected.length === 0 ? 'Ninguno conectado' : connected.map((s) => `${s.name} · ${plural(s.tools.length, 'herramienta', 'herramientas')}`).join('  ');
  }

  private wireSources(): void {
    const form = byId('web-form', HTMLFormElement);
    const query = byId('web-query', HTMLInputElement);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = query.value.trim();
      if (q) void this.search(q);
    });
    document.getElementById('worktree-btn')?.addEventListener('click', async () => {
      const res = await this.deps.api.worktreeCreate(`turnwise-${Date.now().toString(36)}`);
      this.sourceNote(res.ok ? `Worktree creado en ${res.path ?? ''}` : res.error ?? 'No se pudo crear el worktree.', !res.ok);
    });
    document.getElementById('sandbox-btn')?.addEventListener('click', async () => {
      const res = await this.deps.api.sandboxLaunch();
      this.sourceNote(res.message, !res.ok);
    });
  }

  private async search(q: string): Promise<void> {
    this.sourcesEl.replaceChildren(el('p', 'panel-empty', 'Buscando…'));
    let results: SearchResult[];
    try {
      results = await this.deps.api.webSearch(q);
    } catch (e) {
      this.sourceNote(e instanceof Error ? e.message : String(e), true);
      return;
    }
    this.sourcesEl.replaceChildren();
    if (results.length === 0) {
      this.sourcesEl.appendChild(el('p', 'panel-empty', `Sin resultados para «${q}».`));
      return;
    }
    for (const r of results) {
      const item = el('article', 'source');
      item.appendChild(el('p', 'source-title', r.title));
      item.appendChild(el('p', 'source-url', r.url));
      if (r.snippet) item.appendChild(el('p', 'source-snippet', r.snippet));
      this.sourcesEl.appendChild(item);
    }
  }

  private sourceNote(text: string, isError: boolean): void {
    const p = el('p', isError ? 'panel-error' : 'panel-empty', text);
    this.sourcesEl.replaceChildren(p);
  }
}
