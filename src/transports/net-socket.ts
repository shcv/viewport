/**
 * Net socket transport — handles unix://, unix-abstract://, tcp://, and tls://.
 *
 * All four schemes use Node's `net` module (or `tls` for encrypted connections).
 * The only difference is the connect/listen address format:
 *   - unix://    → { path: '/tmp/sock' }
 *   - unix-abstract:// → { path: '\0name' }
 *   - tcp://     → { host, port }
 *   - tls://     → { host, port } + TLS options
 */

import * as net from 'node:net';
import * as tls from 'node:tls';
import * as fs from 'node:fs';
import { MAGIC } from '../core/types.js';
import type {
  TransportConnection,
  TransportConnector,
  TransportListener,
  ConnectOptions,
  ListenOptions,
  ListenResult,
  ConnectionInfo,
  TlsOptions,
} from '../core/transport-api.js';
import type { TransportScheme, TransportAddress } from '../core/transport.js';

// ── Frame Reader ─────────────────────────────────────────────────

/**
 * Accumulates bytes from a stream and emits complete protocol frames.
 *
 * Protocol frames: 2-byte magic + 1-byte version + 1-byte type + 4-byte LE length
 *   + 8-byte session + 8-byte seq + payload.
 * Total header: 24 bytes.
 */
class FrameReader {
  private static readonly HEADER_SIZE = 24;
  private buffer: Buffer = Buffer.alloc(0);
  private handler: ((frame: Uint8Array) => void) | null = null;

  onFrame(handler: (frame: Uint8Array) => void): void {
    this.handler = handler;
  }

  push(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.drain();
  }

  private drain(): void {
    while (this.buffer.length >= FrameReader.HEADER_SIZE) {
      // Read header
      const magic = (this.buffer[0] << 8) | this.buffer[1];
      if (magic !== MAGIC) {
        // Misaligned — skip byte and try again
        this.buffer = this.buffer.subarray(1);
        continue;
      }

      const payloadLength = this.buffer.readUInt32LE(4);
      const frameLength = FrameReader.HEADER_SIZE + payloadLength;

      if (this.buffer.length < frameLength) {
        break; // incomplete frame, wait for more data
      }

      const frame = new Uint8Array(this.buffer.subarray(0, frameLength));
      this.buffer = this.buffer.subarray(frameLength);
      this.handler?.(frame);
    }
  }
}

// ── Socket Connection ────────────────────────────────────────────

/**
 * TransportConnection backed by a Node net.Socket or tls.TLSSocket.
 * Handles frame alignment over the byte stream.
 */
class SocketConnection implements TransportConnection {
  private messageHandlers: Array<(data: Uint8Array) => void> = [];
  private errorHandlers: Array<(error: Error) => void> = [];
  private closeHandlers: Array<() => void> = [];
  private frameReader = new FrameReader();
  private _connected = true;

  readonly info: ConnectionInfo;

  constructor(
    private socket: net.Socket,
    scheme: TransportScheme,
    remoteAddress: string,
  ) {
    this.info = {
      scheme,
      remoteAddress,
      connectedAt: Date.now(),
    };

    this.frameReader.onFrame((frame) => {
      for (const handler of this.messageHandlers) {
        handler(frame);
      }
    });

    socket.on('data', (chunk: Buffer) => {
      this.frameReader.push(chunk);
    });

    socket.on('error', (err: Error) => {
      for (const handler of this.errorHandlers) {
        handler(err);
      }
    });

    socket.on('close', () => {
      this._connected = false;
      for (const handler of this.closeHandlers) {
        handler();
      }
    });
  }

  get connected(): boolean {
    return this._connected && !this.socket.destroyed;
  }

  send(data: Uint8Array): void {
    if (!this.connected) {
      throw new Error('Connection is closed');
    }
    this.socket.write(data);
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
    this._connected = false;
    this.socket.end();
  }
}

// ── Connector ────────────────────────────────────────────────────

function resolveNetOptions(
  address: TransportAddress,
): net.NetConnectOpts {
  switch (address.type) {
    case 'path':
      return { path: address.path };
    case 'name':
      // Abstract socket: prepend NUL byte
      return { path: `\0${address.name}` };
    case 'host':
      return { host: address.host, port: address.port };
    default:
      throw new Error(`NetSocketConnector does not handle address type "${address.type}"`);
  }
}

function describeAddress(address: TransportAddress): string {
  switch (address.type) {
    case 'path': return address.path;
    case 'name': return address.name;
    case 'host': return `${address.host}:${address.port}`;
    default: return 'unknown';
  }
}

export class NetSocketConnector implements TransportConnector {
  readonly schemes: TransportScheme[] = ['unix', 'unix-abstract', 'tcp', 'tls'];

  async connect(
    address: TransportAddress,
    options: ConnectOptions,
  ): Promise<TransportConnection> {
    const scheme = options.uri.scheme;
    const netOpts = resolveNetOptions(address);

    return new Promise((resolve, reject) => {
      let socket: net.Socket;

      if (scheme === 'tls') {
        const tlsOpts: tls.ConnectionOptions = {
          ...netOpts,
          rejectUnauthorized: !options.tls?.insecure,
        };
        if (options.tls?.ca) {
          tlsOpts.ca = fs.readFileSync(options.tls.ca);
        }
        if (options.tls?.cert) {
          tlsOpts.cert = fs.readFileSync(options.tls.cert);
        }
        if (options.tls?.key) {
          tlsOpts.key = fs.readFileSync(options.tls.key);
        }
        socket = tls.connect(tlsOpts as tls.ConnectionOptions);
      } else {
        socket = net.createConnection(netOpts);
      }

      const timeout = options.timeoutMs ?? 10_000;
      if (timeout > 0) {
        socket.setTimeout(timeout);
        socket.once('timeout', () => {
          socket.destroy(new Error(`Connection timeout after ${timeout}ms`));
        });
      }

      socket.once('connect', () => {
        socket.setTimeout(0); // clear connect timeout
        resolve(new SocketConnection(socket, scheme, describeAddress(address)));
      });

      socket.once('error', (err) => {
        reject(err);
      });
    });
  }
}

// ── Listener ─────────────────────────────────────────────────────

export class NetSocketListener implements TransportListener {
  readonly schemes: TransportScheme[] = ['unix', 'unix-abstract', 'tcp', 'tls'];

  private server: net.Server | null = null;
  private connectionHandlers: Array<(conn: TransportConnection) => void> = [];
  private errorHandlers: Array<(error: Error) => void> = [];
  private activeScheme: TransportScheme = 'tcp';

  async listen(
    address: TransportAddress,
    options: ListenOptions,
  ): Promise<ListenResult> {
    this.activeScheme = options.uri.scheme;

    if (options.uri.scheme === 'tls') {
      const tlsOpts: tls.TlsOptions = {
        rejectUnauthorized: !options.tls?.insecure,
      };
      if (options.tls?.cert) {
        tlsOpts.cert = fs.readFileSync(options.tls.cert);
      }
      if (options.tls?.key) {
        tlsOpts.key = fs.readFileSync(options.tls.key);
      }
      if (options.tls?.ca) {
        tlsOpts.ca = fs.readFileSync(options.tls.ca);
      }
      this.server = tls.createServer(tlsOpts);
    } else {
      this.server = net.createServer();
    }

    // Clean up stale Unix socket files
    if (address.type === 'path') {
      try { fs.unlinkSync(address.path); } catch { /* ignore */ }
    }

    this.server.on('connection', (socket: net.Socket) => {
      const conn = new SocketConnection(
        socket,
        this.activeScheme,
        socket.remoteAddress
          ? `${socket.remoteAddress}:${socket.remotePort}`
          : describeAddress(address),
      );
      for (const handler of this.connectionHandlers) {
        handler(conn);
      }
    });

    this.server.on('error', (err: Error) => {
      for (const handler of this.errorHandlers) {
        handler(err);
      }
    });

    const listenOpts = resolveNetOptions(address);
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      if ('path' in listenOpts) {
        this.server!.listen(listenOpts.path, () => {
          this.server!.removeListener('error', reject);
          resolve();
        });
      } else {
        this.server!.listen(listenOpts.port, listenOpts.host, () => {
          this.server!.removeListener('error', reject);
          resolve();
        });
      }
    });

    // Set socket file permissions (owner-only)
    if (address.type === 'path') {
      fs.chmodSync(address.path, 0o600);
    }

    return {
      address: this.resolvedAddress(address),
      viewportUri: this.resolvedUri(address),
    };
  }

  onConnection(handler: (conn: TransportConnection) => void): void {
    this.connectionHandlers.push(handler);
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandlers.push(handler);
  }

  async close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private resolvedAddress(address: TransportAddress): string {
    if (address.type === 'host') {
      const addr = this.server?.address();
      if (addr && typeof addr === 'object') {
        return `${addr.address}:${addr.port}`;
      }
    }
    return describeAddress(address);
  }

  private resolvedUri(address: TransportAddress): string {
    switch (this.activeScheme) {
      case 'unix':
        return `unix://${address.type === 'path' ? address.path : ''}`;
      case 'unix-abstract':
        return `unix-abstract://${address.type === 'name' ? address.name : ''}`;
      case 'tcp':
      case 'tls': {
        const resolved = this.server?.address();
        if (resolved && typeof resolved === 'object') {
          const host = resolved.family === 'IPv6'
            ? `[${resolved.address}]`
            : resolved.address;
          return `${this.activeScheme}://${host}:${resolved.port}`;
        }
        return `${this.activeScheme}://${describeAddress(address)}`;
      }
      default:
        return `${this.activeScheme}://${describeAddress(address)}`;
    }
  }
}

/** Create the default net socket connector (handles unix, unix-abstract, tcp, tls). */
export function createNetSocketConnector(): NetSocketConnector {
  return new NetSocketConnector();
}

/** Create the default net socket listener (handles unix, unix-abstract, tcp, tls). */
export function createNetSocketListener(): NetSocketListener {
  return new NetSocketListener();
}
