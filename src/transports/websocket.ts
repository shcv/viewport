/**
 * WebSocket transport — protocol over ws:// and wss://.
 *
 * This is a placeholder implementation. A real implementation would use
 * the `ws` package (Node) or the native WebSocket API (browser).
 *
 * WebSocket is a natural fit for Viewport because:
 *   - Binary message framing is built in (no manual frame alignment)
 *   - Works through HTTP proxies and firewalls
 *   - Browser-native for web-based viewers
 *   - Upgrade from HTTP for auth/session negotiation
 *
 * Each protocol frame is sent as one WebSocket binary message.
 * No additional framing layer needed — the WebSocket message boundaries
 * align with protocol frame boundaries.
 */

import type {
  TransportConnection,
  TransportConnector,
  TransportListener,
  ConnectOptions,
  ListenOptions,
  ListenResult,
  ConnectionInfo,
} from '../core/transport-api.js';
import type { TransportScheme, TransportAddress } from '../core/transport.js';

export class WebSocketConnector implements TransportConnector {
  readonly schemes: TransportScheme[] = ['ws', 'wss'];

  async connect(
    address: TransportAddress,
    options: ConnectOptions,
  ): Promise<TransportConnection> {
    if (address.type !== 'url') {
      throw new Error(`WebSocketConnector requires address type "url", got "${address.type}"`);
    }

    // TODO: Implement with `ws` package or native WebSocket
    // const ws = new WebSocket(address.url);
    // return new WebSocketConnection(ws, options.uri.scheme);
    throw new Error(
      `WebSocket transport not yet implemented. ` +
      `Install the "ws" package and implement WebSocketConnection.`,
    );
  }
}

export class WebSocketListener implements TransportListener {
  readonly schemes: TransportScheme[] = ['ws', 'wss'];
  private connectionHandlers: Array<(conn: TransportConnection) => void> = [];
  private errorHandlers: Array<(error: Error) => void> = [];

  async listen(
    address: TransportAddress,
    options: ListenOptions,
  ): Promise<ListenResult> {
    // TODO: Implement with `ws` package
    // const wss = new WebSocketServer({ host, port });
    throw new Error(
      `WebSocket listener not yet implemented. ` +
      `Install the "ws" package and implement WebSocketServer integration.`,
    );
  }

  onConnection(handler: (conn: TransportConnection) => void): void {
    this.connectionHandlers.push(handler);
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandlers.push(handler);
  }

  async close(): Promise<void> {}
}

export function createWebSocketConnector(): WebSocketConnector {
  return new WebSocketConnector();
}

export function createWebSocketListener(): WebSocketListener {
  return new WebSocketListener();
}
