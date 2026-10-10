// Carril: conversaciones agrupadas por proyecto, con hora relativa, punto "en curso" y búsqueda.
import { el, icon } from './dom';
import { fold, relativeTime } from './format';
import type { ThreadSummary } from './types';

export interface SidebarState {
  activeId: string | null;
  runningId: string | null;
  query: string;
}

/** Conversaciones cuyo título o proyecto contiene todas las palabras de la búsqueda. */
export function filterThreads(threads: ThreadSummary[], query: string): ThreadSummary[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return threads;
  return threads.filter((t) => {
    const haystack = fold(`${t.title} ${t.projectName}`);
    return words.every((w) => haystack.includes(w));
  });
}

export function renderSidebar(
  root: HTMLElement,
  threads: ThreadSummary[],
  state: SidebarState,
  open: (threadId: string) => void,
  newIn: (projectPath: string) => void,
): void {
  root.replaceChildren();
  if (threads.length === 0) {
    root.appendChild(el('p', 'rail-empty', 'Sin conversaciones todavía.'));
    return;
  }
  const shown = filterThreads(threads, state.query);
  if (shown.length === 0) {
    root.appendChild(el('p', 'rail-empty', `Nada coincide con «${state.query.trim()}».`));
    return;
  }
  // `threads` llega ordenado por actividad; el primer hilo de cada proyecto fija su orden.
  const byProject = new Map<string, { name: string; items: ThreadSummary[] }>();
  for (const t of shown) {
    const group = byProject.get(t.projectId) ?? { name: t.projectName, items: [] };
    group.items.push(t);
    byProject.set(t.projectId, group);
  }
  const now = Date.now();
  for (const { name, items } of byProject.values()) {
    const section = el('section', 'project');
    const head = el('h2', 'project-name');
    head.appendChild(icon('i-folder'));
    head.appendChild(el('span', 'project-label', name));
    head.appendChild(el('span', 'project-when', relativeTime(items[0].updatedAt, now)));
    const add = el('button', 'project-add');
    add.type = 'button';
    add.title = `Nueva conversación en ${items[0].projectPath}`;
    add.setAttribute('aria-label', `Nueva conversación en ${name}`);
    add.appendChild(icon('i-plus'));
    add.addEventListener('click', () => newIn(items[0].projectPath));
    head.appendChild(add);
    section.appendChild(head);
    const list = el('ul', 'thread-list');
    for (const t of items) {
      const li = el('li');
      const row = el('button', 'thread');
      row.type = 'button';
      if (t.id === state.activeId) row.setAttribute('aria-current', 'page');
      if (t.id === state.runningId) row.dataset.running = 'true';
      row.appendChild(el('span', 'thread-title', t.title));
      const when = el('span', 'thread-when', t.id === state.runningId ? '' : relativeTime(t.updatedAt, now));
      if (t.id === state.runningId) {
        when.appendChild(el('span', 'live-dot'));
        when.setAttribute('aria-label', 'en curso');
      }
      row.appendChild(when);
      row.addEventListener('click', () => open(t.id));
      li.appendChild(row);
      list.appendChild(li);
    }
    section.appendChild(list);
    root.appendChild(section);
  }
}
