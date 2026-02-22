/**
 * Stdio transport — protocol messages on stdin/stdout.
 *
 * Used for Tier 1 mode where the app writes structured output to stdout
 * and reads input events from stdin. This is useful when the viewer
 * already owns the PTY.
 *
 * When magic detection is enabled (default), protocol frames are prefixed
 * with the VP magic bytes so the viewer can distinguish them from regular
 * text output.
 */

import { MAGIC } from '../core/types.js';
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

// ── Frame Reader (same logic as net-socket, shared) ──────────────

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
      const magic = (this.buffer[0] << 8) | this.buffer[1];
      if (magic !== MAGIC) {
        this.buffer = this.buffer.subarray(1);
        continue;
      }
      const payloadLength = this.buffer.readUInt32LE(4);
      const frameLength = FrameReader.HEADER_SIZE + payloadLength;
      if (this.buffer.length < frameLength) break;
      const frame = new Uint8Array(this.buffer.subarray(0, frameLength));
      this.buffer = this.buffer.subarray(frameLength);
      this.handler?.(frame);
    }
  }
}

// ── Stdio Connection ─────────────────────────────────────────────

class StdioConnection implements TransportConnection {
  private messageHandlers: Array<(data: Uint8Array) => void> = [];
  private errorHandlers: Array<(error: Error) => void> = [];
  private closeHandlers: Array<() => void> = [];
  private frameReader = new FrameReader();
  private _connected = true;

  readonly info: ConnectionInfo;

  constructor(
    private input: NodeJS.ReadableStream,
    private output: NodeJS.WritableStream,
    scheme: TransportScheme,
  ) {
    this.info = {
      scheme,
      remoteAddress: 'stdio',
      connectedAt: Date.now(),
    };

    this.frameReader.onFrame((frame) => {
      for (const handler of this.messageHandlers) {
        handler(frame);
      }
    });

    input.on('data', (chunk: Buffer) => {
      this.frameReader.push(chunk);
    });

    input.on('end', () => {
      this._connected = false;
      for (const handler of this.closeHandlers) {
        handler();
      }
    });

    input.on('error', (err: Error) => {
      for (const handler of this.errorHandlers) {
        handler(err);
      }
    });
  }

  get connected(): boolean {
    return this._connected;
  }

  send(data: Uint8Array): void {
    if (!this._connected) {
      throw new Error('Connection is closed');
    }
    // Write raw frame — magic bytes already present in the frame header
    this.output.write(data);
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
    // Don't close process.stdin/stdout — just stop reading
  }
}

// ── Connector ────────────────────────────────────────────────────

export class StdioConnector implements TransportConnector {
  readonly schemes: TransportScheme[] = ['stdio'];

  async connect(
    _address: TransportAddress,
    options: ConnectOptions,
  ): Promise<TransportConnection> {
    return new StdioConnection(process.stdin, process.stdout, options.uri.scheme);
  }
}

// ── Listener ─────────────────────────────────────────────────────

export class StdioListener implements TransportListener {
  readonly schemes: TransportScheme[] = ['stdio'];
  private connectionHandlers: Array<(conn: TransportConnection) => void> = [];
  private errorHandlers: Array<(error: Error) => void> = [];

  async listen(
    _address: TransportAddress,
    options: ListenOptions,
  ): Promise<ListenResult> {
    // Stdio "listening" just means we accept the current stdin/stdout
    const conn = new StdioConnection(process.stdin, process.stdout, options.uri.scheme);

    // Emit the connection immediately
    queueMicrotask(() => {
      for (const handler of this.connectionHandlers) {
        handler(conn);
      }
    });

    return {
      address: 'stdio',
      viewportUri: 'stdio:',
    };
  }

  onConnection(handler: (conn: TransportConnection) => void): void {
    this.connectionHandlers.push(handler);
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandlers.push(handler);
  }

  async close(): Promise<void> {
    // Nothing to close — we don't own stdin/stdout
  }
}

export function createStdioConnector(): StdioConnector {
  return new StdioConnector();
}

export function createStdioListener(): StdioListener {
  return new StdioListener();
}
