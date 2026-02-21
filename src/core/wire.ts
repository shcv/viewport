/**
 * Wire format: 8-byte binary frame header + msgpack payload.
 *
 * ┌─────────┬─────────┬────────┬─────────────┬──────────────────┐
 * │ magic   │ version │ type   │ length      │ msgpack payload  │
 * │ 2 bytes │ 1 byte  │ 1 byte │ 4 bytes LE  │ variable         │
 * └─────────┴─────────┴────────┴─────────────┴──────────────────┘
 */

import { MAGIC, PROTOCOL_VERSION, type FrameHeader, type MessageType } from './types.js';

export const HEADER_SIZE = 8;

/** Encode a frame header into a buffer. */
export function encodeHeader(type: MessageType, payloadLength: number): Uint8Array {
  const buf = new Uint8Array(HEADER_SIZE);
  const view = new DataView(buf.buffer);

  // Magic bytes (big-endian, so 'V' = 0x56, 'P' = 0x50)
  view.setUint16(0, MAGIC, false);
  // Version
  view.setUint8(2, PROTOCOL_VERSION);
  // Message type
  view.setUint8(3, type);
  // Payload length (little-endian u32)
  view.setUint32(4, payloadLength, true);

  return buf;
}

/** Decode a frame header from bytes. Returns null if magic doesn't match. */
export function decodeHeader(data: Uint8Array): FrameHeader | null {
  if (data.length < HEADER_SIZE) return null;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const magic = view.getUint16(0, false);

  if (magic !== MAGIC) return null;

  return {
    magic,
    version: view.getUint8(2),
    type: view.getUint8(3) as MessageType,
    length: view.getUint32(4, true),
  };
}

/** Combine a header and payload into a complete frame. */
export function encodeFrame(type: MessageType, payload: Uint8Array): Uint8Array {
  const header = encodeHeader(type, payload.length);
  const frame = new Uint8Array(HEADER_SIZE + payload.length);
  frame.set(header, 0);
  frame.set(payload, HEADER_SIZE);
  return frame;
}

/** Split a frame into header and payload. */
export function decodeFrame(data: Uint8Array): { header: FrameHeader; payload: Uint8Array } | null {
  const header = decodeHeader(data);
  if (!header) return null;
  if (data.length < HEADER_SIZE + header.length) return null;

  return {
    header,
    payload: data.slice(HEADER_SIZE, HEADER_SIZE + header.length),
  };
}

/**
 * Stream parser for reading frames from a byte stream.
 * Handles partial reads and buffering.
 */
export class FrameReader {
  private buffer: Uint8Array = new Uint8Array(0);

  /** Feed bytes into the reader. Returns any complete frames. */
  feed(data: Uint8Array): Array<{ header: FrameHeader; payload: Uint8Array }> {
    // Append to buffer
    const combined = new Uint8Array(this.buffer.length + data.length);
    combined.set(this.buffer, 0);
    combined.set(data, this.buffer.length);
    this.buffer = combined;

    const frames: Array<{ header: FrameHeader; payload: Uint8Array }> = [];

    while (this.buffer.length >= HEADER_SIZE) {
      const header = decodeHeader(this.buffer);
      if (!header) {
        // Bad magic — skip one byte and try again (recovery)
        this.buffer = this.buffer.slice(1);
        continue;
      }

      const totalSize = HEADER_SIZE + header.length;
      if (this.buffer.length < totalSize) break; // need more data

      const payload = this.buffer.slice(HEADER_SIZE, totalSize);
      frames.push({ header, payload });
      this.buffer = this.buffer.slice(totalSize);
    }

    return frames;
  }

  /** How many bytes are buffered but not yet forming a complete frame. */
  get pendingBytes(): number {
    return this.buffer.length;
  }
}
