// Cliente MCP: servidores stdio y Streamable HTTP mediante el SDK oficial.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpServerConfig } from './config.js';
import type { ApprovalKind, ToolDef, ToolResult } from './tools.js';

export interface McpServerStatus {
  name: string;
  transport: 'stdio' | 'http';
  enabled: boolean;
  connected: boolean;
  tools: string[];
  error?: string;
}

interface McpConnection {
  client: Client;
  tools: ToolDef[];
  status: McpServerStatus;
}

const MAX_MCP_OUTPUT = 20000;

export class McpManager {
  private connections = new Map<string, McpConnection>();

  async connect(server: McpServerConfig): Promise<McpServerStatus> {
    await this.disconnect(server.name);
    const status: McpServerStatus = {
      name: server.name,
      transport: server.transport,
      enabled: server.enabled,
      connected: false,
      tools: [],
    };
    if (!server.enabled) return status;

    const client = new Client({ name: 'turnwise', version: '0.2.0' });
    try {
      if (server.transport === 'stdio') {
        if (!server.command) throw new Error('Falta command para servidor stdio');
        const transport = new StdioClientTransport({
          command: server.command,
          args: server.args ?? [],
          stderr: 'ignore',
        });
        await client.connect(transport);
      } else {
        if (!server.url) throw new Error('Falta url para servidor http');
        const transport = new StreamableHTTPClientTransport(new URL(server.url));
        await client.connect(transport);
      }
    } catch (e) {
      status.error = (e as Error).message;
      return status;
    }

    const tools: ToolDef[] = [];
    try {
      const listed = await client.listTools();
      for (const t of listed.tools ?? []) {
        const name = `mcp_${server.name}_${t.name}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 64);
        status.tools.push(t.name);
        tools.push({
          spec: {
            name,
            description: `[MCP:${server.name}] ${t.description ?? t.name}`,
            parameters: (t.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
          },
          run: async (args, ctx): Promise<ToolResult> => {
            const denied = await ctxGate(ctx, `Herramienta MCP ${server.name}/${t.name}: ${JSON.stringify(args).slice(0, 300)}`);
            if (denied) return denied;
            try {
              const res = await client.callTool({ name: t.name, arguments: args });
              const text = (res.content as Array<{ type: string; text?: string }>)
                .map((c) => (c.type === 'text' ? (c.text ?? '') : `[${c.type}]`))
                .join('\n')
                .slice(0, MAX_MCP_OUTPUT);
              return {
                output: text || '(sin salida)',
                isError: !!res.isError,
              };
            } catch (e) {
              return { output: `MCP error: ${(e as Error).message}`, isError: true };
            }
          },
        });
      }
      status.connected = true;
      this.connections.set(server.name, { client, tools, status });
    } catch (e) {
      status.error = (e as Error).message;
      await client.close().catch(() => {});
    }
    return status;
  }

  async disconnect(name: string): Promise<void> {
    const conn = this.connections.get(name);
    if (conn) {
      await conn.client.close().catch(() => {});
      this.connections.delete(name);
    }
  }

  async disconnectAll(): Promise<void> {
    for (const name of [...this.connections.keys()]) await this.disconnect(name);
  }

  statuses(): McpServerStatus[] {
    return [...this.connections.values()].map((c) => c.status);
  }

  tools(): ToolDef[] {
    return [...this.connections.values()].flatMap((c) => c.tools);
  }
}

// Pequeño atajo para no duplicar la puerta de permisos (tools.ts la exporta).
import { gate } from './tools.js';
async function ctxGate(
  ctx: Parameters<ToolDef['run']>[1],
  summary: string,
): Promise<ToolResult | null> {
  return gate(ctx, 'mcp' as ApprovalKind, summary);
}
