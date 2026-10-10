import { build } from 'esbuild';
import { mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

mkdirSync(join(dist, 'main'), { recursive: true });
mkdirSync(join(dist, 'preload'), { recursive: true });
mkdirSync(join(dist, 'renderer'), { recursive: true });

const common = {
  bundle: true,
  sourcemap: true,
  logLevel: 'info',
  target: 'es2022',
  external: ['electron', '@vscode/ripgrep'],
};

await build({
  ...common,
  entryPoints: [join(root, 'src/main/main.ts')],
  outfile: join(dist, 'main/main.mjs'),
  platform: 'node',
  format: 'esm',
  external: ['electron', '@vscode/ripgrep'],
  // Dependencias CJS embebidas (SDK MCP, diff) necesitan require() real en ESM.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});

await build({
  ...common,
  entryPoints: [join(root, 'src/preload/preload.ts')],
  outfile: join(dist, 'preload/preload.js'),
  platform: 'node',
  format: 'cjs',
  external: ['electron', '@vscode/ripgrep'],
});

await build({
  ...common,
  entryPoints: [join(root, 'src/renderer/app.ts')],
  outfile: join(dist, 'renderer/app.js'),
  platform: 'browser',
  format: 'iife',
});

for (const f of readdirSync(join(root, 'src/renderer'))) {
  if (f.endsWith('.html') || f.endsWith('.css')) {
    copyFileSync(join(root, 'src/renderer', f), join(dist, 'renderer', f));
  }
}

// Tipografía de la marca (DESIGN-DNA §4), empaquetada con su licencia OFL: la app no depende
// de fuentes del sistema ni de red. Subconjunto latin: cubre el español y − … · « ».
const FONTS = [
  { pkg: '@fontsource-variable/schibsted-grotesk', files: ['schibsted-grotesk-latin-wght-normal.woff2'], license: 'OFL-schibsted-grotesk.txt' },
  { pkg: '@fontsource/ibm-plex-mono', files: ['ibm-plex-mono-latin-400-normal.woff2', 'ibm-plex-mono-latin-600-normal.woff2'], license: 'OFL-ibm-plex-mono.txt' },
];
mkdirSync(join(dist, 'renderer', 'fonts'), { recursive: true });
for (const { pkg, files, license } of FONTS) {
  const dir = join(root, 'node_modules', ...pkg.split('/'));
  for (const f of files) copyFileSync(join(dir, 'files', f), join(dist, 'renderer', 'fonts', f));
  copyFileSync(join(dir, 'LICENSE'), join(dist, 'renderer', 'fonts', license));
}
console.log('build ok');
