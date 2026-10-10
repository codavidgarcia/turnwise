// Pruebas de la lógica pura del renderer: traducción de pasos, formatos y diffstat.
// Uso: npm run test:ui
import { strict as assert } from 'node:assert';
import { describeStep, summarizeSteps } from '../src/renderer/steps';
import { filterThreads } from '../src/renderer/sidebar';
import { parseModelIds } from '../src/core/models';
import { AnthropicStream, fromAnthropicContent, toAnthropicRequest } from '../src/core/anthropic';
import { normalizeBaseUrl } from '../src/core/providers';
import { parseSettings } from '../src/core/settings';
import { clock, diffBlocks, duration, fileSummary, relativeTime, splitPath } from '../src/renderer/format';

let checks = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    checks++;
  } catch (e) {
    console.error(`FALLO ${name}`);
    throw e;
  }
}

check('lectura con rango', () => {
  const d = describeStep('read_file', JSON.stringify({ path: 'src/a.ts', offset: 10, limit: 5 }));
  assert.equal(d.kind, 'read');
  assert.equal(d.verb, 'Leyó');
  assert.equal(d.target, 'src/a.ts:10–14');
});

check('comando: solo la primera línea', () => {
  const d = describeStep('run_shell', JSON.stringify({ command: 'npm test\nrm -rf x' }));
  assert.equal(d.verbLive, 'Ejecutando');
  assert.equal(d.target, 'npm test');
});

check('búsqueda con carpeta', () => {
  assert.equal(describeStep('search_files', JSON.stringify({ pattern: 'retry', path: 'src' })).target, 'retry  en src');
});

check('mcp sin prefijo', () => {
  const d = describeStep('mcp_github_create_issue', '{}');
  assert.equal(d.kind, 'mcp');
  assert.equal(d.target, 'github_create_issue');
});

check('argumentos no JSON se muestran crudos', () => {
  const d = describeStep('write_file', '{"path": "a.ts", "content": "sin cerrar');
  assert.equal(d.kind, 'other');
  assert.ok(d.target.startsWith('{"path"'));
});

check('resumen de bloque en orden fijo y singular/plural', () => {
  assert.equal(summarizeSteps(['run', 'read', 'read', 'edit']), 'Leyó 2 archivos · editó 1 archivo · ejecutó 1 comando');
  assert.equal(summarizeSteps(['plan', 'plan']), 'Actualizó el plan');
});

check('diffstat proporcional y acotado a 5 bloques', () => {
  assert.deepEqual(diffBlocks(0, 0), ['none', 'none', 'none', 'none', 'none']);
  assert.deepEqual(diffBlocks(2, 0), ['add', 'add', 'none', 'none', 'none']);
  assert.deepEqual(diffBlocks(57, 8), ['add', 'add', 'add', 'add', 'del']);
  assert.deepEqual(diffBlocks(1, 99), ['del', 'del', 'del', 'del', 'del']);
});

check('duraciones', () => {
  assert.equal(duration(420), '0,4 s');
  assert.equal(duration(41_000), '41 s');
  assert.equal(duration(134_000), '2 min 14 s');
  assert.equal(duration(-1), '');
  assert.equal(clock(65_000), '1:05');
});

check('hora relativa compacta', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  assert.equal(relativeTime('2026-10-10T11:59:30Z', now), 'ahora');
  assert.equal(relativeTime('2026-10-10T11:48:00Z', now), '12 min');
  assert.equal(relativeTime('2026-10-10T09:00:00Z', now), '3 h');
  assert.equal(relativeTime('2026-10-07T12:00:00Z', now), '3 d');
  assert.equal(relativeTime('no-es-fecha', now), '');
});

check('rutas Windows y POSIX', () => {
  assert.deepEqual(splitPath('src/core/llm.ts'), { dir: 'src/core/', base: 'llm.ts' });
  assert.deepEqual(splitPath('C:\\a\\b.md'), { dir: 'C:\\a\\', base: 'b.md' });
  assert.deepEqual(splitPath('README.md'), { dir: '', base: 'README.md' });
});

check('resumen de ficheros del recibo', () => {
  assert.equal(fileSummary(['src/core/stream.ts']), 'stream.ts');
  assert.equal(fileSummary(['src/a.ts', 'b.md']), 'a.ts y b.md');
  assert.equal(fileSummary(['src/a.ts', 'b.md', 'c\d.json', 'e.ts']), 'a.ts, b.md y 2 más');
});

check('búsqueda del carril sin tildes ni mayúsculas', () => {
  const t = (title: string, projectName = 'turnwise') => ({ id: title, title, updatedAt: '', projectId: projectName, projectName, projectPath: '', model: '', turns: 0 });
  const list = [t('Migración del store'), t('Streaming SSE'), t('Permisos', 'api-inventario')];
  assert.deepEqual(filterThreads(list, 'MIGRACION').map((x) => x.title), ['Migración del store']);
  assert.deepEqual(filterThreads(list, 'inventario perm').map((x) => x.title), ['Permisos']);
  assert.equal(filterThreads(list, '   ').length, 3);
  assert.equal(filterThreads(list, 'nada').length, 0);
});

check('modelos del endpoint: ids únicos y ordenados', () => {
  const body = { data: [{ id: 'qwen3.8-max' }, { id: 'glm-5.10' }, { id: 'glm-5.3' }, { id: 'glm-5.3' }, { name: 'sin id' }, { id: '' }] };
  assert.deepEqual(parseModelIds(body), ['glm-5.3', 'glm-5.10', 'qwen3.8-max']);
  assert.throws(() => parseModelIds({ error: 'unauthorized' }), /data/);
});

check('ajustes guardados: solo campos válidos', () => {
  assert.deepEqual(parseSettings({ model: 'kimi-k3', effort: 'high', permissionMode: 'full', workspace: 'C:\\x' }), {
    model: 'kimi-k3', effort: 'high', permissionMode: 'full', workspace: 'C:\\x',
  });
  assert.deepEqual(parseSettings({ model: '', effort: 'turbo', permissionMode: 'root', workspace: 3 }), {});
  assert.deepEqual(parseSettings(null), {});
  assert.deepEqual(parseSettings({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKeyEnc: 'AQID' }), {
    provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKeyEnc: 'AQID',
  });
  assert.deepEqual(parseSettings({ provider: 'gemini', apiKey: 'sk-en-claro' }), {});
});

check('Anthropic: system aparte, tool_use y tool_result fundidos en turnos alternos', () => {
  const req = toAnthropicRequest(
    [
      { role: 'system', content: 'Eres Turnwise.' },
      { role: 'user', content: 'Lee dos ficheros' },
      {
        role: 'assistant',
        content: 'Leo ambos.',
        tool_calls: [
          { id: 'tu_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } },
          { id: 'tu_2', type: 'function', function: { name: 'read_file', arguments: '{"path":' } },
        ],
      },
      { role: 'tool', tool_call_id: 'tu_1', content: 'contenido a' },
      { role: 'tool', tool_call_id: 'tu_2', content: 'contenido b' },
      { role: 'user', content: 'Sigue' },
    ],
    [{ name: 'read_file', description: 'Lee', parameters: { type: 'object' } }],
  );
  assert.equal(req.system, 'Eres Turnwise.');
  assert.deepEqual(req.messages.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.deepEqual(req.messages[1].content[1], { type: 'tool_use', id: 'tu_1', name: 'read_file', input: { path: 'a.ts' } });
  assert.deepEqual(req.messages[1].content[2], { type: 'tool_use', id: 'tu_2', name: 'read_file', input: { raw: '{"path":' } });
  assert.deepEqual(req.messages[2].content, [
    { type: 'tool_result', tool_use_id: 'tu_1', content: 'contenido a' },
    { type: 'tool_result', tool_use_id: 'tu_2', content: 'contenido b' },
    { type: 'text', text: 'Sigue' },
  ]);
  assert.deepEqual(req.tools, [{ name: 'read_file', description: 'Lee', input_schema: { type: 'object' } }]);
});

check('Anthropic: el stream ensambla texto y argumentos troceados', () => {
  const texts: string[] = [];
  const s = new AnthropicStream({ onText: (t) => texts.push(t) });
  for (const e of [
    { type: 'message_start', message: {} },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'pienso' } },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Leo ' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'package.json' } },
    { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'tu_9', name: 'read_file', input: {} } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"pa' } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: 'th":"package.json"}' } },
    { type: 'content_block_start', index: 3, content_block: { type: 'tool_use', id: 'tu_10', name: 'list_files', input: {} } },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
  ]) s.push(e);
  const msg = s.result();
  assert.equal(msg.content, 'Leo package.json');
  assert.deepEqual(texts, ['Leo ', 'package.json']);
  assert.deepEqual(msg.tool_calls, [
    { id: 'tu_9', type: 'function', function: { name: 'read_file', arguments: '{"path":"package.json"}' } },
    { id: 'tu_10', type: 'function', function: { name: 'list_files', arguments: '{}' } },
  ]);
  assert.throws(() => s.push({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }), /Overloaded/);
});

check('Anthropic: respuesta completa sin streaming', () => {
  const msg = fromAnthropicContent([{ type: 'text', text: 'Hola' }, { type: 'tool_use', id: 't', name: 'x', input: { a: 1 } }]);
  assert.equal(msg.content, 'Hola');
  assert.deepEqual(msg.tool_calls, [{ id: 't', type: 'function', function: { name: 'x', arguments: '{"a":1}' } }]);
});

check('URL base del endpoint: validada y sin barra final', () => {
  assert.equal(normalizeBaseUrl(' https://opencode.ai/zen/go/v1/ '), 'https://opencode.ai/zen/go/v1');
  assert.equal(normalizeBaseUrl('http://localhost:11434/v1'), 'http://localhost:11434/v1');
  assert.throws(() => normalizeBaseUrl('opencode.ai/v1'), /no es una URL/);
  assert.throws(() => normalizeBaseUrl('ftp://x/v1'), /https/);
});

console.log(`UI_SELFTEST_OK checks=${checks}`);
