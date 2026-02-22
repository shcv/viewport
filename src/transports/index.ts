/**
 * Transport module index — default registry with all built-in transports.
 *
 * Usage:
 *   import { createDefaultRegistry } from './transports/index.js';
 *   const registry = createDefaultRegistry();
 *
 * The default registry includes:
 *   - net-socket: unix://, unix-abstract://, tcp://, tls://
 *   - stdio: stdio://
 *   - fd: fd://, pipe://
 *   - websocket: ws://, wss:// (stub — requires `ws` package)
 *
 * To add a custom transport:
 *   registry.registerConnector(myConnector);
 *   registry.registerListener(myListener);
 */

import { TransportRegistry } from '../core/transport-registry.js';
import { createNetSocketConnector, createNetSocketListener } from './net-socket.js';
import { createStdioConnector, createStdioListener } from './stdio.js';
import { createFdConnector } from './fd.js';
import { createWebSocketConnector, createWebSocketListener } from './websocket.js';

/**
 * Create a registry pre-loaded with all built-in transports.
 *
 * This is the standard entry point for both app and viewer code.
 */
export function createDefaultRegistry(): TransportRegistry {
  const registry = new TransportRegistry();

  // Net socket — unix, unix-abstract, tcp, tls
  registry.registerConnector(createNetSocketConnector());
  registry.registerListener(createNetSocketListener());

  // Stdio — stdio
  registry.registerConnector(createStdioConnector());
  registry.registerListener(createStdioListener());

  // File descriptor — fd, pipe (connector only; viewer creates the fd pair)
  registry.registerConnector(createFdConnector());

  // WebSocket — ws, wss (stub implementations)
  registry.registerConnector(createWebSocketConnector());
  registry.registerListener(createWebSocketListener());

  return registry;
}

// Re-export everything for convenient imports
export { TransportRegistry } from '../core/transport-registry.js';
export { createNetSocketConnector, createNetSocketListener } from './net-socket.js';
export { createStdioConnector, createStdioListener } from './stdio.js';
export { createFdConnector } from './fd.js';
export { createWebSocketConnector, createWebSocketListener } from './websocket.js';
export { createConnectionPair, createInProcessPair } from './in-process.js';
export type {
  TransportConnection,
  TransportConnector,
  TransportListener,
  ConnectOptions,
  ListenOptions,
  ListenResult,
  ConnectionInfo,
  TlsOptions,
  SelfRenderDriver,
  SelfRenderOptions,
} from '../core/transport-api.js';
