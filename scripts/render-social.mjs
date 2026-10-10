// Imagen de vista previa del repositorio (1280×640, la que GitHub usa al compartir el enlace).
// Usa la paleta oscura y las fuentes del DNA, y recorta la captura real de la bitácora.
// Requiere `npm run build` (fuentes en dist/); la captura sale de docs/screenshots/.
// Uso: npm run social → docs/social-preview.png
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonts = pathToFileURL(join(root, 'dist', 'renderer', 'fonts')).href;
const shot = pathToFileURL(join(root, 'docs', 'screenshots', 'turn-receipts-dark.png')).href;
const css = readFileSync(join(root, 'src', 'renderer', 'styles.css'), 'utf8');
const dark = css.slice(css.indexOf('[data-theme="dark"]'));
const token = (name) => dark.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`))[1];

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: "Schibsted Grotesk"; src: url("${fonts}/schibsted-grotesk-latin-wght-normal.woff2") format("woff2"); font-weight: 400 900; }
@font-face { font-family: "IBM Plex Mono"; src: url("${fonts}/ibm-plex-mono-latin-400-normal.woff2") format("woff2"); }
* { box-sizing: border-box; margin: 0; }
body { width: 1280px; height: 640px; overflow: hidden; background: ${token('--bg')}; color: ${token('--text')};
  font-family: "Schibsted Grotesk", sans-serif; display: grid; grid-template-columns: 500px 1fr; }
.copy { padding: 72px 0 64px 72px; display: flex; flex-direction: column; }
.brand { display: flex; align-items: center; gap: 14px; font-size: 30px; font-weight: 600; letter-spacing: -0.015em; }
.brand svg { width: 34px; height: 34px; fill: ${token('--accent')}; }
h1 { margin-top: 56px; font-size: 44px; line-height: 1.08; font-weight: 600; letter-spacing: -0.025em; }
p { margin-top: 22px; font-size: 20px; line-height: 1.45; color: ${token('--text-2')}; max-width: 25ch; }
.facts { margin-top: auto; font-family: "IBM Plex Mono", monospace; font-size: 15px; color: ${token('--text-3')}; }
.frame { margin: 56px 0 0 0; border: 1px solid ${token('--border')}; border-right: 0; border-bottom: 0;
  border-radius: 16px 0 0 0; overflow: hidden; box-shadow: 0 16px 40px rgb(0 0 0 / 0.45); }
.frame img { display: block; width: 1440px; margin: -42px 0 0 -478px; }
</style></head><body>
<div class="copy">
  <div class="brand"><svg viewBox="-1 -1 16 16"><rect width="4" height="4" rx="0.9"/><rect x="5" width="4" height="4" rx="0.9"/><rect x="10" width="4" height="4" rx="0.9"/><rect x="5" y="5" width="4" height="4" rx="0.9"/><rect x="5" y="10" width="4" height="4" rx="0.9"/></svg>Turnwise</div>
  <h1>Every agent turn ends with a receipt.</h1>
  <p>An open-source desktop coding agent. Review each turn, or undo it whole.</p>
  <div class="facts">OpenAI- or Anthropic-compatible · MIT</div>
</div>
<div class="frame"><img src="${shot}"></div>
</body></html>`;

mkdirSync(join(root, 'docs'), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
// Desde un fichero, no con setContent: about:blank no puede cargar fuentes ni imágenes file://.
const pageFile = join(mkdtempSync(join(tmpdir(), 'turnwise-social-')), 'social.html');
writeFileSync(pageFile, html, 'utf8');
await page.goto(pathToFileURL(pageFile).href, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').length);
if (loaded < 2) throw new Error(`Solo cargaron ${loaded} fuentes; ejecuta npm run build antes.`);
await page.screenshot({ path: join(root, 'docs', 'social-preview.png') });
await browser.close();
console.log('SOCIAL_OK docs/social-preview.png');
