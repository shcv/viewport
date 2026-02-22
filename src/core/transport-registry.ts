/**
 * Transport Registry — maps URI schemes to connector/listener implementations.
 *
 * Both the viewer and app side use a TransportRegistry to look up the right
 * transport implementation for a given VIEWPORT URI scheme. This is the
 * central extension point for adding new transports.
 *
 * Usage (app side):
 *   const registry = createDefaultRegistry();
 *   const mode = resolveOutputMode();
 *   if (mode.type === 'viewer') {
 *     const conn = await registry.connect(mode.transport.uri);
 *   }
 *
 * Usage (viewer side):
 *   const registry = createDefaultRegistry();
 *   const result = await registry.listen('unix:///tmp/viewport.sock');
 *   registry.onConnection(conn => { ... });
 */

import type {
  TransportConnector,
  TransportListener,
  TransportConnection,
  ConnectOptions,
  ListenOptions,
  ListenResult,
} from './transport-api.js';
import type { TransportScheme } from './transport.js';
import { parseViewportUri, resolveAddress, ViewportUriError } from './transport.js';

export class TransportRegistry {
  private connectors = new Map<TransportScheme, TransportConnector>();
  private listeners = new Map<TransportScheme, TransportListener>();

  // ── Registration ─────────────────────────────────────────────

  /**
   * Register a transport connector (app side).
   * A single connector can handle multiple schemes (e.g., unix + unix-abstract).
   */
  registerConnector(connector: TransportConnector): void {
    for (const scheme of connector.schemes) {
      this.connectors.set(scheme, connector);
    }
  }

  /**
   * Register a transport listener (viewer side).
   * A single listener can handle multiple schemes.
   */
  registerListener(listener: TransportListener): void {
    for (const scheme of listener.schemes) {
      this.listeners.set(scheme, listener);
    }
  }

  // ── Lookup ───────────────────────────────────────────────────

  /** Get the connector for a scheme, or undefined if not registered. */
  getConnector(scheme: TransportScheme): TransportConnector | undefined {
    return this.connectors.get(scheme);
  }

  /** Get the listener for a scheme, or undefined if not registered. */
  getListener(scheme: TransportScheme): TransportListener | undefined {
    return this.listeners.get(scheme);
  }

  /** List all registered connector schemes. */
  get connectorSchemes(): TransportScheme[] {
    return [...this.connectors.keys()];
  }

  /** List all registered listener schemes. */
  get listenerSchemes(): TransportScheme[] {
    return [...this.listeners.keys()];
  }

  // ── High-Level Operations ────────────────────────────────────

  /**
   * Connect to a viewer using a VIEWPORT URI string.
   *
   * Parses the URI, looks up the connector for the scheme, and opens
   * a connection. Throws if the scheme is not registered or is a
   * self-rendering mode.
   */
  async connect(
    viewportUri: string,
    options?: Partial<ConnectOptions>,
  ): Promise<TransportConnection> {
    const parsed = parseViewportUri(viewportUri);
    const address = resolveAddress(parsed);

    const connector = this.connectors.get(parsed.scheme);
    if (!connector) {
      throw new ViewportUriError(
        `No connector registered for scheme "${parsed.scheme}". ` +
        `Available: ${[...this.connectors.keys()].join(', ') || 'none'}`,
      );
    }

    return connector.connect(address, {
      uri: parsed,
      timeoutMs: options?.timeoutMs,
      tls: options?.tls,
    });
  }

  /**
   * Start listening for connections on a VIEWPORT URI string.
   *
   * Parses the URI, looks up the listener for the scheme, and starts
   * accepting connections. Returns the resolved listen address.
   */
  async listen(
    viewportUri: string,
    options?: Partial<ListenOptions>,
  ): Promise<ListenResult> {
    const parsed = parseViewportUri(viewportUri);
    const address = resolveAddress(parsed);

    const listener = this.listeners.get(parsed.scheme);
    if (!listener) {
      throw new ViewportUriError(
        `No listener registered for scheme "${parsed.scheme}". ` +
        `Available: ${[...this.listeners.keys()].join(', ') || 'none'}`,
      );
    }

    return listener.listen(address, {
      uri: parsed,
      tls: options?.tls,
      maxConnections: options?.maxConnections,
    });
  }

  /**
   * Register a handler for new connections on all active listeners.
   */
  onConnection(handler: (conn: TransportConnection) => void): void {
    for (const listener of new Set(this.listeners.values())) {
      listener.onConnection(handler);
    }
  }

  /**
   * Close all active listeners and clean up connectors.
   */
  async closeAll(): Promise<void> {
    const seen = new Set<TransportListener>();
    const promises: Promise<void>[] = [];

    for (const listener of this.listeners.values()) {
      if (!seen.has(listener)) {
        seen.add(listener);
        promises.push(listener.close());
      }
    }
    await Promise.all(promises);

    for (const connector of new Set(this.connectors.values())) {
      connector.destroy?.();
    }
  }
}

/**
 * Create a new empty registry. Call registerXxx() to add transports.
 *
 * For a registry pre-loaded with built-in transports, use
 * createDefaultRegistry() from src/transports/index.ts.
 */
export function createRegistry(): TransportRegistry {
  return new TransportRegistry();
}
