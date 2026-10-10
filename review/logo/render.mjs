// Renderiza la hoja de direcciones de marca a PNG (headless).
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 760 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(join(here, 'sheet.html')).href);
await page.screenshot({ path: join(here, 'sheet.png'), fullPage: true });
await browser.close();
console.log('SHEET_OK');
