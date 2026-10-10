// E2E real: Electron + endpoint real (.env) + UI. Consume tokens del proveedor.
// userData en un directorio temporal y permisos en Solo lectura: no toca datos ni ficheros.
import { _electron as electron } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const userData = mkdtempSync(join(tmpdir(), 'turnwise-e2e-'));
const app = await electron.launch({
  args: ['.', `--user-data-dir=${userData}`],
  cwd: root,
  env: { ...process.env, TURNWISE_WORKSPACE: root },
});
const usedPath = await app.evaluate(({ app: a }) => a.getPath('userData'));
console.log('userData', usedPath, usedPath === userData ? '(temporal)' : '(NO es el temporal)');
if (usedPath !== userData) {
  await app.close();
  process.exit(2);
}

const page = await app.firstWindow();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.waitForSelector('#log .empty, #log .turn');
// El menú de modelo se llena con GET /models del endpoint, no con una lista fija.
await page.click('#model-picker');
await page.waitForFunction(() => document.querySelectorAll('.menu:popover-open .menu-option').length > 2, null, { timeout: 15_000 });
console.log('modelos', await page.locator('.menu:popover-open .menu-option').count(), 'elegido', await page.textContent('#model-picker .chip-value'));
await page.keyboard.press('Escape');
await page.click('#permission-picker');
await page.click('.menu:popover-open .menu-option:has-text("Solo lectura")');
await page.fill('#input', 'Lee package.json y dime en una frase qué scripts de prueba tiene. No modifiques nada.');
await page.click('#primary-action');
await page.waitForSelector('#run-status[data-state="running"]', { timeout: 10_000 });
await page.waitForSelector('#run-status:is([data-state="done"], [data-state="failed"], [data-state="stopped"])', { timeout: 180_000 });

const result = await page.evaluate(() => ({
  steps: [...document.querySelectorAll('.step')].map((s) => `${s.dataset.state} ${s.querySelector('.step-label')?.textContent}`),
  groups: [...document.querySelectorAll('.steps-summary')].map((s) => s.textContent),
  say: [...document.querySelectorAll('.say')].map((s) => s.textContent?.slice(0, 200)),
  notes: [...document.querySelectorAll('.note')].map((n) => n.textContent),
  rail: [...document.querySelectorAll('.thread-title')].map((t) => t.textContent),
}));
console.log(JSON.stringify(result, null, 2));
await page.screenshot({ path: join(root, 'review', 'shots', 'electron-real.png') });
await app.close();

const ok = result.steps.length > 0 && result.say.some((s) => s && s.trim()) && !result.notes.some((n) => /Error|Falta/.test(n ?? ''));
if (errors.length) console.log('console.error:', errors);
console.log(ok && errors.length === 0 ? 'E2E_LIVE_OK' : 'E2E_LIVE_FAIL');
process.exitCode = ok && errors.length === 0 ? 0 : 1;
