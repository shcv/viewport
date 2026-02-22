/**
 * File descriptor transport — protocol over an inherited fd.
 *
 * Handles fd:// and pipe:// schemes. The parent process creates a
 * socketpair or pipe, passes one end as an open fd number via exec,
 * and sets VIEWPORT=fd://N.
 *
 * This transport wraps the fd in a net.Socket for stream handling.
 */

import * as net from 'node:net';
import { MAGIC } from '../core/types.js';
import type {
  TransportConnection,
  TransportConnector,
  ConnectOptions,
  ConnectionInfo,
} from '../core/transport-api.js';
import type { TransportScheme, TransportAddress } from '../core/transport.js';

// ── Frame Reader ─────────────────────────────────────────────────

class FrameReader {
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
    while (this.buffer.length >= 8) {
      const magic = (this.buffer[0] << 8) | this.buffer[1];
      if (magic !== MAGIC) {
        this.buffer = this.buffer.subarray(1);
        continue;
      }
      const payloadLength = this.buffer.readUInt32LE(4);
      const frameLength = 8 + payloadLength;
      if (this.buffer.length < frameLength) break;
      const frame = new Uint8Array(this.buffer.subarray(0, frameLength));
      this.buffer = this.buffer.subarray(frameLength);
      this.handler?.(frame);
    }
  }
}

// ── FD Connection ────────────────────────────────────────────────

class FdConnection implements TransportConnection {
  private messageHandlers: Array<(data: Uint8Array) => void> = [];
  private errorHandlers: Array<(error: Error) => void> = [];
  private closeHandlers: Array<() => void> = [];
  private frameReader = new FrameReader();
  private _connected = true;

  readonly info: ConnectionInfo;

  constructor(
    private socket: net.Socket,
    private fd: number,
    scheme: TransportScheme,
  ) {
    this.info = {
      scheme,
      remoteAddress: `fd:${fd}`,
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
    if (!this.connected) throw new Error('Connection is closed');
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

export class FdConnector implements TransportConnector {
  readonly schemes: TransportScheme[] = ['fd', 'pipe'];

  async connect(
    address: TransportAddress,
    options: ConnectOptions,
  ): Promise<TransportConnection> {
    if (address.type !== 'fd') {
      throw new Error(`FdConnector requires address type "fd", got "${address.type}"`);
    }

    // Wrap the inherited fd in a net.Socket
    const socket = new net.Socket({ fd: address.fd, readable: true, writable: true });
    return new FdConnection(socket, address.fd, options.uri.scheme);
  }
}

/**
 * No listener for fd:// — the parent process creates the fd pair.
 * The parent (viewer) side uses a net.Server or socketpair directly,
 * then passes the child fd via VIEWPORT=fd://N.
 */

export function createFdConnector(): FdConnector {
  return new FdConnector();
}
