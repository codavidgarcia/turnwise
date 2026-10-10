// Markdown mínimo del modelo a DOM, sin HTML crudo: bloques de código, títulos,
// listas, párrafos, `código` y **negrita**. Todo texto entra por textContent.
import { el } from './dom';

function appendInline(parent: HTMLElement, text: string): void {
  for (const part of text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)) {
    if (!part) continue;
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
      parent.appendChild(el('code', undefined, part.slice(1, -1)));
    } else if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
      parent.appendChild(el('strong', undefined, part.slice(2, -2)));
    } else {
      parent.appendChild(document.createTextNode(part));
    }
  }
}

function appendCode(wrap: HTMLElement, segment: string): void {
  const lang = /^([a-zA-Z0-9+#-]*)\n/.exec(segment)?.[1] ?? '';
  const body = segment.replace(/^[a-zA-Z0-9+#-]*\n/, '').replace(/\n$/, '');
  const pre = el('pre', 'code-block');
  if (lang) pre.dataset.lang = lang;
  pre.appendChild(el('code', undefined, body));
  wrap.appendChild(pre);
}

const LIST_ITEM = /^\s*(?:[-*]|\d+[.)])\s+/;

function appendBlock(wrap: HTMLElement, block: string): void {
  const lines = block.split('\n');
  const heading = /^(#{1,4})\s+(.*)$/.exec(lines[0]);
  if (heading && lines.length === 1) {
    const h = el('p', 'prose-heading');
    appendInline(h, heading[2]);
    wrap.appendChild(h);
    return;
  }
  if (lines.every((l) => LIST_ITEM.test(l) || /^\s{2,}\S/.test(l))) {
    const ordered = /^\s*\d/.test(lines[0]);
    const list = el(ordered ? 'ol' : 'ul');
    for (const line of lines) {
      if (LIST_ITEM.test(line)) {
        const li = el('li');
        appendInline(li, line.replace(LIST_ITEM, ''));
        list.appendChild(li);
      } else if (list.lastElementChild instanceof HTMLElement) {
        appendInline(list.lastElementChild, ` ${line.trim()}`);
      }
    }
    wrap.appendChild(list);
    return;
  }
  const p = el('p');
  appendInline(p, block);
  wrap.appendChild(p);
}

export function renderRich(text: string): HTMLElement {
  const wrap = el('div', 'prose');
  text.split(/```/).forEach((segment, i) => {
    if (i % 2 === 1) {
      appendCode(wrap, segment);
      return;
    }
    for (const block of segment.split(/\n{2,}/)) {
      const trimmed = block.replace(/^\n+|\s+$/g, '');
      if (trimmed) appendBlock(wrap, trimmed);
    }
  });
  return wrap;
}
