// Fixture de la UI: bridge `window.turnwise` simulado con datos sembrados en español
// y acciones de escenario. Lo usan ui-shot.mjs y las comparativas de review/.

export const mock = () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  Date.now = () => now;
  const change = (turnIndex, path, added, removed, extra = {}) => ({
    turnIndex, path, beforeHash: 'a', afterHash: 'b', undone: false, created: false, added, removed, ...extra,
  });
  const changes = [
    change(1, 'src/core/stream.ts', 42, 0, { created: true }),
    change(1, 'src/core/llm.ts', 12, 5),
    change(1, 'docs/arquitectura-con-una-ruta-muy-larga-para-probar-desbordes-y-truncados-seguros.md', 3, 3, { undone: true }),
    change(2, 'scripts/selftest.ts', 18, 2),
  ];
  const call = (id, name, args) => ({ id, function: { name, arguments: JSON.stringify(args) } });
  const history = [
    { role: 'user', content: 'Implementa streaming SSE en el cliente LLM y enséñame el diff de lo que cambies.' },
    {
      role: 'assistant',
      content: 'Primero leo el cliente actual para ver cómo arma las peticiones.',
      tool_calls: [
        call('c1', 'read_file', { path: 'src/core/llm.ts' }),
        call('c2', 'search_files', { pattern: 'chatStream', path: 'src' }),
        call('c3', 'list_files', { path: 'src/core' }),
      ],
    },
    { role: 'tool', tool_call_id: 'c1', content: '1: // Cliente mínimo compatible con APIs estilo OpenAI\n2: import { request } from "node:https";' },
    { role: 'tool', tool_call_id: 'c2', content: 'Sin coincidencias' },
    { role: 'tool', tool_call_id: 'c3', content: 'agent.ts\nllm.ts\ntools.ts' },
    {
      role: 'assistant',
      content: 'No hay parser de eventos: lo escribo aparte y lo conecto en `chatStream`.',
      tool_calls: [
        call('c4', 'write_file', { path: 'src/core/stream.ts', content: '…' }),
        call('c5', 'edit_file', { path: 'src/core/llm.ts', old_text: 'a', new_text: 'b' }),
      ],
    },
    { role: 'tool', tool_call_id: 'c4', content: 'Escrito src/core/stream.ts (1240 bytes)' },
    { role: 'tool', tool_call_id: 'c5', content: 'Editado src/core/llm.ts' },
    {
      role: 'assistant',
      content:
        'Hecho. `chatStream` ahora ensambla los deltas de texto y los **tool_calls troceados** por índice.\n\n- El parser vive en `src/core/stream.ts`.\n- Los caracteres multibyte partidos entre dos chunks se recomponen con `TextDecoder` en modo stream.\n\n```ts\nconst decoder = new TextDecoder("utf-8");\n```',
    },
    { role: 'user', content: 'Añade una prueba para UTF-8 partido y córrela.' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        call('c6', 'manage_tasks', { action: 'add', text: 'Prueba de UTF-8 fragmentado' }),
        call('c7', 'edit_file', { path: 'scripts/selftest.ts', old_text: 'a', new_text: 'b' }),
        call('c8', 'run_shell', { command: 'npm run selftest' }),
      ],
    },
    { role: 'tool', tool_call_id: 'c6', content: 'Tarea añadida' },
    { role: 'tool', tool_call_id: 'c7', content: 'Editado scripts/selftest.ts' },
    { role: 'tool', tool_call_id: 'c8', content: '> turnwise@0.2.0 selftest\nSELFTEST_OK calls=3 events=12 changes=1' },
    { role: 'assistant', content: 'La prueba parte "ñ" entre dos chunks de red y pasa: `SELFTEST_OK calls=3 events=12`.' },
  ];
  const threads = [
    { id: 't1', title: 'Streaming SSE en el cliente LLM', updatedAt: '2026-10-10T11:48:00Z', projectId: 'p1', projectName: 'turnwise', projectPath: 'C:\\Users\\dev\\proyectos\\turnwise', model: 'mimo-v2.6-flash', turns: 2 },
    { id: 't2', title: 'Revisar permisos de escritura en worktrees', updatedAt: '2026-10-10T09:05:00Z', projectId: 'p1', projectName: 'turnwise', projectPath: 'C:\\Users\\dev\\proyectos\\turnwise', model: 'mimo-v2.6-flash', turns: 3 },
    { id: 't4', title: 'Compactación de contexto cuando la historia supera el umbral configurado', updatedAt: '2026-10-08T16:40:00Z', projectId: 'p1', projectName: 'turnwise', projectPath: 'C:\\Users\\dev\\proyectos\\turnwise', model: 'mimo-v2.6-pro', turns: 5 },
    { id: 't3', title: 'MCP: conectar servidor de ejemplo', updatedAt: '2026-10-07T09:10:00Z', projectId: 'p2', projectName: 'api-inventario', projectPath: 'C:\\Users\\dev\\proyectos\\api-inventario', model: 'mimo-v2.6-pro', turns: 2 },
  ];
  const listeners = { event: () => {}, approval: () => {} };
  window.__calls = [];
  window.__emit = (evt) => listeners.event({ threadId: 't1', ...evt });
  window.__approve = (req) => listeners.approval(req);
  window.turnwise = {
    configGet: async () => ({
      baseUrl: 'https://opencode.ai/zen/go/v1',
      model: 'mimo-v2.6-flash',
      models: ['mimo-v2.6-flash', 'mimo-v2.6-pro'],
      effort: 'medium',
      workspace: 'C:\\Users\\dev\\proyectos\\turnwise',
      permissionMode: 'ask',
      provider: 'openai',
      apiKeySource: 'settings',
      apiKeyHint: '7f3a',
      searchConfigured: false,
      searchUrl: '',
    }),
    configSet: async (p) => (window.__calls.push(['configSet', p]), { ok: true }),
    providerTest: async (p) => (window.__calls.push(['providerTest', p]), { ok: true, count: 45 }),
    providerSet: async (p) => (window.__calls.push(['providerSet', p]), { ok: true }),
    modelsList: async () => ({ models: ['deepseek-v4-pro', 'glm-5.3', 'kimi-k3', 'mimo-v2.6-flash', 'mimo-v2.6-pro', 'qwen3.8-max'] }),
    workspacePick: async () => {
      window.__calls.push(['workspacePick']);
      return { path: 'C:\\Users\\dev\\proyectos\\otra-app' };
    },
    threadsList: async () => threads,
    threadsCreate: async (p) => (window.__calls.push(['threadsCreate', p]), { id: 't1', title: 'Nueva conversación', history: [], turns: [], tasks: [], attachments: [] }),
    threadsGet: async () => ({
      id: 't1',
      title: 'Streaming SSE en el cliente LLM',
      model: 'mimo-v2.6-flash',
      effort: 'medium',
      permissionMode: 'ask',
      history,
      turns: [
        { index: 1, userText: '', startedAt: '2026-10-10T11:30:00Z', finishedAt: '2026-10-10T11:32:14Z' },
        { index: 2, userText: '', startedAt: '2026-10-10T11:46:00Z', finishedAt: '2026-10-10T11:46:41Z' },
      ],
      tasks: [
        { id: 'k1', text: 'Parser SSE incremental', status: 'done' },
        { id: 'k2', text: 'Prueba de UTF-8 fragmentado', status: 'done' },
        { id: 'k3', text: 'Reintentos con backoff cuando el stream se corta a mitad de un tool_call', status: 'in_progress' },
        { id: 'k4', text: 'Documentar el formato de eventos', status: 'pending' },
      ],
      attachments: [],
    }),
    threadsDelete: async () => ({ ok: true }),
    threadsRename: async () => ({}),
    threadsSettings: async () => ({}),
    send: async () => ({ ok: true }),
    cancel: async () => ({}),
    respond: async (id, approved) => {
      window.__calls.push(['respond', id, approved]);
      return {};
    },
    changesList: async () => changes,
    changesDiff: async () => ({
      path: 'src/core/llm.ts',
      created: false,
      hunks: [
        { oldStart: 40, newStart: 40, lines: [' async chatStream(messages, tools, opts) {', '-  const res = await this.post(body);', '-  return res.json();', '+  const res = await this.post({ ...body, stream: true });', '+  const parser = new SseParser();', '+  for await (const chunk of res.body) parser.push(decoder.decode(chunk, { stream: true }));', '+  return parser.message();', ' }'] },
        { oldStart: 88, newStart: 90, lines: [' export function toolSpec(t) {', '-  // TODO: streaming', '+  // tool_calls llegan troceados por índice', ' }'] },
      ],
    }),
    changesUndo: async (threadId, turnIndex, path) => {
      window.__calls.push(['undo', threadId, turnIndex, path]);
      return { ok: true };
    },
    attachmentsAdd: async () => ({ ok: true, attachment: { id: 'a2', name: 'notas-reunion.txt', size: 10, kind: 'text' } }),
    tasks: async () => [],
    mcpStatus: async () => [{ name: 'filesystem', connected: true, tools: ['read_file', 'write_file'] }],
    mcpConnect: async () => ({ connected: true, tools: [] }),
    webSearch: async () => [],
    worktreeCreate: async () => ({ ok: true, path: 'C:\\dev\\.worktrees\\qa' }),
    sandboxLaunch: async () => ({ ok: false, message: 'Windows Sandbox no está disponible en este equipo.' }),
    setTitlebar: async () => ({ ok: true }),
    onEvent: (cb) => (listeners.event = cb),
    onApproval: (cb) => (listeners.approval = cb),
  };
};

/** Turno en vivo: pasos terminados, uno fallido y un comando esperando permiso. */
export async function liveTurn(page) {
  await page.fill('#input', 'Haz que los reintentos usen backoff exponencial y verifica con el selftest.');
  await page.click('#primary-action');
  await page.evaluate(() => {
    const e = window.__emit;
    e({ type: 'delta', text: 'Reviso dónde se reintenta hoy el stream.' });
    e({ type: 'assistant', text: 'Reviso dónde se reintenta hoy el stream.' });
    e({ type: 'tool_start', callId: 'l1', name: 'search_files', args: JSON.stringify({ pattern: 'retry', path: 'src/core' }) });
    e({ type: 'tool_result', callId: 'l1', name: 'search_files', output: 'src/core/llm.ts:112: // retry once', isError: false });
    e({ type: 'tool_start', callId: 'l2', name: 'edit_file', args: JSON.stringify({ path: 'src/core/llm.ts', old_text: 'x', new_text: 'y' }) });
    e({ type: 'tool_result', callId: 'l2', name: 'edit_file', output: 'old_text aparece 2 veces; añade contexto o usa replace_all', isError: true });
    e({ type: 'tool_start', callId: 'l3', name: 'edit_file', args: JSON.stringify({ path: 'src/core/llm.ts', old_text: 'x', new_text: 'y' }) });
    e({ type: 'tool_result', callId: 'l3', name: 'edit_file', output: 'Editado src/core/llm.ts', isError: false });
    e({ type: 'tool_start', callId: 'l4', name: 'run_shell', args: JSON.stringify({ command: 'npm run selftest' }) });
    window.__approve({ id: 'ap1', kind: 'command', summary: 'npm run selftest' });
  });
}

/** Revisión abierta: recibo del turno 1 → primer fichero con su diff. */
export async function modelMenu(page) {
  await page.click('#model-picker');
  await page.keyboard.type('mi');
}

export async function permissionMenu(page) {
  await page.click('#permission-picker');
}

export async function settingsOpen(page) {
  await page.click('#open-settings');
  await page.click('.segment:has(input[value="anthropic"])');
  await page.click('#test-provider');
}

export async function reviewOpen(page) {
  await page.click('.turn[data-turn="1"] .receipt .btn:has-text("Revisar")');
  await page.waitForSelector('.diff-line');
  await page.click('.file-pick[data-path="src/core/llm.ts"]');
  await page.waitForTimeout(150);
}
