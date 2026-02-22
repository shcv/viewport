/**
 * Canonical Viewport Protocol Encoding.
 *
 * Evolved from Protocol C (opcode tuples) with these key changes:
 * - CBOR maps use well-defined integer keys (not ad-hoc string abbreviations)
 * - Integer keys are defined in src/core/prop-keys.ts and shared across languages
 * - CBOR encodes small integers (0-23) in 1 byte, making this more compact
 *   than even abbreviated string keys
 *
 * Wire format: [opcode, ...args] tuples encoded as CBOR arrays.
 * Property maps use integer keys from the NodeKey/PatchKey/InputKey enums.
 */

import { encode, decode } from 'cborg';
import type {
  ProtocolBackend,
  ProtocolMessage,
  FrameHeader,
  VNode,
  PatchOp,
  SessionId,
} from '../core/types.js';
import { MessageType, SESSION_NONE } from '../core/types.js';
import { encodeHeader, decodeHeader, HEADER_SIZE } from '../core/wire.js';
import {
  NodeKey,
  PatchKey,
  InputKey,
  SchemaKey,
  SlotKey,
  NODE_KEY_TO_PROP,
  PROP_TO_NODE_KEY,
} from '../core/prop-keys.js';

// ── Opcodes ────────────────────────────────────────────────────

const OP_SET    = 0;  // DEFINE(slot, value)
const OP_DEL    = 1;  // reserved for future slot deletion
const OP_PATCH  = 2;  // PATCH(ops)
const OP_TREE   = 3;  // TREE(root)
const OP_DATA   = 4;  // DATA(schema?, row)
const OP_SCHEMA = 5;  // SCHEMA(slot, columns)
const OP_INPUT  = 6;  // INPUT(event)
const OP_ENV    = 7;  // ENV(env)

// ── Backend ────────────────────────────────────────────────────

export class CanonicalBackend implements ProtocolBackend {
  readonly name = 'Canonical Encoding';
  readonly variant = 'canonical';

  encode(message: ProtocolMessage): Uint8Array {
    const tuple = this.messageToTuple(message);
    return encode(tuple) as Uint8Array;
  }

  decode(data: Uint8Array): ProtocolMessage {
    // useMaps: true makes cborg decode CBOR maps as JavaScript Map objects,
    // which is required to support integer keys.
    const tuple = decode(data, { useMaps: true }) as unknown[];
    return this.tupleToMessage(tuple);
  }

  encodeFrame(message: ProtocolMessage, session: SessionId = SESSION_NONE, seq: bigint = 0n): Uint8Array {
    const payload = this.encode(message);
    const header = encodeHeader(message.type, payload.length, session, seq);
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

  // ── Encode helpers ──────────────────────────────────────────

  private messageToTuple(msg: ProtocolMessage): unknown[] {
    switch (msg.type) {
      case MessageType.DEFINE:
        return [OP_SET, msg.slot, this.encodeSlotValue(msg.value as Record<string, unknown>)];

      case MessageType.TREE:
        return [OP_TREE, this.encodeNode(msg.root)];

      case MessageType.PATCH:
        return [OP_PATCH, msg.ops.map((op) => this.encodePatchOp(op))];

      case MessageType.DATA:
        return [OP_DATA, msg.schema ?? null, msg.row];

      case MessageType.SCHEMA:
        return [OP_SCHEMA, msg.slot, msg.columns.map((c) => this.encodeSchemaColumn(c as Record<string, unknown>))];

      case MessageType.INPUT:
        return [OP_INPUT, this.encodeInputEvent(msg.event as Record<string, unknown>)];

      case MessageType.ENV:
        return [OP_ENV, msg.env];

      default:
        return [msg.type, msg];
    }
  }

  private encodeNode(node: VNode): Map<number, unknown> {
    const m = new Map<number, unknown>();
    m.set(NodeKey.ID, node.id);
    m.set(NodeKey.TYPE, node.type);

    for (const [key, value] of Object.entries(node.props)) {
      if (value === undefined) continue;
      const intKey = PROP_TO_NODE_KEY[key];
      if (intKey !== undefined) {
        m.set(intKey, value);
      }
      // Unknown props are dropped (they don't have integer keys)
    }

    if (node.children && node.children.length > 0) {
      m.set(NodeKey.CHILDREN, node.children.map((c) => this.encodeNode(c)));
    }

    if (node.textAlt !== undefined) {
      m.set(NodeKey.TEXT_ALT, node.textAlt);
    }

    return m;
  }

  private encodePatchOp(op: PatchOp): Map<number, unknown> {
    const m = new Map<number, unknown>();
    m.set(PatchKey.TARGET, op.target);

    if (op.set) {
      const setMap = new Map<number, unknown>();
      for (const [key, value] of Object.entries(op.set)) {
        if (value === undefined) continue;
        const intKey = PROP_TO_NODE_KEY[key];
        if (intKey !== undefined) {
          setMap.set(intKey, value);
        }
      }
      m.set(PatchKey.SET, setMap);
    }

    if (op.remove) m.set(PatchKey.REMOVE, true);
    if (op.replace) m.set(PatchKey.REPLACE, this.encodeNode(op.replace));

    if (op.childrenInsert) {
      const ci = new Map<number, unknown>();
      ci.set(PatchKey.INDEX, op.childrenInsert.index);
      ci.set(PatchKey.NODE, this.encodeNode(op.childrenInsert.node));
      m.set(PatchKey.CHILDREN_INSERT, ci);
    }

    if (op.childrenRemove) {
      const cr = new Map<number, unknown>();
      cr.set(PatchKey.INDEX, op.childrenRemove.index);
      m.set(PatchKey.CHILDREN_REMOVE, cr);
    }

    if (op.childrenMove) {
      const cm = new Map<number, unknown>();
      cm.set(PatchKey.FROM, op.childrenMove.from);
      cm.set(PatchKey.TO, op.childrenMove.to);
      m.set(PatchKey.CHILDREN_MOVE, cm);
    }

    if (op.transition) m.set(PatchKey.TRANSITION, op.transition);

    return m;
  }

  private encodeInputEvent(event: Record<string, unknown>): Map<number, unknown> {
    const m = new Map<number, unknown>();
    if (event.target !== undefined) m.set(InputKey.TARGET, event.target);
    if (event.kind !== undefined) m.set(InputKey.KIND, event.kind);
    if (event.key !== undefined) m.set(InputKey.KEY, event.key);
    if (event.value !== undefined) m.set(InputKey.VALUE, event.value);
    if (event.x !== undefined) m.set(InputKey.X, event.x);
    if (event.y !== undefined) m.set(InputKey.Y, event.y);
    if (event.button !== undefined) m.set(InputKey.BUTTON, event.button);
    if (event.action !== undefined) m.set(InputKey.ACTION, event.action);
    if (event.scrollTop !== undefined) m.set(InputKey.SCROLL_TOP, event.scrollTop);
    if (event.scrollLeft !== undefined) m.set(InputKey.SCROLL_LEFT, event.scrollLeft);
    return m;
  }

  private encodeSchemaColumn(col: Record<string, unknown>): Map<number, unknown> {
    const m = new Map<number, unknown>();
    if (col.id !== undefined) m.set(SchemaKey.ID, col.id);
    if (col.name !== undefined) m.set(SchemaKey.NAME, col.name);
    if (col.type !== undefined) m.set(SchemaKey.TYPE, col.type);
    if (col.unit !== undefined) m.set(SchemaKey.UNIT, col.unit);
    if (col.format !== undefined) m.set(SchemaKey.FORMAT, col.format);
    return m;
  }

  private encodeSlotValue(val: Record<string, unknown>): Map<number | string, unknown> {
    // Slot values have a `kind` field that gets integer key 0.
    // All other fields keep their string keys (open-ended).
    const m = new Map<number | string, unknown>();
    for (const [key, value] of Object.entries(val)) {
      if (value === undefined) continue;
      if (key === 'kind') {
        m.set(SlotKey.KIND, value);
      } else {
        m.set(key, value);
      }
    }
    return m;
  }

  // ── Decode helpers ──────────────────────────────────────────

  private tupleToMessage(tuple: unknown[]): ProtocolMessage {
    const op = tuple[0] as number;

    switch (op) {
      case OP_SET:
        return {
          type: MessageType.DEFINE,
          slot: tuple[1] as number,
          value: this.decodeSlotValue(tuple[2] as Map<number | string, unknown>),
        };

      case OP_TREE:
        return {
          type: MessageType.TREE,
          root: this.decodeNode(tuple[1] as Map<number, unknown>),
        };

      case OP_PATCH:
        return {
          type: MessageType.PATCH,
          ops: (tuple[1] as unknown[]).map((o) => this.decodePatchOp(o as Map<number, unknown>)),
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
          columns: (tuple[2] as unknown[]).map((c) => this.decodeSchemaColumn(c as Map<number, unknown>)) as any,
        };

      case OP_INPUT:
        return {
          type: MessageType.INPUT,
          event: this.decodeInputEvent(tuple[1] as Map<number, unknown>) as any,
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

  private decodeNode(m: Map<number, unknown>): VNode {
    const id = m.get(NodeKey.ID) as number;
    const type = m.get(NodeKey.TYPE) as string;
    const textAlt = m.get(NodeKey.TEXT_ALT) as string | undefined;
    const childrenRaw = m.get(NodeKey.CHILDREN) as Map<number, unknown>[] | undefined;

    const props: Record<string, unknown> = {};
    for (const [key, value] of m) {
      if (key === NodeKey.ID || key === NodeKey.TYPE || key === NodeKey.CHILDREN || key === NodeKey.TEXT_ALT) continue;
      const propName = NODE_KEY_TO_PROP[key];
      if (propName) {
        props[propName] = value;
      }
    }

    const node: VNode = { id, type: type as any, props };
    if (childrenRaw) {
      node.children = childrenRaw.map((c) => this.decodeNode(c));
    }
    if (textAlt !== undefined) {
      node.textAlt = textAlt;
    }
    return node;
  }

  private decodePatchOp(m: Map<number, unknown>): PatchOp {
    const op: PatchOp = { target: m.get(PatchKey.TARGET) as number };

    const setMap = m.get(PatchKey.SET) as Map<number, unknown> | undefined;
    if (setMap) {
      const set: Record<string, unknown> = {};
      for (const [key, value] of setMap) {
        const propName = NODE_KEY_TO_PROP[key];
        if (propName) set[propName] = value;
      }
      op.set = set;
    }

    if (m.get(PatchKey.REMOVE)) op.remove = true;

    const replaceMap = m.get(PatchKey.REPLACE) as Map<number, unknown> | undefined;
    if (replaceMap) op.replace = this.decodeNode(replaceMap);

    const ciMap = m.get(PatchKey.CHILDREN_INSERT) as Map<number, unknown> | undefined;
    if (ciMap) {
      op.childrenInsert = {
        index: ciMap.get(PatchKey.INDEX) as number,
        node: this.decodeNode(ciMap.get(PatchKey.NODE) as Map<number, unknown>),
      };
    }

    const crMap = m.get(PatchKey.CHILDREN_REMOVE) as Map<number, unknown> | undefined;
    if (crMap) {
      op.childrenRemove = { index: crMap.get(PatchKey.INDEX) as number };
    }

    const cmMap = m.get(PatchKey.CHILDREN_MOVE) as Map<number, unknown> | undefined;
    if (cmMap) {
      op.childrenMove = {
        from: cmMap.get(PatchKey.FROM) as number,
        to: cmMap.get(PatchKey.TO) as number,
      };
    }

    const transition = m.get(PatchKey.TRANSITION) as number | undefined;
    if (transition !== undefined) op.transition = transition;

    return op;
  }

  private decodeInputEvent(m: Map<number, unknown>): Record<string, unknown> {
    const event: Record<string, unknown> = {};
    if (m.has(InputKey.TARGET)) event.target = m.get(InputKey.TARGET);
    if (m.has(InputKey.KIND)) event.kind = m.get(InputKey.KIND);
    if (m.has(InputKey.KEY)) event.key = m.get(InputKey.KEY);
    if (m.has(InputKey.VALUE)) event.value = m.get(InputKey.VALUE);
    if (m.has(InputKey.X)) event.x = m.get(InputKey.X);
    if (m.has(InputKey.Y)) event.y = m.get(InputKey.Y);
    if (m.has(InputKey.BUTTON)) event.button = m.get(InputKey.BUTTON);
    if (m.has(InputKey.ACTION)) event.action = m.get(InputKey.ACTION);
    if (m.has(InputKey.SCROLL_TOP)) event.scrollTop = m.get(InputKey.SCROLL_TOP);
    if (m.has(InputKey.SCROLL_LEFT)) event.scrollLeft = m.get(InputKey.SCROLL_LEFT);
    return event;
  }

  private decodeSchemaColumn(m: Map<number, unknown>): Record<string, unknown> {
    const col: Record<string, unknown> = {};
    if (m.has(SchemaKey.ID)) col.id = m.get(SchemaKey.ID);
    if (m.has(SchemaKey.NAME)) col.name = m.get(SchemaKey.NAME);
    if (m.has(SchemaKey.TYPE)) col.type = m.get(SchemaKey.TYPE);
    if (m.has(SchemaKey.UNIT)) col.unit = m.get(SchemaKey.UNIT);
    if (m.has(SchemaKey.FORMAT)) col.format = m.get(SchemaKey.FORMAT);
    return col;
  }

  private decodeSlotValue(m: Map<number | string, unknown>): Record<string, unknown> {
    const val: Record<string, unknown> = {};
    for (const [key, value] of m) {
      if (key === SlotKey.KIND) {
        val.kind = value;
      } else {
        val[String(key)] = value;
      }
    }
    return val as any;
  }
}

/** Create a new canonical encoding backend instance. */
export function createCanonicalBackend(): ProtocolBackend {
  return new CanonicalBackend();
}
