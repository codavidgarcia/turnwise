// Genera los iconos de la app (assets/) a partir de la marca "Bloques": una T de 5 bloques
// sobre una placa grafito. Los colores salen del tema oscuro de styles.css (--bg, --accent).
// Uso: npm run icons   (los ficheros generados se versionan; el build no depende de Playwright)
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'assets');
mkdirSync(out, { recursive: true });

// ---------- Tokens ----------

function darkToken(name) {
  const css = readFileSync(join(root, 'src', 'renderer', 'styles.css'), 'utf8');
  const block = /\[data-theme="dark"\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  const value = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)?.[1];
  if (!value) throw new Error(`Falta --${name} en el tema oscuro de styles.css`);
  return value;
}
const PLATE = darkToken('bg');
const INK = darkToken('accent');

// ---------- Geometría ----------

/** Retícula de la marca: bloque 4, hueco 1 (la misma proporción que #i-mark en index.html). */
const BLOCK_UNITS = 4;
const GAP_UNITS = 1;
const GLYPH_UNITS = 3 * BLOCK_UNITS + 2 * GAP_UNITS;
const GLYPH_RATIO = 0.625; // la T ocupa 5/8 de la placa en tamaños grandes
const PLATE_RADIUS_RATIO = 0.2;
const BLOCK_RADIUS_RATIO = 0.22;
/** Por debajo de 64px la legibilidad manda: T casi a sangre, ajustada a píxel entero. */
const SMALL = { 16: [4, 1], 24: [6, 1], 32: [8, 2], 48: [12, 3] };

function geometry(size) {
  const small = SMALL[size];
  if (small) {
    const [block, gap] = small;
    return { block, gap, pad: (size - (3 * block + 2 * gap)) / 2 };
  }
  const unit = Math.round((size * GLYPH_RATIO) / GLYPH_UNITS);
  return { block: BLOCK_UNITS * unit, gap: GAP_UNITS * unit, pad: (size - GLYPH_UNITS * unit) / 2 };
}

function svg(size) {
  const { block, gap, pad } = geometry(size);
  if (!Number.isInteger(pad)) throw new Error(`La marca no centra a ${size}px (margen ${pad})`);
  const step = block + gap;
  const cells = [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]];
  const rx = (block * BLOCK_RADIUS_RATIO).toFixed(2);
  const rects = cells
    .map(([c, r]) => `<rect x="${pad + c * step}" y="${pad + r * step}" width="${block}" height="${block}" rx="${rx}"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" rx="${Math.round(size * PLATE_RADIUS_RATIO)}" fill="${PLATE}"/>` +
    `<g fill="${INK}">${rects}</g></svg>`;
}

// ---------- Render ----------

async function renderPng(page, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size)}</body></html>`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

/** ICO con entradas PNG (soportado desde Windows Vista). */
function ico(entries) {
  const header = Buffer.alloc(6 + 16 * entries.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach(({ size, png }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(png.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...entries.map((x) => x.png)]);
}

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
/** Logos del manifiesto MSIX: nombre de fichero → tamaño. */
const MSIX_LOGOS = { 'logo44.png': 44, 'logo150.png': 150, 'storelogo.png': 50 };

const browser = await chromium.launch();
const page = await browser.newPage();
const entries = [];
for (const size of ICO_SIZES) entries.push({ size, png: await renderPng(page, size) });
writeFileSync(join(out, 'icon.ico'), ico(entries));
writeFileSync(join(out, 'icon-256.png'), entries.at(-1).png);
for (const [file, size] of Object.entries(MSIX_LOGOS)) writeFileSync(join(out, file), await renderPng(page, size));
await browser.close();
console.log(`ICONS_OK plate=${PLATE} ink=${INK} ico=${ICO_SIZES.join(',')} msix=${Object.values(MSIX_LOGOS).join(',')}`);
