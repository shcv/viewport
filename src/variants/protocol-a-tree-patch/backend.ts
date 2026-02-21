/**
 * Protocol A: Tree + Patch with separate slot table.
 *
 * This is the reference implementation — the "preferred direction" from
 * the design doc. Separate concepts for:
 *   - Definition table (reusable styles, data bindings, templates) → DEFINE messages
 *   - Render tree (live node hierarchy) → TREE/PATCH messages
 *
 * Wire format: 8-byte header + CBOR payload with named fields.
 */

import { encode, decode } from 'cborg';
import type {
  ProtocolBackend,
  ProtocolMessage,
  FrameHeader,
  MessageType,
} from '../../core/types.js';
import { MessageType as MT } from '../../core/types.js';
import { encodeHeader, decodeHeader, HEADER_SIZE } from '../../core/wire.js';

export class TreePatchBackend implements ProtocolBackend {
  readonly name = 'Protocol A: Tree + Patch';
  readonly variant = 'tree-patch';

  encode(message: ProtocolMessage): Uint8Array {
    // Encode the message payload as msgpack with named fields
    const payload = this.messageToPayload(message);
    return encode(payload) as Uint8Array;
  }

  decode(data: Uint8Array): ProtocolMessage {
    const payload = decode(data) as Record<string, unknown>;
    return this.payloadToMessage(payload);
  }

  encodeFrame(message: ProtocolMessage): Uint8Array {
    const payload = this.encode(message);
    const header = encodeHeader(message.type, payload.length);
    const frame = new Uint8Array(HEADER_SIZE + payload.length);
    frame.set(header, 0);
    frame.set(payload, HEADER_SIZE);
    return frame;
  }

  decodeFrame(data: Uint8Array): { header: FrameHeader; message: ProtocolMessage } {
    const header = decodeHeader(data);
    if (!header) throw new Error('Invalid frame: bad magic bytes');

    const payloadBytes = data.slice(HEADER_SIZE, HEADER_SIZE + header.length);
    const payload = decode(payloadBytes) as Record<string, unknown>;

    // Use the type from the header for dispatch
    const message = this.payloadToMessage(payload, header.type as MessageType);
    return { header, message };
  }

  private messageToPayload(msg: ProtocolMessage): Record<string, unknown> {
    switch (msg.type) {
      case MT.DEFINE:
        return { slot: msg.slot, value: msg.value };

      case MT.TREE:
        return { root: this.serializeVNode(msg.root) };

      case MT.PATCH:
        return {
          ops: msg.ops.map((op) => {
            const obj: Record<string, unknown> = { target: op.target };
            if (op.set) obj.set = op.set;
            if (op.childrenInsert) obj.children_insert = {
              index: op.childrenInsert.index,
              node: this.serializeVNode(op.childrenInsert.node),
            };
            if (op.childrenRemove) obj.children_remove = op.childrenRemove;
            if (op.childrenMove) obj.children_move = op.childrenMove;
            if (op.remove) obj.remove = true;
            if (op.replace) obj.replace = this.serializeVNode(op.replace);
            if (op.transition) obj.transition = op.transition;
            return obj;
          }),
        };

      case MT.DATA:
        return {
          ...(msg.schema !== undefined ? { schema: msg.schema } : {}),
          row: msg.row,
        };

      case MT.INPUT:
        return { event: msg.event };

      case MT.ENV:
        return { env: msg.env };

      case MT.SCHEMA:
        return { slot: msg.slot, columns: msg.columns };

      default:
        return msg as unknown as Record<string, unknown>;
    }
  }

  private payloadToMessage(payload: Record<string, unknown>, typeHint?: MessageType): ProtocolMessage {
    // If we have a type hint from the frame header, use it
    if (typeHint !== undefined) {
      return this.decodeByType(typeHint, payload);
    }

    // Otherwise infer from payload shape
    if ('root' in payload) return this.decodeByType(MT.TREE, payload);
    if ('ops' in payload) return this.decodeByType(MT.PATCH, payload);
    if ('slot' in payload && 'value' in payload) return this.decodeByType(MT.DEFINE, payload);
    if ('slot' in payload && 'columns' in payload) return this.decodeByType(MT.SCHEMA, payload);
    if ('row' in payload) return this.decodeByType(MT.DATA, payload);
    if ('event' in payload) return this.decodeByType(MT.INPUT, payload);
    if ('env' in payload) return this.decodeByType(MT.ENV, payload);

    throw new Error(`Cannot infer message type from payload: ${JSON.stringify(payload).slice(0, 100)}`);
  }

  private decodeByType(type: MessageType, payload: Record<string, unknown>): ProtocolMessage {
    switch (type) {
      case MT.DEFINE:
        return {
          type: MT.DEFINE,
          slot: payload.slot as number,
          value: payload.value as ProtocolMessage & { type: typeof MT.DEFINE } extends never ? never : any,
        };

      case MT.TREE:
        return {
          type: MT.TREE,
          root: this.deserializeVNode(payload.root as Record<string, unknown>),
        };

      case MT.PATCH:
        return {
          type: MT.PATCH,
          ops: (payload.ops as Record<string, unknown>[]).map((op) => ({
            target: op.target as number,
            ...(op.set ? { set: op.set as Record<string, unknown> } : {}),
            ...(op.children_insert ? {
              childrenInsert: {
                index: (op.children_insert as any).index,
                node: this.deserializeVNode((op.children_insert as any).node),
              },
            } : {}),
            ...(op.children_remove ? { childrenRemove: op.children_remove as { index: number } } : {}),
            ...(op.children_move ? { childrenMove: op.children_move as { from: number; to: number } } : {}),
            ...(op.remove ? { remove: true } : {}),
            ...(op.replace ? { replace: this.deserializeVNode(op.replace as Record<string, unknown>) } : {}),
            ...(op.transition ? { transition: op.transition as number } : {}),
          })),
        };

      case MT.DATA:
        return {
          type: MT.DATA,
          ...(payload.schema !== undefined ? { schema: payload.schema as number } : {}),
          row: payload.row as unknown[],
        };

      case MT.INPUT:
        return {
          type: MT.INPUT,
          event: payload.event as ProtocolMessage & { type: typeof MT.INPUT } extends never ? never : any,
        };

      case MT.ENV:
        return {
          type: MT.ENV,
          env: payload.env as ProtocolMessage & { type: typeof MT.ENV } extends never ? never : any,
        };

      case MT.SCHEMA:
        return {
          type: MT.SCHEMA,
          slot: payload.slot as number,
          columns: payload.columns as any[],
        };

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  }

  private serializeVNode(node: any): Record<string, unknown> {
    const obj: Record<string, unknown> = {
      id: node.id,
      type: node.type,
    };

    // Flatten props into the node object (protocol A style)
    if (node.props) {
      for (const [key, value] of Object.entries(node.props)) {
        if (value !== undefined) {
          obj[key] = value;
        }
      }
    }

    if (node.children && node.children.length > 0) {
      obj.children = node.children.map((c: any) => this.serializeVNode(c));
    }

    if (node.textAlt !== undefined) {
      obj.text_alt = node.textAlt;
    }

    return obj;
  }

  private deserializeVNode(obj: Record<string, unknown>): any {
    const { id, type, children, text_alt, ...rest } = obj;

    return {
      id,
      type,
      props: rest,
      ...(children ? { children: (children as any[]).map((c) => this.deserializeVNode(c)) } : {}),
      ...(text_alt !== undefined ? { textAlt: text_alt } : {}),
    };
  }
}

/** Create a new Protocol A backend instance. */
export function createTreePatchBackend(): ProtocolBackend {
  return new TreePatchBackend();
}
