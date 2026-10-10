// E2E real con el protocolo Anthropic: se configura desde la UI (Configuración → Compatible con
// Anthropic), se elige un modelo del endpoint y se hace un turno con herramientas. Consume tokens.
// userData temporal: no toca tus ajustes. La URL y la clave salen del .env (vale para OpenCode Go,
// que sirve /messages con la misma clave).
import { _electron as electron } from 'playwright';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL = process.env.TURNWISE_E2E_ANTHROPIC_MODEL ?? 'claude-haiku-5-5';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const userData = mkdtempSync(join(tmpdir(), 'turnwise-anthropic-'));
const app = await electron.launch({
  args: ['.', `--user-data-dir=${userData}`],
  cwd: root,
  env: { ...process.env, TURNWISE_WORKSPACE: root },
});
const page = await app.firstWindow();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const fail = async (message) => {
  console.log(`E2E_ANTHROPIC_FAIL ${message}`);
  await app.close();
  process.exit(1);
};

await page.waitForSelector('#log .empty, #log .turn');
await page.click('#open-settings');
await page.click('.segment:has(input[value="anthropic"])');
await page.click('#test-provider');
await page.waitForSelector('#provider-status:is([data-tone="ok"], [data-tone="error"])', { timeout: 20_000 });
const tested = await page.textContent('#provider-status');
console.log('probar conexión:', tested);
if ((await page.getAttribute('#provider-status', 'data-tone')) !== 'ok') await fail(tested);
await page.click('#dlg-settings button[value="save"]');
await page.waitForFunction(() => !document.getElementById('dlg-settings').open);

await page.click('#model-picker');
await page.waitForFunction(() => document.querySelectorAll('.menu:popover-open .menu-option').length > 2, null, { timeout: 15_000 });
await page.keyboard.type(MODEL);
await page.keyboard.press('Enter');
const chosen = await page.textContent('#model-picker .chip-value');
if (chosen !== MODEL) await fail(`el chip muestra ${chosen}`);
await page.click('#permission-picker');
await page.click('.menu:popover-open .menu-option:has-text("Solo lectura")');

await page.fill('#input', 'Lee package.json con la herramienta de leer ficheros y dime en una frase qué scripts de prueba tiene. No modifiques nada.');
await page.click('#primary-action');
await page.waitForSelector('#run-status[data-state="running"]', { timeout: 10_000 });
await page.waitForSelector('#run-status:is([data-state="done"], [data-state="failed"], [data-state="stopped"])', { timeout: 180_000 });

const result = await page.evaluate(() => ({
  state: document.querySelector('#run-status')?.dataset.state,
  steps: [...document.querySelectorAll('.step')].map((s) => `${s.dataset.state} ${s.querySelector('.step-label')?.textContent}`),
  say: [...document.querySelectorAll('.say')].map((s) => s.textContent?.slice(0, 200)),
  notes: [...document.querySelectorAll('.note')].map((n) => n.textContent),
}));
console.log(JSON.stringify(result, null, 2));
const saved = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'));
await app.close();

if (result.state !== 'done') await fail(`el turno terminó en ${result.state}`);
if (!result.steps.some((s) => s.startsWith('ok '))) await fail('ningún paso de herramienta terminó bien');
if (!result.say.some((t) => t && t.trim())) await fail('el modelo no respondió texto');
if (saved.provider !== 'anthropic' || saved.model !== MODEL) await fail(`settings.json guarda ${JSON.stringify({ provider: saved.provider, model: saved.model })}`);
if (JSON.stringify(saved).includes(process.env.OPENAI_API_KEY ?? '\u0000')) await fail('settings.json contiene la clave en claro');
if (errors.length > 0) await fail(`errores de consola: ${errors.join(' | ')}`);
console.log(`E2E_ANTHROPIC_OK model=${MODEL}`);
