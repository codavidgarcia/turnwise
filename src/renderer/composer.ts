// Composer como objeto único: texto, adjuntos y chips (permisos, modelo, esfuerzo).
// El botón principal ES el estado: Enviar en reposo, Detener durante el turno.
import { el, icon, button, byId } from './dom';
import { Picker, type PickerOption } from './picker';
import type { AttachmentInfo, Effort, PermissionMode } from './types';

export interface ComposerHandlers {
  send: (text: string) => void;
  stop: () => void;
  attach: () => void;
  removeAttachment: (id: string) => void;
  setModel: (model: string) => void;
  setEffort: (effort: Effort) => void;
  setPermission: (mode: PermissionMode) => void;
  configureEndpoint: () => void;
}

const PERMISSIONS: PickerOption<PermissionMode>[] = [
  { value: 'read-only', label: 'Solo lectura', hint: 'Lee y busca. No escribe, no ejecuta ni usa herramientas externas.' },
  { value: 'ask', label: 'Preguntar antes', hint: 'Te pide permiso antes de cada escritura o comando.' },
  { value: 'full', label: 'Sin confirmación', hint: 'Escribe y ejecuta sin preguntar, sin aislamiento.' },
];

const EFFORTS: PickerOption<Effort>[] = [
  { value: 'low', label: 'Bajo' },
  { value: 'medium', label: 'Medio' },
  { value: 'high', label: 'Alto' },
];

export class Composer {
  private readonly input = byId('input', HTMLTextAreaElement);
  private readonly primary = byId('primary-action', HTMLButtonElement);
  private readonly attachments = byId('attachments', HTMLElement);
  private readonly permission: Picker<PermissionMode>;
  private readonly model: Picker<string>;
  private readonly effort: Picker<Effort>;
  private readonly endpointHost = el('span', 'menu-foot-host');
  private busy = false;

  constructor(private readonly h: ComposerHandlers) {
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        this.submit();
      }
    });
    this.input.addEventListener('input', () => this.syncPrimary());
    this.primary.addEventListener('click', () => (this.busy ? this.h.stop() : this.submit()));
    byId('attach', HTMLButtonElement).addEventListener('click', () => this.h.attach());

    this.permission = new Picker({
      trigger: byId('permission-picker', HTMLButtonElement),
      label: 'Permisos del agente',
      onChange: (v) => {
        this.h.setPermission(v);
        this.syncPermissionTone();
      },
    });
    this.permission.setOptions(PERMISSIONS);

    // El pie dice de qué endpoint salen los modelos y lleva a cambiarlo.
    const foot = el('div', 'menu-foot');
    foot.appendChild(el('span', 'menu-foot-label', 'Endpoint'));
    foot.appendChild(this.endpointHost);
    const change = button('btn btn-quiet menu-foot-action', 'Cambiar…', () => {
      this.model.close();
      this.h.configureEndpoint();
    });
    foot.appendChild(change);
    this.model = new Picker({
      trigger: byId('model-picker', HTMLButtonElement),
      label: 'Modelo',
      search: { placeholder: 'Buscar modelo' },
      footer: foot,
      onChange: (v) => this.h.setModel(v),
    });

    this.effort = new Picker({
      trigger: byId('effort-picker', HTMLButtonElement),
      label: 'Esfuerzo de razonamiento',
      onChange: (v) => this.h.setEffort(v),
    });
    this.effort.setOptions(EFFORTS);
    this.syncPrimary();
  }

  /** Conserva el modelo elegido aunque el endpoint no lo liste: se ve y se puede cambiar. */
  setModels(models: string[], endpoint: string): void {
    const current = this.model.value;
    const list = current && !models.includes(current) ? [current, ...models] : models;
    this.model.setOptions(list.map((m) => ({ value: m, label: m })));
    this.endpointHost.textContent = endpoint;
  }

  setSettings(model: string, effort: Effort, permission: PermissionMode): void {
    this.model.setValue(model);
    this.effort.setValue(effort);
    this.permission.setValue(permission);
    this.syncPermissionTone();
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.syncPrimary();
  }

  focus(): void {
    this.input.focus();
  }

  setAttachments(items: AttachmentInfo[]): void {
    this.attachments.replaceChildren();
    this.attachments.hidden = items.length === 0;
    for (const a of items) {
      const chip = el('span', 'attachment');
      chip.appendChild(icon('i-paperclip'));
      chip.appendChild(el('span', 'attachment-name', a.name));
      const rm = button('chip-x', '', () => this.h.removeAttachment(a.id));
      rm.setAttribute('aria-label', `Quitar ${a.name}`);
      rm.appendChild(icon('i-close'));
      chip.appendChild(rm);
      this.attachments.appendChild(chip);
    }
  }

  private submit(): void {
    const text = this.input.value.trim();
    if (!text || this.busy) return;
    this.input.value = '';
    this.syncPrimary();
    this.h.send(text);
  }

  private syncPrimary(): void {
    const label = this.busy ? 'Detener' : 'Enviar';
    this.primary.setAttribute('aria-label', label);
    this.primary.title = this.busy ? 'Detener el turno' : 'Enviar (Enter)';
    this.primary.dataset.mode = this.busy ? 'stop' : 'send';
    this.primary.disabled = !this.busy && this.input.value.trim() === '';
    this.primary.replaceChildren(icon(this.busy ? 'i-stop' : 'i-arrow-up'));
  }

  /** "Sin confirmación" es el único modo que merece tinta de aviso en el chip. */
  private syncPermissionTone(): void {
    byId('permission-picker', HTMLButtonElement).dataset.tone = this.permission.value === 'full' ? 'warn' : '';
  }
}
