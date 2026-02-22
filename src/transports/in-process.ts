/**
 * In-process transport — direct memory transfer, no IPC.
 *
 * Used for testing and for the embeddable viewer pattern where the app
 * and viewer run in the same process. Frames are passed by reference
 * (zero-copy) through a synchronous channel.
 *
 * This replaces the ad-hoc in-process wiring in the test harness with
 * a proper TransportConnection, making the harness consistent with
 * production transport paths.
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

// ── In-Process Connection Pair ───────────────────────────────────

class InProcessConnection implements TransportConnection {
  private messageHandlers: Array<(data: Uint8Array) => void> = [];
  private errorHandlers: Array<(error: Error) => void> = [];
  private closeHandlers: Array<() => void> = [];
  private _connected = true;

  /** The other end of this connection. Set after construction. */
  peer: InProcessConnection | null = null;

  readonly info: ConnectionInfo;

  constructor(scheme: TransportScheme, label: string) {
    this.info = {
      scheme,
      remoteAddress: label,
      connectedAt: Date.now(),
    };
  }

  get connected(): boolean {
    return this._connected;
  }

  send(data: Uint8Array): void {
    if (!this._connected) throw new Error('Connection is closed');
    if (!this.peer?._connected) throw new Error('Peer connection is closed');

    // Deliver directly to peer's handlers (synchronous, zero-copy)
    for (const handler of this.peer.messageHandlers) {
      handler(data);
    }
  }

  onMessage(handler: (data: Uint8Array) => void): void {
    this.messageHandlers.push(handler);
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandlers.push(handler);
  }

  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  close(): void {
    if (!this._connected) return;
    this._connected = false;
    for (const handler of this.closeHandlers) {
      handler();
    }
    // Close peer too
    if (this.peer?._connected) {
      this.peer.close();
    }
  }
}

/**
 * Create a connected pair of in-process transport connections.
 *
 * Messages sent on one end are delivered synchronously to the other.
 * This is the building block for in-process testing.
 */
export function createConnectionPair(
  scheme: TransportScheme = 'unix',
): [TransportConnection, TransportConnection] {
  const appSide = new InProcessConnection(scheme, 'viewer (in-process)');
  const viewerSide = new InProcessConnection(scheme, 'app (in-process)');
  appSide.peer = viewerSide;
  viewerSide.peer = appSide;
  return [appSide, viewerSide];
}

// ── In-Process "Listener" ────────────────────────────────────────

/**
 * In-process listener for testing. When connect() is called on the
 * connector, it creates a connection pair and emits the viewer side
 * via onConnection.
 */
export class InProcessListener implements TransportListener {
  readonly schemes: TransportScheme[] = ['unix', 'tcp', 'unix-abstract'];
  private connectionHandlers: Array<(conn: TransportConnection) => void> = [];
  private errorHandlers: Array<(error: Error) => void> = [];

  /** Pending connections from connector. */
  private pendingResolvers: Array<(conn: TransportConnection) => void> = [];

  async listen(
    _address: TransportAddress,
    _options: ListenOptions,
  ): Promise<ListenResult> {
    return {
      address: 'in-process',
      viewportUri: 'unix:///in-process',
    };
  }

  /**
   * Accept a connection. Called by InProcessConnector.
   * Returns the app-side connection.
   */
  accept(scheme: TransportScheme): TransportConnection {
    const [appSide, viewerSide] = createConnectionPair(scheme);
    for (const handler of this.connectionHandlers) {
      handler(viewerSide);
    }
    return appSide;
  }

  onConnection(handler: (conn: TransportConnection) => void): void {
    this.connectionHandlers.push(handler);
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandlers.push(handler);
  }

  async close(): Promise<void> {}
}

/**
 * In-process connector that pairs with an InProcessListener.
 */
export class InProcessConnector implements TransportConnector {
  readonly schemes: TransportScheme[] = ['unix', 'tcp', 'unix-abstract'];

  constructor(private listener: InProcessListener) {}

  async connect(
    _address: TransportAddress,
    options: ConnectOptions,
  ): Promise<TransportConnection> {
    return this.listener.accept(options.uri.scheme);
  }
}

export function createInProcessPair(): {
  connector: InProcessConnector;
  listener: InProcessListener;
} {
  const listener = new InProcessListener();
  const connector = new InProcessConnector(listener);
  return { connector, listener };
}
