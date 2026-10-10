// Capturas headless deterministas de la UI (taste loop, fase 3).
// Carga el dist/renderer/index.html REAL e inyecta un bridge turnwise simulado
// con datos sembrados en español; sin credenciales ni datos vivos.
// Uso: node scripts/ui-shot.mjs [outdir]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mock, liveTurn, reviewOpen, modelMenu, permissionMenu, settingsOpen } from './ui-fixture.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = process.argv[2] ?? join(root, 'review', 'shots');
mkdirSync(outdir, { recursive: true });

const browser = await chromium.launch();
const shots = [
  { name: 'desktop-light', width: 1440, height: 900, theme: 'light' },
  { name: 'desktop-dark', width: 1440, height: 900, theme: 'dark' },
  { name: 'desktop-revision-light', width: 1440, height: 900, theme: 'light', act: reviewOpen },
  { name: 'desktop-vivo-dark', width: 1440, height: 900, theme: 'dark', act: liveTurn },
  { name: 'portatil-revision-dark', width: 1100, height: 760, theme: 'dark', act: reviewOpen },
  { name: 'menu-modelo-dark', width: 1440, height: 900, theme: 'dark', act: modelMenu },
  { name: 'menu-permisos-light', width: 1440, height: 900, theme: 'light', act: permissionMenu },
  { name: 'ajustes-dark', width: 1440, height: 900, theme: 'dark', act: settingsOpen },
  { name: 'movil-light', width: 375, height: 812, theme: 'light' },
  { name: 'movil-menu-dark', width: 375, height: 812, theme: 'dark', act: modelMenu },
  { name: 'movil-vivo-dark', width: 375, height: 812, theme: 'dark', act: liveTurn },
];

const errors = [];
for (const shot of shots) {
  const page = await browser.newPage({ viewport: { width: shot.width, height: shot.height } });
  page.on('pageerror', (err) => errors.push(`${shot.name}: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`${shot.name}: ${msg.text()}`);
  });
  await page.addInitScript(mock);
  await page.addInitScript((theme) => localStorage.setItem('turnwise-theme', theme), shot.theme);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(pathToFileURL(join(root, 'dist', 'renderer', 'index.html')).href);
  await page.waitForSelector('.turn');
  if (shot.act) await shot.act(page);
  await page.waitForTimeout(200);
  await page.evaluate(() => document.fonts.ready);
  const applied = await page.evaluate(() => ({
    fontsOk: [...document.fonts].some((f) => f.status === 'loaded') && ![...document.fonts].some((f) => f.status === 'error'),
    theme: document.documentElement.dataset.theme,
    bg: getComputedStyle(document.body).backgroundColor,
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
    // El documento nunca debe desplazarse: solo la bitácora y los paneles tienen scroll.
    overflowY: document.documentElement.scrollHeight > window.innerHeight,
  }));
  if (applied.theme !== shot.theme) {
    errors.push(`TEMA_INCORRECTO ${shot.name}: esperado ${shot.theme}, aplicado ${applied.theme}`);
  }
  if (applied.overflowX) errors.push(`DESBORDE_HORIZONTAL ${shot.name}`);
  if (!applied.fontsOk) errors.push(`FUENTES_NO_CARGADAS ${shot.name}`);
  if (applied.overflowY) errors.push(`DESBORDE_VERTICAL ${shot.name}`);
  await page.screenshot({ path: join(outdir, `${shot.name}.png`) });
  await page.close();
  console.log('shot', shot.name, applied.theme, applied.bg);
}

/** Interacciones reales sobre la UI construida: permiso inline, fin de turno, pestañas y deshacer. */
async function interactions() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (err) => errors.push(`interacciones: ${err.message}`));
  await page.addInitScript(mock);
  await page.goto(pathToFileURL(join(root, 'dist', 'renderer', 'index.html')).href);
  await page.waitForSelector('.turn');
  const expect = (cond, msg) => {
    if (!cond) errors.push(`INTERACCION ${msg}`);
  };

  await liveTurn(page);
  expect((await page.textContent('#run-label')) === 'Esperando permiso', 'la cabecera no refleja el permiso pendiente');
  expect(await page.evaluate(() => document.activeElement?.textContent === 'Permitir una vez'), 'el foco no está en "Permitir una vez"');
  await page.click('text=Permitir una vez');
  expect(JSON.stringify(await page.evaluate(() => window.__calls)) === JSON.stringify([['respond', 'ap1', true]]), 'respond no recibió (ap1, true)');
  expect((await page.textContent('.approval-answer')) === 'Permitido', 'la aprobación no se cerró como "Permitido"');
  expect((await page.textContent('#run-label')) === 'Trabajando', 'la cabecera no volvió a "Trabajando"');

  await page.evaluate(() => {
    window.__emit({ type: 'tool_result', callId: 'l4', name: 'run_shell', output: 'SELFTEST_OK', isError: false });
    window.__emit({ type: 'done', text: '' });
  });
  await page.waitForSelector('#run-status[data-state="done"]');
  expect((await page.textContent('#run-label')) === 'Hecho', 'la barra no muestra "Hecho" al terminar');
  expect((await page.getAttribute('#primary-action', 'data-mode')) === 'send', 'el botón principal no volvió a Enviar');
  expect((await page.locator('.turn[data-turn="3"] .steps[open]').count()) === 1, 'el bloque con fallo debería quedar abierto');

  // Recibo como franja: plegado por defecto, la línea despliega los ficheros y las acciones no pliegan.
  const files = '.turn[data-turn="1"] .receipt-files';
  expect(!(await page.locator(files).evaluate((d) => d.open)), 'el recibo debería empezar plegado');
  await page.click(`${files} > .receipt-line`);
  expect(await page.locator(files).evaluate((d) => d.open), 'la línea del recibo no despliega los ficheros');
  expect((await page.locator(`${files} .receipt-list li`).count()) === 3, 'el recibo desplegado no lista sus 3 ficheros');

  // Carril: Ctrl K enfoca la búsqueda y filtra sin tildes.
  await page.keyboard.press('Control+k');
  expect(await page.evaluate(() => document.activeElement?.id === 'thread-search'), 'Ctrl K no enfoca la búsqueda');
  await page.keyboard.type('compactacion');
  const titles = await page.locator('.thread-title').allTextContents();
  expect(titles.length === 1 && titles[0].startsWith('Compactación'), `la búsqueda devolvió ${JSON.stringify(titles)}`);
  await page.keyboard.press('Escape');
  expect((await page.locator('.thread-title').count()) === 4, 'Escape no limpia la búsqueda');

  await page.click('#toggle-review');
  await page.focus('[data-tab="diff"]');
  await page.keyboard.press('ArrowRight');
  expect((await page.getAttribute('[data-tab="plan"]', 'aria-selected')) === 'true', 'ArrowRight no seleccionó Plan');
  expect(await page.isVisible('#plan-list'), 'el panel Plan no se mostró');

  await page.click('.turn[data-turn="2"] .receipt >> text=Deshacer turno');
  await page.waitForTimeout(200);
  const undo = (await page.evaluate(() => window.__calls)).filter((c) => c[0] === 'undo');
  expect(JSON.stringify(undo) === JSON.stringify([['undo', 't1', 2, 'scripts/selftest.ts']]), `deshacer turno llamó ${JSON.stringify(undo)}`);

  const calls = async (name) => (await page.evaluate(() => window.__calls)).filter((c) => c[0] === name);
  const openMenu = () => page.locator('.menu:popover-open');
  const chip = (id) => page.textContent(`#${id} .chip-value`);

  // Modelo: menú propio con búsqueda; la lista viene del endpoint y marca el modelo en uso.
  await page.click('#model-picker');
  expect((await openMenu().count()) === 1, 'el chip de modelo no abre su menú');
  const options = await openMenu().locator('.menu-label').allTextContents();
  expect(options.length === 6 && options.includes('kimi-k3'), `el menú de modelo muestra ${JSON.stringify(options)}`);
  expect((await openMenu().locator('[aria-selected="true"] .menu-label').textContent()) === 'mimo-v2.6-flash', 'el menú no marca el modelo en uso');
  // Anclado al chip y hacia arriba (el composer está abajo), no centrado en la ventana.
  const box = await openMenu().boundingBox();
  const anchor = await page.locator('#model-picker').boundingBox();
  expect(box && anchor && box.y + box.height <= anchor.y + 1 && box.x + box.width <= 1440, `menú mal colocado ${JSON.stringify({ box, anchor })}`);
  expect(await page.evaluate(() => document.activeElement?.getAttribute('role') === 'combobox'), 'la búsqueda del menú no recibe el foco');
  await page.keyboard.type('KIMI');
  expect((await openMenu().locator('.menu-option').count()) === 1, 'la búsqueda de modelo no filtra');
  await page.keyboard.press('Enter');
  expect((await openMenu().count()) === 0, 'Enter no cierra el menú');
  expect((await chip('model-picker')) === 'kimi-k3', 'el chip no muestra el modelo elegido');
  expect(JSON.stringify((await calls('configSet')).at(-1)) === JSON.stringify(['configSet', { model: 'kimi-k3' }]), 'elegir modelo no lo guarda');
  expect(await page.evaluate(() => document.activeElement?.id === 'model-picker'), 'el foco no vuelve al chip');

  // Permisos con teclado: flecha abre, flecha mueve, Enter elige.
  await page.focus('#permission-picker');
  await page.keyboard.press('ArrowDown');
  expect((await openMenu().locator('.menu-hint').count()) === 3, 'los permisos no explican su consecuencia');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  expect((await chip('permission-picker')) === 'Solo lectura', 'el teclado no eligió Solo lectura');
  expect(JSON.stringify((await calls('configSet')).at(-1)) === JSON.stringify(['configSet', { permissionMode: 'read-only' }]), 'elegir permiso no lo guarda');

  // Escape cierra sin cambiar nada.
  await page.click('#effort-picker');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  expect((await openMenu().count()) === 0 && (await chip('effort-picker')) === 'Medio', 'Escape no cierra el menú sin cambios');

  // Endpoint: desde el pie del menú de modelo a Configuración, probar y guardar un endpoint Anthropic.
  await page.click('#model-picker');
  await page.click('.menu:popover-open .menu-foot-action');
  expect(await page.evaluate(() => document.activeElement?.id === 'set-base-url'), '«Cambiar…» no lleva a la URL del endpoint');
  expect((await page.textContent('#api-key-note')).includes('7f3a'), 'la nota de la clave no dice cuál está en uso');
  await page.click('.segment:has(input[value="anthropic"])');
  await page.fill('#set-api-key', 'sk-ant-prueba');
  await page.click('#test-provider');
  await page.waitForSelector('#provider-status[data-tone="ok"]');
  const draft = { provider: 'anthropic', baseUrl: 'https://opencode.ai/zen/go/v1', apiKey: 'sk-ant-prueba' };
  expect(JSON.stringify((await calls('providerTest')).at(-1)) === JSON.stringify(['providerTest', draft]), 'Probar conexión no envió el borrador');
  await page.click('#dlg-settings button[value="save"]');
  await page.waitForTimeout(150);
  expect(JSON.stringify((await calls('providerSet')).at(-1)) === JSON.stringify(['providerSet', draft]), 'Guardar no envió el endpoint');
  expect(!(await page.evaluate(() => document.getElementById('dlg-settings').open)), 'Guardar no cerró la Configuración');

  // Carpeta: la franja del dock, Ctrl O y el + de cada proyecto abren conversaciones donde toca.
  const creates = async () => (await page.evaluate(() => window.__calls)).filter((c) => c[0] === 'threadsCreate' || c[0] === 'workspacePick');
  const before = (await creates()).length;
  await page.click('#context-where');
  await page.waitForTimeout(100);
  await page.keyboard.press('Control+o');
  await page.waitForTimeout(100);
  await page.click('.project:nth-child(2) .project-add');
  await page.waitForTimeout(100);
  const otra = 'C:\\Users\\dev\\proyectos\\otra-app';
  const expected = [
    ['workspacePick'], ['threadsCreate', { workspace: otra }],
    ['workspacePick'], ['threadsCreate', { workspace: otra }],
    ['threadsCreate', { workspace: 'C:\\Users\\dev\\proyectos\\api-inventario' }],
  ];
  const got = (await creates()).slice(before);
  expect(JSON.stringify(got) === JSON.stringify(expected), `abrir carpeta llamó ${JSON.stringify(got)}`);
  await page.close();
  console.log('interacciones comprobadas');
}

await interactions();
await browser.close();
if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log('SHOT_OK outdir=' + outdir);
}
