// Worktrees de git y lanzamiento de Windows Sandbox para ejecución aislada del SO.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const execFileAsync = promisify(execFile);

export interface WorktreeInfo {
  branch: string;
  path: string;
}

/** Crea un worktree aislado con rama nueva dentro de <workspace>/.worktrees. */
export async function createWorktree(
  workspace: string,
  branch: string,
): Promise<WorktreeInfo> {
  const safeBranch = branch.replace(/[^a-zA-Z0-9._/-]/g, '-').slice(0, 60) || 'turnwise';
  const path = resolve(workspace, '.worktrees', safeBranch);
  if (existsSync(path)) throw new Error(`El worktree ya existe: ${path}`);
  mkdirSync(join(workspace, '.worktrees'), { recursive: true });
  await execFileAsync(
    'git',
    ['worktree', 'add', '-b', safeBranch, path],
    { cwd: workspace, timeout: 60000, windowsHide: true },
  );
  return { branch: safeBranch, path };
}

export async function listWorktrees(workspace: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
      cwd: workspace,
      timeout: 15000,
      windowsHide: true,
    });
    return stdout
      .split(/\r?\n/)
      .filter((l) => l.startsWith('worktree '))
      .map((l) => l.slice('worktree '.length));
  } catch {
    return [];
  }
}

export interface SandboxResult {
  ok: boolean;
  message: string;
  wsbPath?: string;
}

/**
 * Lanza Windows Sandbox con el workspace montado en solo lectura y una carpeta
 * de artefactos escribible. Si la función del SO no está disponible, lo dice
 * explícitamente: no promete aislamiento en línea.
 */
export async function launchWindowsSandbox(
  workspace: string,
  command?: string,
): Promise<SandboxResult> {
  const sandboxExe = 'WindowsSandbox.exe';
  const available = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `if (Get-Command ${sandboxExe} -ErrorAction SilentlyContinue) { 'yes' } else { 'no' }`,
  ]).then((r) => r.stdout.trim() === 'yes').catch(() => false);
  if (!available) {
    return {
      ok: false,
      message:
        'Windows Sandbox no está disponible en este equipo (función de Windows opcional, ediciones Pro/Enterprise). No se ejecutó nada aislado.',
    };
  }
  const outDir = join(workspace, '.sandbox-out');
  mkdirSync(outDir, { recursive: true });
  const wsbPath = join(outDir, 'turnwise.wsb');
  const cmd = command
    ? `<Command>powershell.exe -NoProfile -Command "${command.replace(/"/g, '&quot;')}"</Command>`
    : '';
  const xml = `<Configuration>
  <MappedFolders>
    <MappedFolder><HostFolder>${workspace}</HostFolder><SandboxFolder>C:\\proyecto</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>${outDir}</HostFolder><SandboxFolder>C:\\salida</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  ${cmd}
</Configuration>`;
  writeFileSync(wsbPath, xml, 'utf8');
  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Start-Process ${sandboxExe} -ArgumentList '${wsbPath}'`,
  ]);
  return {
    ok: true,
    message: 'Windows Sandbox iniciado con el proyecto en solo lectura y C:\\salida para artefactos.',
    wsbPath,
  };
}
