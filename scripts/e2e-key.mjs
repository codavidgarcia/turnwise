// E2E sin modelo: una clave escrita en Configuración se guarda cifrada (safeStorage), nunca en
// claro, y sobrevive al reinicio. userData temporal; la clave es falsa y el endpoint no se llama.
import { _electron as electron } from 'playwright';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const userData = mkdtempSync(join(tmpdir(), 'turnwise-key-'));
const KEY = 'sk-turnwise-e2e-PLAINTEXT-9z8y';
const BASE = 'https://api.anthropic.com/v1';

function fail(message) {
  console.log(`E2E_KEY_FAIL ${message}`);
  process.exitCode = 1;
}

async function launch() {
  const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: root });
  const page = await app.firstWindow();
  await page.waitForSelector('#log .empty, #log .turn');
  return { app, page };
}

const first = await launch();
await first.page.click('#open-settings');
await first.page.click('.segment:has(input[value="anthropic"])');
await first.page.fill('#set-base-url', `${BASE}/`);
await first.page.fill('#set-api-key', KEY);
await first.page.click('#dlg-settings button[value="save"]');
await first.page.waitForFunction(() => !document.getElementById('dlg-settings').open);
await first.app.close();

const raw = readFileSync(join(userData, 'settings.json'), 'utf8');
const saved = JSON.parse(raw);
if (raw.includes(KEY) || raw.includes('PLAINTEXT')) fail('settings.json contiene la clave en claro');
if (!saved.apiKeyEnc) fail('settings.json no guarda la clave cifrada');
if (saved.provider !== 'anthropic' || saved.baseUrl !== BASE) fail(`endpoint guardado ${saved.provider} ${saved.baseUrl}`);

const second = await launch();
const cfg = await second.page.evaluate(() => window.turnwise.configGet());
await second.app.close();
if (cfg.apiKeySource !== 'settings' || cfg.apiKeyHint !== KEY.slice(-4)) fail(`tras reiniciar: ${cfg.apiKeySource} …${cfg.apiKeyHint}`);
if (JSON.stringify(cfg).includes(KEY)) fail('la clave en claro llega al renderer');

if (!process.exitCode) console.log(`E2E_KEY_OK provider=${cfg.provider} hint=…${cfg.apiKeyHint}`);
