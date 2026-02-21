export { MCPServer } from './server.js';
export { TOOL_DEFINITIONS, handleToolCall } from './tools.js';

// If run directly, start the server
const isMainModule = process.argv[1]?.endsWith('mcp-server/index.ts') ||
                     process.argv[1]?.endsWith('mcp-server/index.js');
if (isMainModule) {
  const server = new MCPServer();
  server.start();
}
