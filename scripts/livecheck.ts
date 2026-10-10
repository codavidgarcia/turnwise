// Live check: ejecuta el agente real contra el endpoint configurado en .env
// con una tarea de código pequeña (crear y ejecutar un script), vía streaming.
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/core/config';
import { createChatModel } from '../src/core/providers';
import { Agent } from '../src/core/agent';
import { loadSkills } from '../src/core/skills';
import type { ToolContext } from '../src/core/tools';

const cfg = loadConfig(process.cwd());
if (!cfg.apiKey) {
  console.error('LIVECHECK_FAIL falta OPENAI_API_KEY en .env');
  process.exit(1);
}

const workspace = mkdtempSync(join(tmpdir(), 'turnwise-live-'));
console.log(`provider=${cfg.provider} endpoint=${cfg.baseUrl} model=${cfg.model} workspace=${workspace}`);

const ctx: ToolContext = {
  workspace,
  permissionMode: 'full',
  skills: loadSkills(join(process.cwd(), 'skills')),
  tasks: [],
  requestApproval: async () => true,
  onTaskChange: () => {},
  recordChange: () => {},
};

const agent = new Agent(createChatModel(cfg.provider, cfg), ctx, { maxSteps: cfg.maxSteps, effort: cfg.effort });

let deltas = 0;
await agent.run(
  'Crea un fichero saludo.py que imprima exactamente "hola desde turnwise" y luego ejecútalo con run_shell para verificar la salida.',
  (e) => {
    if (e.type === 'delta') deltas++;
    else if (e.type === 'assistant') console.log('[assistant]', e.text?.slice(0, 400));
    else if (e.type === 'tool_start') console.log('[tool]', e.name, (e.args ?? '').slice(0, 140));
    else if (e.type === 'tool_result')
      console.log('[result]', e.name, e.isError ? 'ERROR' : 'ok', (e.output ?? '').slice(0, 200).replace(/\n/g, ' | '));
    else if (e.type === 'error') console.log('[error]', e.message);
    else if (e.type === 'done') console.log('[done]', (e.text ?? '').slice(0, 400));
  },
);

const file = join(workspace, 'saludo.py');
const ok = existsSync(file) && readFileSync(file, 'utf8').includes('hola desde turnwise');
rmSync(workspace, { recursive: true, force: true });
console.log(`stream-deltas=${deltas}`);
console.log(ok ? 'LIVECHECK_OK' : 'LIVECHECK_FAIL no se creó saludo.py');
process.exit(ok ? 0 : 1);
