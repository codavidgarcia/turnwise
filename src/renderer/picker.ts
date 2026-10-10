// Menú de elección anclado a un chip. Vive en la capa superior del navegador (Popover API):
// sin z-index, se cierra con Escape o al pulsar fuera, y se coloca con anchor positioning.
import { el, icon } from './dom';
import { fold } from './format';

export interface PickerOption<T extends string> {
  value: T;
  label: string;
  /** Consecuencia de elegirla, en una línea. Solo cuando la etiqueta no basta. */
  hint?: string;
}

export interface PickerConfig<T extends string> {
  trigger: HTMLButtonElement;
  /** Nombre accesible de la lista ("Modelo", "Permisos del agente"). */
  label: string;
  search?: { placeholder: string };
  footer?: HTMLElement;
  onChange: (value: T) => void;
}

let pickerSeq = 0;

export class Picker<T extends string> {
  private readonly menu = el('div', 'menu');
  private readonly list = el('ul', 'menu-list');
  private readonly empty = el('p', 'menu-empty');
  private readonly input: HTMLInputElement | null = null;
  private readonly valueEl: HTMLElement;
  private readonly id = `picker-${++pickerSeq}`;
  private options: PickerOption<T>[] = [];
  private shown: PickerOption<T>[] = [];
  private current: T | null = null;
  private active = -1;

  constructor(private readonly cfg: PickerConfig<T>) {
    const { trigger } = cfg;
    const valueEl = trigger.querySelector('.chip-value');
    if (!(valueEl instanceof HTMLElement)) throw new Error(`El chip #${trigger.id} necesita un .chip-value`);
    this.valueEl = valueEl;

    this.menu.popover = 'auto';
    this.menu.id = this.id;
    this.list.id = `${this.id}-list`;
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', cfg.label);
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.popoverTargetElement = this.menu;

    if (cfg.search) {
      const box = el('label', 'menu-search');
      box.appendChild(icon('i-search'));
      const input = el('input');
      input.type = 'search';
      input.placeholder = cfg.search.placeholder;
      input.spellcheck = false;
      input.setAttribute('role', 'combobox');
      input.setAttribute('aria-expanded', 'true');
      input.setAttribute('aria-controls', this.list.id);
      input.setAttribute('aria-label', cfg.search.placeholder);
      // Al mostrarse, el popover enfoca su elemento autofocus como parte de la apertura.
      input.autofocus = true;
      input.addEventListener('input', () => this.render());
      input.addEventListener('keydown', (e) => this.onKey(e));
      box.appendChild(input);
      this.menu.appendChild(box);
      this.input = input;
    } else {
      this.list.tabIndex = 0;
      this.list.autofocus = true;
      this.list.addEventListener('keydown', (e) => this.onKey(e));
    }
    this.menu.appendChild(this.list);
    this.menu.appendChild(this.empty);
    if (cfg.footer) this.menu.appendChild(cfg.footer);
    document.body.appendChild(this.menu);

    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        // Abrir por el invocador (popovertarget) le da al menú su ancla implícita.
        if (!this.menu.matches(':popover-open')) trigger.click();
      }
    });
    // `beforetoggle` es síncrono: la lista se pinta antes de mostrarse (con `toggle`,
    // asíncrono, el menú aparecía vacío un fotograma y el foco llegaba tarde).
    this.menu.addEventListener('beforetoggle', (e) => {
      const open = e instanceof ToggleEvent && e.newState === 'open';
      trigger.setAttribute('aria-expanded', String(open));
      if (open) this.onOpen();
    });
    this.menu.addEventListener('toggle', (e) => {
      const open = e instanceof ToggleEvent && e.newState === 'open';
      if (open) return;
      if (!document.activeElement || document.activeElement === document.body || this.menu.contains(document.activeElement)) {
        trigger.focus();
      }
    });
  }

  get value(): T | null {
    return this.current;
  }

  setOptions(options: PickerOption<T>[]): void {
    this.options = options;
    this.syncTrigger();
    if (this.menu.matches(':popover-open')) this.render();
  }

  /** Refleja un valor que viene de fuera (otra conversación, ajustes): no dispara onChange. */
  setValue(value: T): void {
    this.current = value;
    this.syncTrigger();
  }

  close(): void {
    if (this.menu.matches(':popover-open')) this.menu.hidePopover();
  }

  private syncTrigger(): void {
    const opt = this.options.find((o) => o.value === this.current);
    const label = opt?.label ?? this.current ?? '';
    this.valueEl.textContent = label;
    this.cfg.trigger.setAttribute('aria-label', `${this.cfg.label}: ${label}`);
  }

  private onOpen(): void {
    if (this.input) this.input.value = '';
    this.render();
    const selected = this.shown.findIndex((o) => o.value === this.current);
    this.setActive(selected >= 0 ? selected : 0);
  }

  private render(): void {
    const words = fold(this.input?.value ?? '').split(/\s+/).filter(Boolean);
    this.shown = words.length === 0 ? this.options : this.options.filter((o) => words.every((w) => fold(o.label).includes(w)));
    this.list.replaceChildren(
      ...this.shown.map((o, i) => {
        const li = el('li', 'menu-option');
        li.id = `${this.id}-opt-${i}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(o.value === this.current));
        const text = el('span', 'menu-text');
        text.appendChild(el('span', 'menu-label', o.label));
        if (o.hint) text.appendChild(el('span', 'menu-hint', o.hint));
        li.appendChild(text);
        li.appendChild(icon('i-check', 'icon menu-check'));
        li.addEventListener('pointermove', () => this.setActive(i));
        li.addEventListener('click', () => this.choose(o));
        return li;
      }),
    );
    this.empty.hidden = this.shown.length > 0;
    this.empty.textContent = this.shown.length > 0 ? '' : `Nada coincide con «${this.input?.value.trim() ?? ''}».`;
    this.setActive(this.shown.length > 0 ? 0 : -1);
  }

  private setActive(index: number): void {
    const items = this.list.children;
    items[this.active]?.removeAttribute('data-active');
    this.active = index;
    const item = items[index];
    const owner = this.input ?? this.list;
    if (!(item instanceof HTMLElement)) {
      owner.removeAttribute('aria-activedescendant');
      return;
    }
    item.dataset.active = 'true';
    owner.setAttribute('aria-activedescendant', item.id);
    item.scrollIntoView({ block: 'nearest' });
  }

  private onKey(e: KeyboardEvent): void {
    const last = this.shown.length - 1;
    if (e.key === 'ArrowDown') this.setActive(Math.min(this.active + 1, last));
    else if (e.key === 'ArrowUp') this.setActive(Math.max(this.active - 1, 0));
    else if (e.key === 'Home' && !this.input) this.setActive(0);
    else if (e.key === 'End' && !this.input) this.setActive(last);
    else if (e.key === 'Enter') {
      const opt = this.shown[this.active];
      if (opt) this.choose(opt);
    } else if (e.key === 'Tab') this.close();
    else return;
    e.preventDefault();
  }

  private choose(option: PickerOption<T>): void {
    const changed = option.value !== this.current;
    this.current = option.value;
    this.syncTrigger();
    this.close();
    this.cfg.trigger.focus();
    if (changed) this.cfg.onChange(option.value);
  }
}
