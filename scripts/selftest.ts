// Self-test del bucle agente <-> herramientas contra un endpoint mock compatible con OpenAI
// que devuelve SSE fragmentado (incluye UTF-8 y argumentos de tool_call troceados).
// No necesita credenciales: verifica streaming, tool-calling, bitácora de cambios
// y la puerta de permisos.
import { createServer } from 'node:http';
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenAIClient } from '../src/core/llm';
import { Agent, type AgentEvent } from '../src/core/agent';
import { loadSkills } from '../src/core/skills';
import { executeTool, insideWorkspace, type ToolContext } from '../src/core/tools';
import {
  adoptLegacyStore,
  LEGACY_DATA_DIR,
  LEGACY_STORE_FILE,
  STORE_FILE,
  type FileChange,
} from '../src/core/store';

const calls: Array<{ model: string; messages: unknown[]; tools: unknown[]; stream?: boolean }> = [];

function sseChunk(delta: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
}

const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url?.includes('/chat/completions')) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = JSON.parse(body);
      calls.push(parsed);
      const n = calls.length;
      res.setHeader('content-type', 'text/event-stream');
      res.setHeader('cache-control', 'no-cache');

      if (n === 1) {
        // tool_call con nombre y argumentos fragmentados + texto con acentos troceados
        const args = JSON.stringify({ path: '.', extra: 'ñ'.repeat(3) });
        const mid = Math.floor(args.length / 2);
        res.write(sseChunk({ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'list_files', arguments: args.slice(0, mid) } }] }));
        res.write(sseChunk({ tool_calls: [{ index: 0, function: { arguments: args.slice(mid) } }] }));
        res.end('data: [DONE]\n\n');
        return;
      }
      if (n === 2) {
        const args = JSON.stringify({ path: 'hola.txt', content: 'hola desde selftest' });
        const mid = Math.floor(args.length / 2);
        res.write(sseChunk({ tool_calls: [{ index: 0, id: 'call_2', function: { name: 'write_file', arguments: args.slice(0, mid) } }] }));
        res.write(sseChunk({ tool_calls: [{ index: 0, function: { arguments: args.slice(mid) } }] }));
        res.end('data: [DONE]\n\n');
        return;
      }
      // Respuesta final en streaming, con UTF-8 multibyte partido en dos chunks de red.
      const text = 'Listo: creado hola.txt — verificación hecha.';
      const buf = Buffer.from(text, 'utf8');
      res.write(sseChunk({ content: buf.subarray(0, 23).toString('utf8').slice(0, 20) }));
      res.write(sseChunk({ content: text.slice(20) }));
      res.end('data: [DONE]\n\n');
    });
    return;
  }
  res.statusCode = 404;
  res.end();
});

await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
const port = (server.address() as { port: number }).port;

const workspace = mkdtempSync(join(tmpdir(), 'turnwise-selftest-'));
const events: AgentEvent[] = [];
const changes: FileChange[] = [];
const llm = new OpenAIClient({
  baseUrl: `http://127.0.0.1:${port}/v1`,
  apiKey: 'selftest',
  model: 'mock-model',
});

function makeCtx(permissionMode: ToolContext['permissionMode']): ToolContext {
  return {
    workspace,
    permissionMode,
    skills: loadSkills(join(process.cwd(), 'skills')),
    tasks: [],
    requestApproval: async () => true,
    onTaskChange: () => {},
    recordChange: (path, before, after) => {
      changes.push({
        path,
        before,
        after,
        beforeHash: before === null ? 'null' : 'x',
        afterHash: after === null ? 'null' : 'y',
        undone: false,
      });
    },
  };
}

const agent = new Agent(llm, makeCtx('full'), { maxSteps: 10, effort: 'medium' });

await agent.run('Crea hola.txt con el contenido "hola desde selftest".', (e) => events.push(e));

const file = join(workspace, 'hola.txt');

// Pruebas de la puerta de permisos y de contención de rutas.
const roCtx = makeCtx('read-only');
const roResult = await executeTool(
  'write_file',
  JSON.stringify({ path: 'no.txt', content: 'x' }),
  roCtx,
);
let escapeBlocked = false;
try {
  insideWorkspace(makeCtx('full'), join('..', 'escape.txt'));
} catch {
  escapeBlocked = true;
}

// Migración del nombre anterior: copia una vez, no pisa un store nuevo y conserva el original.
const appData = mkdtempSync(join(tmpdir(), 'turnwise-migrate-'));
const legacy = join(appData, LEGACY_DATA_DIR, LEGACY_STORE_FILE);
const target = join(appData, 'turnwise', STORE_FILE);
mkdirSync(join(appData, LEGACY_DATA_DIR));
writeFileSync(legacy, '{"version":1,"projects":[],"activeThreadId":null}');
const adopted = adoptLegacyStore(legacy, target);
writeFileSync(target, '{"version":1,"projects":[{"id":"nuevo"}],"activeThreadId":null}');
const notOverwritten = !adoptLegacyStore(legacy, target) && readFileSync(target, 'utf8').includes('nuevo');
const migrationOk = adopted && existsSync(legacy) && notOverwritten;
rmSync(appData, { recursive: true, force: true });
if (!migrationOk) console.error(`FALLO migración: adopted=${adopted} notOverwritten=${notOverwritten}`);

const ok =
  calls.length === 3 &&
  calls.every((c) => c.stream === true) &&
  existsSync(file) &&
  readFileSync(file, 'utf8') === 'hola desde selftest' &&
  events.some((e) => e.type === 'delta') &&
  events.some((e) => e.type === 'tool_start' && e.name === 'list_files') &&
  events.some((e) => e.type === 'tool_start' && e.name === 'write_file') &&
  events.some((e) => e.type === 'changes' && (e.changes?.length ?? 0) === 1) &&
  changes.length === 1 &&
  changes[0].before === null &&
  events.some((e) => e.type === 'done') &&
  !!roResult.isError &&
  escapeBlocked &&
  migrationOk;

rmSync(workspace, { recursive: true, force: true });
server.close();

if (ok) {
  console.log('SELFTEST_OK calls=' + calls.length + ' events=' + events.length + ' changes=' + changes.length);
  process.exit(0);
} else {
  console.error(
    'SELFTEST_FAIL',
    JSON.stringify({
      calls: calls.length,
      streams: calls.map((c) => c.stream),
      events: events.map((e) => e.type),
      changes: changes.length,
      roDenied: !!roResult.isError,
      escapeBlocked,
    }),
  );
  process.exit(1);
}
