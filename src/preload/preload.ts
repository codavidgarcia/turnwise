import { contextBridge, ipcRenderer } from 'electron';

export interface ApprovalRequest {
  id: string;
  summary: string;
  kind: 'command' | 'write' | 'mcp';
}

contextBridge.exposeInMainWorld('turnwise', {
  configGet: () => ipcRenderer.invoke('turnwise:config:get'),
  configSet: (p: Record<string, unknown>) => ipcRenderer.invoke('turnwise:config:set', p),
  modelsList: () => ipcRenderer.invoke('turnwise:models:list'),
  providerTest: (p: Record<string, unknown>) => ipcRenderer.invoke('turnwise:provider:test', p),
  providerSet: (p: Record<string, unknown>) => ipcRenderer.invoke('turnwise:provider:set', p),
  workspacePick: () => ipcRenderer.invoke('turnwise:workspace:pick'),

  threadsList: () => ipcRenderer.invoke('turnwise:threads:list'),
  threadsCreate: (p?: { workspace?: string }) => ipcRenderer.invoke('turnwise:threads:create', p ?? {}),
  threadsGet: (threadId: string) => ipcRenderer.invoke('turnwise:threads:get', threadId),
  threadsDelete: (threadId: string) => ipcRenderer.invoke('turnwise:threads:delete', threadId),
  threadsRename: (threadId: string, title: string) =>
    ipcRenderer.invoke('turnwise:threads:rename', { threadId, title }),
  threadsSettings: (p: Record<string, unknown>) => ipcRenderer.invoke('turnwise:threads:settings', p),

  send: (threadId: string, text: string, attachmentIds?: string[]) =>
    ipcRenderer.invoke('turnwise:agent:send', { threadId, text, attachmentIds }),
  cancel: () => ipcRenderer.invoke('turnwise:agent:cancel'),
  respond: (id: string, approved: boolean) =>
    ipcRenderer.invoke('turnwise:approval:respond', { id, approved }),

  changesList: (threadId: string) => ipcRenderer.invoke('turnwise:changes:list', threadId),
  changesDiff: (threadId: string, turnIndex: number, path: string) =>
    ipcRenderer.invoke('turnwise:changes:diff', { threadId, turnIndex, path }),
  changesUndo: (threadId: string, turnIndex: number, path: string) =>
    ipcRenderer.invoke('turnwise:changes:undo', { threadId, turnIndex, path }),

  attachmentsAdd: (threadId: string) => ipcRenderer.invoke('turnwise:attachments:add', threadId),

  skills: () => ipcRenderer.invoke('turnwise:skills:list'),
  tasks: (threadId: string) => ipcRenderer.invoke('turnwise:tasks:list', threadId),

  mcpStatus: () => ipcRenderer.invoke('turnwise:mcp:status'),
  mcpConnect: (server: Record<string, unknown>) => ipcRenderer.invoke('turnwise:mcp:connect', server),
  mcpDisconnect: (name: string) => ipcRenderer.invoke('turnwise:mcp:disconnect', name),

  webSearch: (query: string) => ipcRenderer.invoke('turnwise:web:search', query),
  webFetch: (url: string) => ipcRenderer.invoke('turnwise:web:fetch', url),

  worktreeCreate: (branch: string) => ipcRenderer.invoke('turnwise:worktree:create', branch),
  worktreeList: () => ipcRenderer.invoke('turnwise:worktree:list'),
  sandboxLaunch: () => ipcRenderer.invoke('turnwise:sandbox:launch'),
  setTitlebar: (p: { color: string; symbolColor: string }) => ipcRenderer.invoke('turnwise:window:titlebar', p),

  onEvent: (cb: (evt: unknown) => void) => {
    ipcRenderer.on('turnwise:event', (_e, evt) => cb(evt));
  },
  onApproval: (cb: (req: ApprovalRequest) => void) => {
    ipcRenderer.on('turnwise:approval', (_e, req) => cb(req));
  },
});
