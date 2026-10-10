// Bitácora: cada turno = pedido · prosa y bloques de pasos · recibo de cambios.
// El estado en vivo (turno, bloque y paso en curso) vive aquí; app.ts solo enruta eventos.
import { el, icon, button } from './dom';
import { renderRich } from './rich';
import { describeStep, summarizeSteps, type StepKind } from './steps';
import { duration, diffBlocks, splitPath, fileSummary, plural } from './format';
import type { ApprovalRequest, FileChangeSummary } from './types';

const STEP_ICONS: Record<StepKind, string> = {
  read: 'i-file',
  search: 'i-search',
  edit: 'i-pencil',
  run: 'i-terminal',
  plan: 'i-list',
  skill: 'i-book',
  mcp: 'i-plug',
  other: 'i-dot',
};

const OUTPUT_PREVIEW_CHARS = 4000;

export interface ReceiptActions {
  review: (turnIndex: number) => void;
  undoTurn: (turnIndex: number, paths: string[]) => Promise<void>;
}

interface StepView {
  root: HTMLDetailsElement;
  meta: HTMLElement;
  startedAt: number | null;
}

interface GroupView {
  root: HTMLDetailsElement;
  summary: HTMLElement;
  meta: HTMLElement;
  kinds: StepKind[];
  failures: number;
}

interface TurnView {
  index: number;
  section: HTMLElement;
  flow: HTMLElement;
  steps: number;
  group: GroupView | null;
  say: { body: HTMLElement; text: string } | null;
}

export class Transcript {
  private turn: TurnView | null = null;
  private readonly stepsById = new Map<string, StepView>();
  private readonly approvals = new Map<string, HTMLElement>();

  constructor(
    private readonly root: HTMLElement,
    private readonly actions: ReceiptActions,
    private readonly onApprovalAnswer: (id: string, approved: boolean) => void,
  ) {}

  clear(): void {
    this.root.replaceChildren();
    this.turn = null;
    this.stepsById.clear();
    this.approvals.clear();
  }

  showEmpty(projectName: string): void {
    this.clear();
    const stage = el('div', 'empty');
    stage.appendChild(el('h2', 'empty-title', `¿Qué cambiamos en ${projectName}?`));
    stage.appendChild(
      el('p', 'empty-lede', 'Cada turno termina con un recibo de los ficheros tocados, para revisarlo o deshacerlo entero.'),
    );
    this.root.appendChild(stage);
  }

  // ---------- Turnos ----------

  beginTurn(index: number, userText: string): void {
    this.root.querySelector('.empty')?.remove();
    const section = el('section', 'turn');
    section.dataset.turn = String(index);
    if (userText) {
      const ask = el('div', 'ask');
      ask.appendChild(el('span', 'gutter', String(index)));
      ask.appendChild(el('div', 'ask-text', userText));
      section.appendChild(ask);
    }
    const flow = el('div', 'flow');
    section.appendChild(flow);
    this.root.appendChild(section);
    this.turn = { index, section, flow, steps: 0, group: null, say: null };
    this.scroll();
  }

  /** Marca de compactación: el contexto anterior se resumió (no es un turno). */
  addCompactionMark(text: string): void {
    const mark = el('div', 'mark');
    mark.appendChild(icon('i-fold'));
    mark.appendChild(el('span', undefined, text));
    (this.turn?.flow ?? this.root).appendChild(mark);
  }

  appendText(delta: string): void {
    const turn = this.requireTurn();
    if (!turn.say) {
      this.closeGroup();
      const body = el('div', 'say');
      turn.flow.appendChild(body);
      turn.say = { body, text: '' };
    }
    turn.say.text += delta;
    turn.say.body.replaceChildren(renderRich(turn.say.text));
    this.scroll();
  }

  /** Texto definitivo de un paso del modelo; el siguiente texto abre bloque nuevo. */
  settleText(text: string): void {
    const turn = this.requireTurn();
    if (!turn.say) this.appendText('');
    if (turn.say) {
      turn.say.text = text;
      turn.say.body.replaceChildren(renderRich(text));
    }
    turn.say = null;
  }

  // ---------- Pasos ----------

  startStep(callId: string, name: string, args: string, live: boolean): void {
    const turn = this.requireTurn();
    turn.say = null;
    const group = this.ensureGroup(turn, live);
    const d = describeStep(name, args);
    turn.steps++;

    const root = el('details', 'step');
    root.dataset.state = live ? 'running' : 'done';
    root.dataset.kind = d.kind;
    const row = el('summary', 'step-row');
    row.appendChild(el('span', 'gutter', `${turn.index}.${turn.steps}`));
    row.appendChild(icon(STEP_ICONS[d.kind], 'icon step-icon'));
    const label = el('span', 'step-label');
    label.appendChild(el('span', 'step-verb', live ? d.verbLive : d.verb));
    if (d.target) {
      // Espacio real para lectores de pantalla y copiar/pegar; el flex lo ignora al maquetar.
      label.appendChild(document.createTextNode(' '));
      label.appendChild(el(d.targetIsCode ? 'code' : 'span', 'step-target', d.target));
    }
    row.appendChild(label);
    const meta = el('span', 'step-meta');
    row.appendChild(meta);
    root.appendChild(row);
    group.root.appendChild(root);

    root.dataset.verb = d.verb;
    group.kinds.push(d.kind);
    this.refreshGroup(group);
    this.stepsById.set(callId, { root, meta, startedAt: live ? performance.now() : null });
    this.scroll();
  }

  finishStep(callId: string, output: string, isError: boolean | null): void {
    const step = this.stepsById.get(callId);
    if (!step) return;
    step.root.dataset.state = isError === null ? 'done' : isError ? 'fail' : 'ok';
    const verb = step.root.querySelector('.step-verb');
    if (verb && step.root.dataset.verb) verb.textContent = step.root.dataset.verb;
    if (step.startedAt !== null) step.meta.textContent = duration(performance.now() - step.startedAt);
    if (isError) {
      step.meta.textContent = 'falló';
      step.root.open = true;
      if (this.turn?.group) {
        this.turn.group.failures++;
        this.refreshGroup(this.turn.group);
      }
    }
    if (output.trim()) {
      const out = el('pre', 'step-out', output.slice(0, OUTPUT_PREVIEW_CHARS));
      if (output.length > OUTPUT_PREVIEW_CHARS) {
        out.appendChild(el('span', 'step-cut', `\n… ${output.length - OUTPUT_PREVIEW_CHARS} caracteres más`));
      }
      step.root.appendChild(out);
    }
    this.resolveApprovalFor(step.root);
    this.scroll();
  }

  /** Permiso inline, colgado del paso que lo pide. Devuelve el botón principal para enfocarlo. */
  requestApproval(req: ApprovalRequest): HTMLButtonElement {
    const running = [...this.stepsById.values()].reverse().find((s) => s.root.dataset.state === 'running');
    const host = running?.root ?? this.requireTurn().flow;
    if (running) {
      running.root.dataset.state = 'waiting';
      running.root.open = true;
    }
    const box = el('div', 'approval');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Permiso requerido');
    const title =
      req.kind === 'command' ? 'Pide permiso para ejecutar' : req.kind === 'write' ? 'Pide permiso para escribir' : 'Pide permiso para usar una herramienta externa';
    box.appendChild(el('p', 'approval-title', title));
    box.appendChild(el('pre', 'approval-cmd', req.summary));
    const actions = el('div', 'approval-actions');
    const allow = button('btn btn-primary', 'Permitir una vez', () => this.answerApproval(req.id, true));
    actions.appendChild(allow);
    actions.appendChild(button('btn btn-quiet', 'Denegar', () => this.answerApproval(req.id, false)));
    box.appendChild(actions);
    host.appendChild(box);
    this.approvals.set(req.id, box);
    this.scroll();
    return allow;
  }

  hasPendingApproval(): boolean {
    return this.approvals.size > 0;
  }

  private answerApproval(id: string, approved: boolean): void {
    const box = this.approvals.get(id);
    if (!box) return;
    this.approvals.delete(id);
    const step = box.closest<HTMLDetailsElement>('.step');
    if (step && step.dataset.state === 'waiting') step.dataset.state = approved ? 'running' : 'fail';
    box.replaceChildren(el('p', 'approval-answer', approved ? 'Permitido' : 'Denegado'));
    this.onApprovalAnswer(id, approved);
  }

  private resolveApprovalFor(stepRoot: HTMLElement): void {
    for (const [id, box] of this.approvals) {
      if (stepRoot.contains(box)) this.approvals.delete(id);
    }
  }

  // ---------- Fin de turno ----------

  addNote(text: string, tone: 'info' | 'error' = 'info'): void {
    const note = el('div', `note note-${tone}`);
    note.appendChild(icon(tone === 'error' ? 'i-alert' : 'i-dot'));
    note.appendChild(el('span', undefined, text));
    (this.turn?.flow ?? this.root).appendChild(note);
    this.scroll();
  }

  /** Cierra el turno: pliega bloques sin fallos y añade el recibo si tocó ficheros. */
  endTurn(changes: FileChangeSummary[], elapsedMs: number | null, animate: boolean): void {
    const turn = this.turn;
    if (!turn) return;
    this.closeGroup();
    for (const g of turn.flow.querySelectorAll<HTMLDetailsElement>('.steps')) {
      if (!g.querySelector('.step[data-state="fail"]')) g.open = false;
    }
    for (const step of turn.flow.querySelectorAll<HTMLElement>('.step[data-state="running"], .step[data-state="waiting"]')) {
      step.dataset.state = 'done';
    }
    const own = changes.filter((c) => c.turnIndex === turn.index);
    if (own.length > 0) turn.section.appendChild(this.receipt(turn.index, own, elapsedMs, animate));
    this.turn = null;
    this.scroll();
  }

  private receipt(turnIndex: number, changes: FileChangeSummary[], elapsedMs: number | null, animate: boolean): HTMLElement {
    const added = changes.reduce((n, c) => n + c.added, 0);
    const removed = changes.reduce((n, c) => n + c.removed, 0);
    const live = changes.filter((c) => !c.undone);

    // Franja, no tarjeta: la línea es un <summary> que despliega los ficheros; las
    // acciones quedan fuera para que pulsarlas no pliegue ni despliegue la lista.
    const box = el('div', 'receipt');
    if (animate) box.classList.add('receipt-enter');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', `Cambios del turno ${turnIndex}`);
    if (live.length === 0) box.classList.add('is-undone');

    const files = el('details', 'receipt-files');
    const line = el('summary', 'receipt-line');
    line.appendChild(icon('i-chevron', 'icon chevron'));
    line.appendChild(blocks(added, removed));
    const figs = el('span', 'figs');
    figs.appendChild(el('span', 'fig-add', `+${added}`));
    figs.appendChild(el('span', 'fig-del', `−${removed}`));
    line.appendChild(figs);
    line.appendChild(el('span', 'receipt-names', fileSummary(changes.map((c) => c.path))));
    const facts: string[] = [];
    if (elapsedMs !== null) facts.push(duration(elapsedMs));
    if (live.length === 0) facts.push('deshecho');
    if (facts.length > 0) line.appendChild(el('span', 'receipt-facts', facts.join(' · ')));
    files.appendChild(line);
    const list = el('ul', 'receipt-list');
    for (const c of changes) list.appendChild(fileLine(c));
    files.appendChild(list);
    box.appendChild(files);

    const actions = el('span', 'receipt-actions');
    actions.appendChild(button('btn btn-quiet', 'Revisar', () => this.actions.review(turnIndex)));
    if (live.length > 0) {
      const undo = button('btn btn-quiet', 'Deshacer turno', () => {
        undo.disabled = true;
        void this.actions.undoTurn(turnIndex, live.map((c) => c.path));
      });
      actions.appendChild(undo);
    }
    box.appendChild(actions);
    return box;
  }

  // ---------- Bloques ----------

  private ensureGroup(turn: TurnView, live: boolean): GroupView {
    if (turn.group) return turn.group;
    const root = el('details', 'steps');
    root.open = live;
    const head = el('summary', 'steps-head');
    head.appendChild(el('span', 'gutter'));
    head.appendChild(icon('i-chevron', 'icon chevron'));
    const summary = el('span', 'steps-summary');
    head.appendChild(summary);
    const meta = el('span', 'steps-meta');
    head.appendChild(meta);
    root.appendChild(head);
    turn.flow.appendChild(root);
    turn.group = { root, summary, meta, kinds: [], failures: 0 };
    return turn.group;
  }

  private refreshGroup(group: GroupView): void {
    group.summary.textContent = summarizeSteps(group.kinds);
    group.meta.textContent = group.failures > 0 ? plural(group.failures, 'fallo', 'fallos') : '';
    group.meta.classList.toggle('is-fail', group.failures > 0);
  }

  private closeGroup(): void {
    if (this.turn) this.turn.group = null;
  }

  private requireTurn(): TurnView {
    if (!this.turn) this.beginTurn(0, '');
    if (!this.turn) throw new Error('No se pudo abrir el turno en la bitácora');
    return this.turn;
  }

  /** Sigue el final solo si el usuario ya estaba abajo: no le arranca de lo que lee. */
  private scroll(): void {
    const scroller = this.root.parentElement;
    if (!scroller) return;
    const fromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (fromBottom < scroller.clientHeight / 3) scroller.scrollTop = scroller.scrollHeight;
  }

  scrollToEnd(): void {
    const scroller = this.root.parentElement;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }
}

function blocks(added: number, removed: number): HTMLElement {
  const wrap = el('span', 'blocks');
  wrap.setAttribute('aria-hidden', 'true');
  for (const kind of diffBlocks(added, removed)) wrap.appendChild(el('span', `block block-${kind}`));
  return wrap;
}

function fileLine(c: FileChangeSummary): HTMLElement {
  const li = el('li', c.undone ? 'is-undone' : undefined);
  const { dir, base } = splitPath(c.path);
  const path = el('span', 'path');
  path.title = c.path;
  if (dir) path.appendChild(el('span', 'path-dir', dir));
  path.appendChild(el('span', 'path-base', base));
  li.appendChild(path);
  if (c.created) li.appendChild(el('span', 'tag', 'nuevo'));
  if (c.undone) li.appendChild(el('span', 'tag', 'deshecho'));
  const figs = el('span', 'figs');
  figs.appendChild(el('span', 'fig-add', `+${c.added}`));
  figs.appendChild(el('span', 'fig-del', `−${c.removed}`));
  li.appendChild(figs);
  return li;
}

export { fileLine, blocks };
