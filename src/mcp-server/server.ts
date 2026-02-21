/**
 * MCP server — stdio-based JSON-RPC server implementing the
 * Model Context Protocol for Viewport interaction.
 *
 * Agents connect via stdio and use tools to load apps, inspect
 * state, perform actions, and collect metrics.
 */

import { TOOL_DEFINITIONS, handleToolCall } from './tools.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class MCPServer {
  private buffer = '';

  /** Process a line of input (JSON-RPC message). */
  handleMessage(line: string): JsonRpcResponse | null {
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(line);
    } catch {
      return {
        jsonrpc: '2.0',
        id: 0,
        error: { code: -32700, message: 'Parse error' },
      };
    }

    if (request.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'viewport-harness',
            version: '0.1.0',
          },
        },
      };
    }

    if (request.method === 'notifications/initialized') {
      // No response needed for notifications
      return null;
    }

    if (request.method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          tools: TOOL_DEFINITIONS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        },
      };
    }

    if (request.method === 'tools/call') {
      const params = request.params as { name: string; arguments?: Record<string, unknown> };
      const result = handleToolCall(params.name, params.arguments ?? {});
      return {
        jsonrpc: '2.0',
        id: request.id,
        result,
      };
    }

    return {
      jsonrpc: '2.0',
      id: request.id,
      error: { code: -32601, message: `Method not found: ${request.method}` },
    };
  }

  /** Start the stdio server. */
  start(): void {
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (data: string) => {
      this.buffer += data;
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const response = this.handleMessage(trimmed);
        if (response) {
          process.stdout.write(JSON.stringify(response) + '\n');
        }
      }
    });

    process.stderr.write('Viewport MCP server started. Send JSON-RPC messages on stdin.\n');
  }
}
