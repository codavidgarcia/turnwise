// E2E sin modelo: Ctrl O abre una carpeta, crea su conversación y la recuerda al reiniciar.
// Sustituye solo el diálogo nativo (no automatizable); el resto es la app real con userData temporal.
import { _electron as electron } from 'playwright';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const userData = mkdtempSync(join(tmpdir(), 'turnwise-folder-'));
const picked = join(userData, 'proyecto-elegido');
mkdirSync(picked);

function fail(message) {
  console.log(`E2E_FOLDER_FAIL ${message}`);
  process.exitCode = 1;
}

async function launch() {
  const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: root });
  const page = await app.firstWindow();
  await page.waitForSelector('#log .empty, #log .turn');
  return { app, page };
}

const first = await launch();
await first.app.evaluate(({ dialog }, path) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
}, picked);
await first.page.keyboard.press('Control+o');
await first.page.waitForSelector('.project-label:text-is("proyecto-elegido")', { timeout: 10_000 });
const where = await first.page.textContent('#context-path');
if (where !== picked) fail(`la franja muestra ${where}, no ${picked}`);
await first.app.close();

const saved = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'));
if (saved.workspace !== picked) fail(`settings.json guarda ${saved.workspace}`);

// Al reiniciar, la conversación vuelve con su carpeta.
const second = await launch();
const again = await second.page.textContent('#context-path');
if (again !== picked) fail(`tras reiniciar la franja muestra ${again}`);
await second.app.close();

if (!process.exitCode) console.log(`E2E_FOLDER_OK workspace=${picked}`);
