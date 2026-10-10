// Empaquetado MSIX experimental con MakeAppx (Windows SDK instalado).
// Etapa: runtime de Electron + app (dist, skills, node_modules de runtime).
// EXCLUYE explícitamente: .env, review/, datos de usuario y el store.
// El artefacto sale SIN FIRMAR: la instalación requiere certificado (se reporta).
import { mkdirSync, cpSync, rmSync, existsSync, writeFileSync, renameSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const staging = join(root, 'dist-appx', 'staging');
const outDir = join(root, 'dist-appx');
const makeappx = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.26100.0\\x64\\makeappx.exe';

if (!existsSync(makeappx)) {
  console.error('PACKAGE_FAIL no se encontró makeappx.exe del Windows SDK');
  process.exit(1);
}
if (!existsSync(join(root, 'assets', 'icon.ico'))) {
  console.error('PACKAGE_FAIL faltan los iconos: ejecuta antes npm run icons');
  process.exit(1);
}
if (!existsSync(join(root, 'dist', 'main', 'main.mjs'))) {
  console.error('PACKAGE_FAIL falta dist/: ejecuta antes npm run build');
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

// 1. Runtime de Electron (binarios) — el exe se renombra al de la app.
const electronDist = join(root, 'node_modules', 'electron', 'dist');
cpSync(electronDist, staging, { recursive: true });
renameSync(join(staging, 'electron.exe'), join(staging, 'Turnwise.exe'));

// 2. La app dentro de resources/app.
const appDir = join(staging, 'resources', 'app');
mkdirSync(appDir, { recursive: true });
cpSync(join(root, 'dist'), join(appDir, 'dist'), { recursive: true });
cpSync(join(root, 'skills'), join(appDir, 'skills'), { recursive: true });
// Icono de la ventana (BrowserWindow.icon) y logos del manifiesto: generados por `npm run icons`.
cpSync(join(root, 'assets'), join(appDir, 'assets'), { recursive: true });
if (existsSync(join(root, 'DESIGN-DNA.md'))) {
  cpSync(join(root, 'DESIGN-DNA.md'), join(appDir, 'DESIGN-DNA.md'));
}
writeFileSync(
  join(appDir, 'package.json'),
  JSON.stringify(
    {
      name: 'turnwise',
      version: '0.2.0',
      main: 'dist/main/main.mjs',
      description: 'Turnwise — agente de código de escritorio',
    },
    null,
    2,
  ),
);
// Única dependencia de runtime no embebida (binario de ripgrep).
mkdirSync(join(appDir, 'node_modules', '@vscode'), { recursive: true });
cpSync(
  join(root, 'node_modules', '@vscode', 'ripgrep'),
  join(appDir, 'node_modules', '@vscode', 'ripgrep'),
  { recursive: true },
);

// 3. Verificación de exclusiones: jamás empaquetar secretos ni datos de usuario.
const forbidden = ['.env', 'review', 'turnwise-store.json', 'mi-codex-store.json', 'userData'];
function scanFor(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (forbidden.includes(entry.name)) {
      console.error(`PACKAGE_FAIL exclusión violada: ${join(dir, entry.name)}`);
      process.exit(1);
    }
    if (entry.isDirectory()) scanFor(join(dir, entry.name));
  }
}
scanFor(staging);

// 4. Manifiesto AppX.
const manifest = `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
         xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
         xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
         IgnorableNamespaces="uap rescap">
  <Identity Name="Turnwise.Experiment" Publisher="CN=Turnwise-Dev" Version="0.2.0.0" />
  <Properties>
    <DisplayName>Turnwise</DisplayName>
    <PublisherDisplayName>Turnwise Dev</PublisherDisplayName>
    <Logo>assets\\storelogo.png</Logo>
    <Description>Agente de código de escritorio</Description>
  </Properties>
  <Resources>
    <Resource Language="es-ES" />
  </Resources>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
  <Applications>
    <Application Id="Turnwise" Executable="Turnwise.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements DisplayName="Turnwise" Description="Agente de código"
        BackgroundColor="transparent" Square150x150Logo="assets\\logo150.png" Square44x44Logo="assets\\logo44.png" />
    </Application>
  </Applications>
</Package>`;
writeFileSync(join(staging, 'AppxManifest.xml'), manifest);
mkdirSync(join(staging, 'assets'), { recursive: true });
for (const logo of ['logo44.png', 'logo150.png', 'storelogo.png']) {
  cpSync(join(root, 'assets', logo), join(staging, 'assets', logo));
}

// 5. makeappx.
const appxPath = join(outDir, 'Turnwise-0.2.0-unsigned.appx');
execFileSync(makeappx, ['pack', '/d', staging, '/p', appxPath, '/o'], { stdio: 'inherit' });

console.log(`PACKAGE_OK appx=${appxPath}`);
console.log('AVISO: artefacto SIN FIRMAR; para instalar requiere certificado (signtool) o modo desarrollador.');
