// Diálogo de Configuración: endpoint del modelo (protocolo, URL base, clave) y herramientas.
// La clave nunca vuelve del proceso principal: solo de dónde viene y sus 4 últimos caracteres.
import { byId } from './dom';
import type { ConfigInfo, ProviderDraft, ProviderKind, TurnwiseApi } from './types';

/** Igual que DEFAULT_BASE_URL del proceso principal: la URL incluye /v1. */
const DEFAULT_BASE_URL: Record<ProviderKind, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
};

export interface SettingsOutcome {
  endpointChanged: boolean;
  mcpError?: string;
}

type SettingsApi = Pick<TurnwiseApi, 'providerTest' | 'providerSet' | 'configSet' | 'mcpConnect'>;

function keyNote(cfg: ConfigInfo): string {
  const tail = cfg.apiKeyHint ? ` · termina en ${cfg.apiKeyHint}` : '';
  if (cfg.apiKeySource === 'settings') return `Guardada en Turnwise, cifrada por Windows${tail}.`;
  if (cfg.apiKeySource === 'env') return `Viene de OPENAI_API_KEY en .env${tail}.`;
  return 'Sin clave: el agente no puede responder hasta que pegues una.';
}

export class SettingsDialog {
  private readonly dialog = byId('dlg-settings', HTMLDialogElement);
  private readonly form = byId('settings-form', HTMLFormElement);
  private readonly baseUrl = byId('set-base-url', HTMLInputElement);
  private readonly apiKey = byId('set-api-key', HTMLInputElement);
  private readonly keyNote = byId('api-key-note', HTMLElement);
  private readonly status = byId('provider-status', HTMLElement);
  private readonly test = byId('test-provider', HTMLButtonElement);
  private readonly searchUrl = byId('set-search-url', HTMLInputElement);
  private readonly mcpCommand = byId('set-mcp-command', HTMLInputElement);
  private cfg: ConfigInfo | null = null;

  constructor(
    private readonly api: SettingsApi,
    private readonly onSaved: (outcome: SettingsOutcome) => void,
  ) {
    for (const radio of this.radios()) radio.addEventListener('change', () => this.onKindChange());
    this.test.addEventListener('click', () => void this.runTest());
    this.form.addEventListener('submit', (e) => {
      if (!(e.submitter instanceof HTMLButtonElement) || e.submitter.value !== 'save') return;
      e.preventDefault();
      void this.save();
    });
  }

  open(cfg: ConfigInfo, focus: 'endpoint' | 'first' = 'first'): void {
    this.cfg = cfg;
    for (const radio of this.radios()) radio.checked = radio.value === cfg.provider;
    this.baseUrl.value = cfg.baseUrl;
    this.baseUrl.placeholder = DEFAULT_BASE_URL[cfg.provider];
    this.apiKey.value = '';
    this.apiKey.placeholder = cfg.apiKeySource === 'none' ? 'Pega tu clave' : 'Vacía = conservar la actual';
    this.keyNote.textContent = keyNote(cfg);
    this.setStatus('', '');
    this.searchUrl.value = cfg.searchUrl ?? '';
    this.mcpCommand.value = '';
    this.dialog.showModal();
    if (focus === 'endpoint') this.baseUrl.focus();
  }

  private radios(): HTMLInputElement[] {
    return [...this.form.querySelectorAll('input[name="provider"]')].filter((n) => n instanceof HTMLInputElement);
  }

  private kind(): ProviderKind {
    return this.radios().find((r) => r.checked)?.value === 'anthropic' ? 'anthropic' : 'openai';
  }

  private draft(): ProviderDraft {
    return { provider: this.kind(), baseUrl: this.baseUrl.value.trim(), apiKey: this.apiKey.value.trim() };
  }

  /** Cambiar de protocolo cambia la URL solo si seguía siendo la por defecto del otro. */
  private onKindChange(): void {
    const kind = this.kind();
    const other: ProviderKind = kind === 'openai' ? 'anthropic' : 'openai';
    const url = this.baseUrl.value.trim();
    if (!url || url === DEFAULT_BASE_URL[other]) this.baseUrl.value = DEFAULT_BASE_URL[kind];
    this.baseUrl.placeholder = DEFAULT_BASE_URL[kind];
    this.setStatus('', '');
  }

  private setStatus(text: string, tone: '' | 'ok' | 'error' | 'busy'): void {
    this.status.textContent = text;
    this.status.dataset.tone = tone;
  }

  private async runTest(): Promise<void> {
    this.test.disabled = true;
    this.setStatus('Probando…', 'busy');
    const res = await this.api.providerTest(this.draft());
    this.test.disabled = false;
    if (res.ok) this.setStatus(`Conecta · ${res.count ?? 0} modelos`, 'ok');
    else this.setStatus(res.error ?? 'No conecta.', 'error');
  }

  private endpointChanged(d: ProviderDraft): boolean {
    const cfg = this.cfg;
    return !cfg || d.apiKey !== '' || d.provider !== cfg.provider || d.baseUrl.replace(/\/+$/, '') !== cfg.baseUrl;
  }

  private async save(): Promise<void> {
    const d = this.draft();
    const endpointChanged = this.endpointChanged(d);
    if (endpointChanged) {
      const res = await this.api.providerSet(d);
      if (!res.ok) {
        this.setStatus(res.error ?? 'No se pudo guardar el endpoint.', 'error');
        return;
      }
    }
    await this.api.configSet({ searchUrl: this.searchUrl.value.trim() });
    let mcpError: string | undefined;
    const cmd = this.mcpCommand.value.trim();
    if (cmd) {
      const [command, ...args] = cmd.split(/\s+/);
      const status = await this.api.mcpConnect({ name: 'personal', transport: 'stdio', command, args, enabled: true });
      if (!status.connected) mcpError = status.error ?? 'sin detalle';
    }
    this.dialog.close('save');
    this.onSaved({ endpointChanged, mcpError });
  }
}
