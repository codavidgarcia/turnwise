// Persistencia de proyectos y conversaciones (threads) en JSON atómico versionado.
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  copyFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join, dirname, basename } from 'node:path';
import type { ChatMessage } from './llm.js';
import type { TaskItem } from './tools.js';
import type { Effort, PermissionMode } from './config.js';

export const STORE_VERSION = 1;

export interface AttachmentInfo {
  id: string;
  name: string;
  storedPath: string;
  size: number;
  kind: 'text' | 'image' | 'other';
}

export interface FileChange {
  path: string;
  before: string | null; // contenido previo; null = fichero creado
  after: string | null; // contenido tras el cambio; null = fichero borrado
  beforeHash: string;
  afterHash: string;
  undone: boolean;
}

export interface TurnRecord {
  index: number;
  userText: string;
  startedAt: string;
  finishedAt: string | null;
  summary: string;
  changes: FileChange[];
}

export interface Thread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  effort: Effort;
  permissionMode: PermissionMode;
  history: ChatMessage[]; // pares completos tool_call/tool para reanudar
  turns: TurnRecord[];
  tasks: TaskItem[];
  attachments: AttachmentInfo[];
  compactedThrough: number; // índice de history ya resumido
}

export interface Project {
  id: string;
  path: string;
  name: string;
  createdAt: string;
  threads: Thread[];
}

export interface StoreData {
  version: number;
  projects: Project[];
  activeThreadId: string | null;
}

/** Hasta la v0.2 el producto se llamaba "mi-codex": su carpeta de datos queda junto a la nueva. */
export const LEGACY_DATA_DIR = 'mi-codex';
export const LEGACY_STORE_FILE = 'mi-codex-store.json';
export const STORE_FILE = 'turnwise-store.json';

/**
 * Adopta el store del nombre anterior copiándolo (nunca moviéndolo) si el nuevo aún no existe.
 * Los adjuntos guardan rutas absolutas a la carpeta antigua, que se conserva intacta.
 */
export function adoptLegacyStore(legacyPath: string, targetPath: string): boolean {
  if (existsSync(targetPath) || !existsSync(legacyPath)) return false;
  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(legacyPath, targetPath);
  return true;
}

export function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class Store {
  private data: StoreData;

  constructor(private filePath: string) {
    this.data = this.load();
    mkdirSync(dirname(filePath), { recursive: true });
    this.flush();
  }

  private load(): StoreData {
    if (existsSync(this.filePath)) {
      try {
        const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as StoreData;
        if (parsed && Array.isArray(parsed.projects)) return parsed;
      } catch {
        // fichero corrupto: se conserva copia y se empieza limpio
        const backup = `${this.filePath}.corrupt-${Date.now()}`;
        copyFileSync(this.filePath, backup);
      }
    }
    return { version: STORE_VERSION, projects: [], activeThreadId: null };
  }

  flush(): void {
    this.data.version = STORE_VERSION;
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data), 'utf8');
    renameSync(tmp, this.filePath);
  }

  listProjects(): Project[] {
    return this.data.projects;
  }

  ensureProject(path: string, name: string): Project {
    let project = this.data.projects.find((p) => p.path === path);
    if (!project) {
      project = { id: newId('prj'), path, name, createdAt: nowIso(), threads: [] };
      this.data.projects.push(project);
      this.flush();
    }
    return project;
  }

  createThread(projectId: string, init: Partial<Thread> = {}): Thread | null {
    const project = this.data.projects.find((p) => p.id === projectId);
    if (!project) return null;
    const thread: Thread = {
      id: newId('thr'),
      title: init.title ?? 'Nueva conversación',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      model: init.model ?? '',
      effort: init.effort ?? 'medium',
      permissionMode: init.permissionMode ?? 'ask',
      history: [],
      turns: [],
      tasks: [],
      attachments: [],
      compactedThrough: 0,
    };
    project.threads.push(thread);
    this.data.activeThreadId = thread.id;
    this.flush();
    return thread;
  }

  findThread(threadId: string): Thread | null {
    for (const p of this.data.projects) {
      const t = p.threads.find((x) => x.id === threadId);
      if (t) return t;
    }
    return null;
  }

  findProjectOfThread(threadId: string): Project | null {
    for (const p of this.data.projects) {
      if (p.threads.some((t) => t.id === threadId)) return p;
    }
    return null;
  }

  deleteThread(threadId: string): boolean {
    for (const p of this.data.projects) {
      const i = p.threads.findIndex((t) => t.id === threadId);
      if (i >= 0) {
        p.threads.splice(i, 1);
        if (this.data.activeThreadId === threadId) this.data.activeThreadId = null;
        this.flush();
        return true;
      }
    }
    return false;
  }

  setActive(threadId: string | null): void {
    this.data.activeThreadId = threadId;
    this.flush();
  }

  getActive(): Thread | null {
    return this.data.activeThreadId ? this.findThread(this.data.activeThreadId) : null;
  }

  updateThread(threadId: string, mutator: (t: Thread) => void): Thread | null {
    const t = this.findThread(threadId);
    if (!t) return null;
    mutator(t);
    t.updatedAt = nowIso();
    this.flush();
    return t;
  }

  /** Adjunto copiado a almacenamiento propio del thread. */
  attachmentDir(threadId: string): string {
    return join(dirname(this.filePath), 'attachments', threadId);
  }

  storeAttachment(threadId: string, sourcePath: string): AttachmentInfo | null {
    const dir = this.attachmentDir(threadId);
    mkdirSync(dir, { recursive: true });
    const name = basename(sourcePath);
    const target = join(dir, `${newId('att')}-${name}`);
    try {
      copyFileSync(sourcePath, target);
    } catch {
      return null;
    }
    const size = statSync(target).size;
    const ext = name.toLowerCase().split('.').pop() ?? '';
    const kind: AttachmentInfo['kind'] = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)
      ? 'image'
      : ['txt', 'md', 'ts', 'js', 'json', 'csv', 'log', 'html', 'css', 'py', 'rs', 'go', 'java', 'c', 'h', 'cpp'].includes(ext)
        ? 'text'
        : 'other';
    const info: AttachmentInfo = {
      id: newId('att'),
      name,
      storedPath: target,
      size,
      kind,
    };
    this.updateThread(threadId, (t) => t.attachments.push(info));
    return info;
  }

  attachmentText(att: AttachmentInfo, maxChars = 20000): string | null {
    if (att.kind !== 'text') return null;
    try {
      return readFileSync(att.storedPath, 'utf8').slice(0, maxChars);
    } catch {
      return null;
    }
  }

  listAttachmentFiles(threadId: string): string[] {
    const dir = this.attachmentDir(threadId);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).map((f) => join(dir, f));
  }
}
