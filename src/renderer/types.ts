// Contrato del bridge `window.turnwise` (preload) visto desde el renderer.

export type Effort = 'low' | 'medium' | 'high';
export type PermissionMode = 'read-only' | 'ask' | 'full';

export interface AttachmentInfo {
  id: string;
  name: string;
  size: number;
  kind: 'text' | 'image' | 'other';
}

export interface FileChangeSummary {
  turnIndex: number;
  path: string;
  beforeHash: string;
  afterHash: string;
  undone: boolean;
  created: boolean;
  added: number;
  removed: number;
}

export interface DiffHunk {
  oldStart: number;
  newStart: number;
  lines: string[];
}

export interface DiffView {
  path: string;
  created: boolean;
  hunks: DiffHunk[];
  error?: string;
}

export interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface TaskInfo {
  id: string;
  text: string;
  status: string;
}

export interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  model: string;
  turns: number;
}

export interface TurnInfo {
  index: number;
  userText: string;
  startedAt?: string;
  finishedAt?: string | null;
}

export interface ThreadInfo {
  id: string;
  title: string;
  model: string;
  effort: Effort;
  permissionMode: PermissionMode;
  history: ChatMessage[];
  turns: TurnInfo[];
  tasks: TaskInfo[];
  attachments: AttachmentInfo[];
  error?: string;
}

export type ProviderKind = 'openai' | 'anthropic';

export interface ProviderDraft {
  provider: ProviderKind;
  baseUrl: string;
  /** Vacía = conservar la clave actual. */
  apiKey: string;
}

export interface ConfigInfo {
  provider: ProviderKind;
  baseUrl: string;
  apiKeySource: 'settings' | 'env' | 'none';
  /** Últimos 4 caracteres de la clave en uso, para reconocerla sin mostrarla. */
  apiKeyHint: string;
  model: string;
  models: string[];
  effort: Effort;
  workspace: string;
  permissionMode: PermissionMode;
  searchConfigured: boolean;
  searchUrl?: string;
  warning?: string | null;
}

export interface ApprovalRequest {
  id: string;
  summary: string;
  kind: 'command' | 'write' | 'mcp';
}

export interface McpStatus {
  name: string;
  connected: boolean;
  tools: string[];
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface AgentEvent {
  type: string;
  threadId?: string;
  text?: string;
  message?: string;
  name?: string;
  args?: string;
  callId?: string;
  output?: string;
  isError?: boolean;
  tasks?: TaskInfo[];
  path?: string;
  turnIndex?: number;
  statuses?: McpStatus[];
}

export interface TurnwiseApi {
  configGet: () => Promise<ConfigInfo>;
  configSet: (p: Record<string, unknown>) => Promise<unknown>;
  modelsList: () => Promise<{ models: string[]; error?: string }>;
  providerTest: (p: ProviderDraft) => Promise<{ ok: boolean; count?: number; error?: string }>;
  providerSet: (p: ProviderDraft) => Promise<{ ok: boolean; error?: string }>;
  workspacePick: () => Promise<{ path?: string; canceled?: boolean }>;
  threadsList: () => Promise<ThreadSummary[]>;
  threadsCreate: (p?: { workspace?: string }) => Promise<ThreadInfo>;
  threadsGet: (threadId: string) => Promise<ThreadInfo>;
  threadsDelete: (threadId: string) => Promise<{ ok: boolean }>;
  threadsRename: (threadId: string, title: string) => Promise<unknown>;
  threadsSettings: (p: Record<string, unknown>) => Promise<unknown>;
  send: (threadId: string, text: string, attachmentIds?: string[]) => Promise<{ ok: boolean; error?: string }>;
  cancel: () => Promise<unknown>;
  respond: (id: string, approved: boolean) => Promise<unknown>;
  changesList: (threadId: string) => Promise<FileChangeSummary[]>;
  changesDiff: (threadId: string, turnIndex: number, path: string) => Promise<DiffView>;
  changesUndo: (threadId: string, turnIndex: number, path: string) => Promise<{ ok: boolean; error?: string }>;
  attachmentsAdd: (threadId: string) => Promise<{ ok: boolean; attachment?: AttachmentInfo; error?: string }>;
  tasks: (threadId: string) => Promise<TaskInfo[]>;
  mcpStatus: () => Promise<McpStatus[]>;
  mcpConnect: (server: Record<string, unknown>) => Promise<{ connected: boolean; error?: string; tools: string[] }>;
  webSearch: (query: string) => Promise<SearchResult[]>;
  worktreeCreate: (branch: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
  sandboxLaunch: () => Promise<{ ok: boolean; message: string }>;
  setTitlebar: (p: { color: string; symbolColor: string }) => Promise<{ ok: boolean; error?: string }>;
  onEvent: (cb: (evt: AgentEvent) => void) => void;
  onApproval: (cb: (req: ApprovalRequest) => void) => void;
}

declare global {
  interface Window {
    turnwise: TurnwiseApi;
  }
}
