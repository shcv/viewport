/**
 * Protocol C: Integer Opcode Tuples
 *
 * Maximally compact positional encoding with abbreviated keys.
 * See CLAUDE.md for full design rationale.
 */

import { encode, decode } from 'cborg';
import type {
  ProtocolBackend,
  ProtocolMessage,
  FrameHeader,
  VNode,
  PatchOp,
} from '../../core/types.js';
import { MessageType } from '../../core/types.js';
import { encodeHeader, decodeHeader, HEADER_SIZE } from '../../core/wire.js';

// Opcodes
const OP_SET = 0;
const OP_DEL = 1;
const OP_PATCH = 2;
const OP_TREE = 3;
const OP_DATA = 4;
const OP_SCHEMA = 5;
const OP_INPUT = 6;
const OP_ENV = 7;

// Property abbreviation map (encode direction: full → short)
const ENCODE_ABBREV: Record<string, string> = {
  id: 'i', type: 't', children: 'ch', content: 'c',
  direction: 'd', wrap: 'w', justify: 'j', align: 'a',
  gap: 'g', padding: 'p', margin: 'm', border: 'bd',
  borderRadius: 'br', background: 'bg', opacity: 'op',
  shadow: 'sh', width: 'W', height: 'H', flex: 'f',
  minWidth: 'mW', minHeight: 'mH', maxWidth: 'MW', maxHeight: 'MH',
  fontFamily: 'ff', size: 'sz', weight: 'wt', color: 'cl',
  decoration: 'dc', textAlign: 'ta', italic: 'it',
  value: 'v', placeholder: 'ph', multiline: 'ml', disabled: 'di',
  virtualHeight: 'vH', virtualWidth: 'vW', scrollTop: 'sT',
  scrollLeft: 'sL', schema: 'sc', interactive: 'ia',
  tabIndex: 'ti', style: 's', transition: 'tr',
  altText: 'at', mode: 'mo', format: 'fm', data: 'dt',
  textAlt: 'tA', kind: 'k',
  // Patch ops
  target: 'tg', set: 'st', remove: 'rm', replace: 'rp',
  childrenInsert: 'ci', childrenRemove: 'cr', childrenMove: 'cm',
  index: 'ix', node: 'n', from: 'fr', to: 'to',
  // Input event
  key: 'ky', button: 'bt', action: 'ac',
  x: 'x', y: 'y',
  // Schema
  columns: 'co', name: 'nm', unit: 'un',
};

// Decode direction: short → full
const DECODE_ABBREV: Record<string, string> = {};
for (const [full, short] of Object.entries(ENCODE_ABBREV)) {
  DECODE_ABBREV[short] = full;
}

export class OpcodeBackend implements ProtocolBackend {
  readonly name = 'Protocol C: Opcodes';
  readonly variant = 'opcodes';

  encode(message: ProtocolMessage): Uint8Array {
    const tuple = this.messageToTuple(message);
    return encode(tuple) as Uint8Array;
  }

  decode(data: Uint8Array): ProtocolMessage {
    const tuple = decode(data) as unknown[];
    return this.tupleToMessage(tuple);
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
    const payload = data.slice(HEADER_SIZE, HEADER_SIZE + header.length);
    const message = this.decode(payload);
    return { header, message };
  }

  private messageToTuple(msg: ProtocolMessage): unknown[] {
    switch (msg.type) {
      case MessageType.DEFINE:
        return [OP_SET, msg.slot, this.abbreviateObj(msg.value as Record<string, unknown>)];

      case MessageType.TREE:
        return [OP_TREE, this.abbreviateNode(msg.root)];

      case MessageType.PATCH:
        return [OP_PATCH, msg.ops.map((op) => this.abbreviatePatchOp(op))];

      case MessageType.DATA:
        return [OP_DATA, msg.schema ?? null, msg.row];

      case MessageType.SCHEMA:
        return [OP_SCHEMA, msg.slot, msg.columns.map((c) => this.abbreviateObj(c as any))];

      case MessageType.INPUT:
        return [OP_INPUT, this.abbreviateObj(msg.event as any)];

      case MessageType.ENV:
        return [OP_ENV, msg.env];

      default:
        return [msg.type, msg];
    }
  }

  private tupleToMessage(tuple: unknown[]): ProtocolMessage {
    const op = tuple[0] as number;

    switch (op) {
      case OP_SET:
        return {
          type: MessageType.DEFINE,
          slot: tuple[1] as number,
          value: this.expandObj(tuple[2] as Record<string, unknown>) as any,
        };

      case OP_TREE:
        return {
          type: MessageType.TREE,
          root: this.expandNode(tuple[1] as Record<string, unknown>),
        };

      case OP_PATCH:
        return {
          type: MessageType.PATCH,
          ops: (tuple[1] as unknown[]).map((o) => this.expandPatchOp(o as Record<string, unknown>)),
        };

      case OP_DATA:
        return {
          type: MessageType.DATA,
          ...(tuple[1] !== null ? { schema: tuple[1] as number } : {}),
          row: tuple[2] as unknown[],
        };

      case OP_SCHEMA:
        return {
          type: MessageType.SCHEMA,
          slot: tuple[1] as number,
          columns: (tuple[2] as unknown[]).map((c) => this.expandObj(c as Record<string, unknown>)) as any,
        };

      case OP_INPUT:
        return {
          type: MessageType.INPUT,
          event: this.expandObj(tuple[1] as Record<string, unknown>) as any,
        };

      case OP_ENV:
        return {
          type: MessageType.ENV,
          env: tuple[1] as any,
        };

      default:
        throw new Error(`Unknown opcode: ${op}`);
    }
  }

  private abbreviateNode(node: VNode): Record<string, unknown> {
    const obj: Record<string, unknown> = {
      i: node.id,
      t: node.type,
    };

    for (const [key, value] of Object.entries(node.props)) {
      if (value !== undefined) {
        const abbr = ENCODE_ABBREV[key] ?? key;
        obj[abbr] = value;
      }
    }

    if (node.children && node.children.length > 0) {
      obj.ch = node.children.map((c) => this.abbreviateNode(c));
    }

    if (node.textAlt !== undefined) {
      obj.tA = node.textAlt;
    }

    return obj;
  }

  private expandNode(obj: Record<string, unknown>): VNode {
    const expanded = this.expandObj(obj);
    const { id, type, children, textAlt, ...props } = expanded;

    return {
      id: id as number,
      type: type as any,
      props,
      ...(children ? { children: (children as any[]).map((c: any) => this.expandNode(c)) } : {}),
      ...(textAlt !== undefined ? { textAlt: textAlt as string } : {}),
    };
  }

  private abbreviatePatchOp(op: PatchOp): Record<string, unknown> {
    const obj: Record<string, unknown> = { tg: op.target };

    if (op.set) obj.st = this.abbreviateObj(op.set);
    if (op.remove) obj.rm = true;
    if (op.replace) obj.rp = this.abbreviateNode(op.replace);
    if (op.childrenInsert) {
      obj.ci = { ix: op.childrenInsert.index, n: this.abbreviateNode(op.childrenInsert.node) };
    }
    if (op.childrenRemove) obj.cr = { ix: op.childrenRemove.index };
    if (op.childrenMove) obj.cm = { fr: op.childrenMove.from, to: op.childrenMove.to };
    if (op.transition) obj.tr = op.transition;

    return obj;
  }

  private expandPatchOp(obj: Record<string, unknown>): PatchOp {
    const expanded = this.expandObj(obj);
    const result: PatchOp = { target: expanded.target as number };

    if (expanded.set) result.set = this.expandObj(expanded.set as Record<string, unknown>);
    if (expanded.remove) result.remove = true;
    if (expanded.replace) result.replace = this.expandNode(expanded.replace as Record<string, unknown>);
    if (expanded.childrenInsert) {
      const ci = this.expandObj(expanded.childrenInsert as Record<string, unknown>);
      result.childrenInsert = { index: ci.index as number, node: this.expandNode(ci.node as Record<string, unknown>) };
    }
    if (expanded.childrenRemove) {
      const cr = this.expandObj(expanded.childrenRemove as Record<string, unknown>);
      result.childrenRemove = cr as any;
    }
    if (expanded.childrenMove) {
      const cm = this.expandObj(expanded.childrenMove as Record<string, unknown>);
      result.childrenMove = cm as any;
    }
    if (expanded.transition) result.transition = expanded.transition as number;

    return result;
  }

  private abbreviateObj(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined) continue;
      const abbr = ENCODE_ABBREV[key] ?? key;
      result[abbr] = value;
    }
    return result;
  }

  private expandObj(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const full = DECODE_ABBREV[key] ?? key;
      result[full] = value;
    }
    return result;
  }
}

/** Create a new Protocol C backend instance. */
export function createOpcodeBackend(): ProtocolBackend {
  return new OpcodeBackend();
}
