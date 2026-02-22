/**
 * Wire format: 24-byte binary frame header + CBOR payload.
 *
 * ┌─────────┬─────────┬────────┬─────────────┬──────────────┬──────────────┬──────────────────┐
 * │ magic   │ version │ type   │ length      │ session      │ seq          │ CBOR payload     │
 * │ 2 bytes │ 1 byte  │ 1 byte │ 4 bytes LE  │ 8 bytes LE   │ 8 bytes LE   │ variable         │
 * └─────────┴─────────┴────────┴─────────────┴──────────────┴──────────────┴──────────────────┘
 *
 * Bytes 0-7 are identical to protocol v1, keeping magic and length at the
 * same offsets. Session and seq are appended at bytes 8-23.
 *
 * - session: 64-bit session ID (48-bit epoch seconds + 16-bit random),
 *   created by the source at connection time. Allows a viewer to
 *   distinguish interleaved messages from multiple sources.
 *
 * - seq: 64-bit monotonic counter within a session. Incremented by
 *   the sender for each state-mutating message, allowing the viewer
 *   to discard superseded updates that arrive late.
 *
 * CBOR (RFC 8949) is used as the payload encoding.
 */

import {
  MAGIC, PROTOCOL_VERSION, SESSION_NONE,
  type FrameHeader, type MessageType, type SessionId,
} from './types.js';

export const HEADER_SIZE = 24;

/** Encode a frame header into a buffer. */
export function encodeHeader(
  type: MessageType,
  payloadLength: number,
  session: SessionId = SESSION_NONE,
  seq: bigint = 0n,
): Uint8Array {
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
  // Session ID (little-endian u64)
  view.setBigUint64(8, session, true);
  // Sequence number (little-endian u64)
  view.setBigUint64(16, seq, true);

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
    session: view.getBigUint64(8, true),
    seq: view.getBigUint64(16, true),
  };
}

/** Combine a header and payload into a complete frame. */
export function encodeFrame(
  type: MessageType,
  payload: Uint8Array,
  session: SessionId = SESSION_NONE,
  seq: bigint = 0n,
): Uint8Array {
  const header = encodeHeader(type, payload.length, session, seq);
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
