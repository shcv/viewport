/**
 * Transport API — standard interfaces for modular transport implementations.
 *
 * Both the viewer (listener) and app (connector) sides use these interfaces.
 * Each transport scheme (unix, tcp, ws, etc.) provides an implementation of
 * TransportConnector and/or TransportListener. The transport registry maps
 * schemes to implementations.
 *
 * The transport layer deals in raw framed bytes — protocol encoding/decoding
 * happens above this layer.
 *
 * Architecture:
 *   App side:    resolveOutputMode() → registry.connect(uri) → TransportConnection
 *   Viewer side: config → registry.listen(uri) → onConnection → TransportConnection
 */

import type { TransportScheme, TransportAddress, ParsedViewportUri } from './transport.js';

// ── Connection ───────────────────────────────────────────────────

/**
 * A live bidirectional connection between an app and a viewer.
 *
 * Messages are protocol frames (8-byte header + CBOR payload). The transport
 * handles framing over the underlying byte stream — callers send/receive
 * complete frames.
 */
export interface TransportConnection {
  /** Send a complete protocol frame. */
  send(data: Uint8Array): void;

  /** Register handler for incoming protocol frames. */
  onMessage(handler: (data: Uint8Array) => void): void;

  /** Register handler for connection errors. */
  onError(handler: (error: Error) => void): void;

  /** Register handler for connection close. */
  onClose(handler: () => void): void;

  /** Close the connection. */
  close(): void;

  /** Whether the connection is currently open. */
  readonly connected: boolean;

  /** Metadata about this connection. */
  readonly info: ConnectionInfo;
}

export interface ConnectionInfo {
  /** The transport scheme used. */
  scheme: TransportScheme;
  /** Human-readable description of the remote endpoint. */
  remoteAddress: string;
  /** When the connection was established. */
  connectedAt: number;
}

// ── Connector (app side) ─────────────────────────────────────────

/**
 * Opens a connection to a viewer. One implementation per transport scheme.
 *
 * Apps use connectors to establish a TransportConnection to an external
 * viewer. The connector handles scheme-specific setup (socket creation,
 * TLS handshake, WebSocket upgrade, etc.).
 */
export interface TransportConnector {
  /** Which scheme(s) this connector handles. */
  readonly schemes: TransportScheme[];

  /**
   * Open a connection to the viewer at the given address.
   * The parsed URI provides scheme-specific parameters.
   */
  connect(
    address: TransportAddress,
    options: ConnectOptions,
  ): Promise<TransportConnection>;

  /** Clean up any resources (e.g., DNS resolver cache). */
  destroy?(): void;
}

export interface ConnectOptions {
  /** The original parsed URI (for scheme-specific params). */
  uri: ParsedViewportUri;
  /** Connection timeout in ms. 0 = no timeout. */
  timeoutMs?: number;
  /** TLS options (for tls:// and wss://). */
  tls?: TlsOptions;
}

// ── Listener (viewer side) ───────────────────────────────────────

/**
 * Accepts connections from apps. One implementation per transport scheme.
 *
 * Viewers use listeners to accept incoming TransportConnections from apps.
 * The listener handles scheme-specific setup (socket binding, TLS
 * certificate loading, WebSocket upgrade, etc.).
 */
export interface TransportListener {
  /** Which scheme(s) this listener handles. */
  readonly schemes: TransportScheme[];

  /**
   * Start listening for connections.
   * Returns the resolved listen address (useful when port 0 is used).
   */
  listen(
    address: TransportAddress,
    options: ListenOptions,
  ): Promise<ListenResult>;

  /** Register handler for new connections. */
  onConnection(handler: (conn: TransportConnection) => void): void;

  /** Register handler for listener errors (e.g., address in use). */
  onError(handler: (error: Error) => void): void;

  /** Stop listening and close all accepted connections. */
  close(): Promise<void>;
}

export interface ListenOptions {
  /** The original parsed URI (for scheme-specific params). */
  uri: ParsedViewportUri;
  /** TLS options (for tls:// and wss://). */
  tls?: TlsOptions;
  /** Maximum number of concurrent connections. 0 = unlimited. */
  maxConnections?: number;
}

export interface ListenResult {
  /** The resolved address the listener is bound to. */
  address: string;
  /**
   * The VIEWPORT URI that apps should use to connect.
   * Suitable for setting as the VIEWPORT env var.
   */
  viewportUri: string;
}

// ── TLS ──────────────────────────────────────────────────────────

export interface TlsOptions {
  cert?: string;    // path to certificate file
  key?: string;     // path to private key file
  ca?: string;      // path to CA certificate file
  insecure?: boolean; // skip certificate verification
}

// ── Self-Rendering Driver ────────────────────────────────────────

/**
 * For self-rendering modes (text, ansi, headless), there's no transport
 * connection. Instead, the app embeds a rendering driver that handles
 * output directly.
 *
 * This interface is the "local" counterpart to TransportConnection.
 * It receives the same protocol messages but renders them locally
 * instead of sending them over the wire.
 */
export interface SelfRenderDriver {
  /** Which output mode this driver handles. */
  readonly mode: 'text' | 'ansi' | 'headless';

  /** Initialize the driver. */
  init(options: SelfRenderOptions): void;

  /** Process a protocol frame locally (same as what would be sent over wire). */
  processFrame(data: Uint8Array): void;

  /** Get the current text projection. */
  getTextProjection(): string;

  /** Tear down (restore terminal state, etc.). */
  destroy(): void;
}

export interface SelfRenderOptions {
  /** Display width in logical pixels. */
  width: number;
  /** Display height in logical pixels. */
  height: number;
  /** For ansi mode: use alternate screen buffer. */
  altScreen?: boolean;
  /** For ansi mode: target frame rate. */
  fps?: number;
  /** File descriptor for output (default: 1 = stdout). */
  outputFd?: number;
}
