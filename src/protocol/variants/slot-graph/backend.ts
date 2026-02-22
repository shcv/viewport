/**
 * Protocol B: Unified Reactive Slot Graph
 *
 * Everything lives in slots. SET/DEL are the only operations.
 * See CLAUDE.md for full implementation instructions.
 */

import { encode, decode } from 'cborg';
import type {
  ProtocolBackend,
  ProtocolMessage,
  FrameHeader,
  VNode,
  SessionId,
} from '../../../core/types.js';
import { MessageType, SESSION_NONE } from '../../../core/types.js';
import { encodeHeader, decodeHeader, HEADER_SIZE } from '../../../core/wire.js';

/** Offset for mapping node IDs to slot IDs (0-127 reserved for viewer). */
const NODE_SLOT_OFFSET = 128;

interface SlotOp {
  op: 'set' | 'del';
  slot: number;
  value?: unknown;
}

export class SlotGraphBackend implements ProtocolBackend {
  readonly name = 'Protocol B: Slot Graph';
  readonly variant = 'slot-graph';

  encode(message: ProtocolMessage): Uint8Array {
    const ops = this.messageToSlotOps(message);
    return encode(ops) as Uint8Array;
  }

  decode(data: Uint8Array): ProtocolMessage {
    const ops = decode(data) as SlotOp[];
    return this.slotOpsToMessage(ops);
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

  /** Convert a high-level message into SET/DEL slot operations. */
  private messageToSlotOps(msg: ProtocolMessage): SlotOp[] {
    switch (msg.type) {
      case MessageType.DEFINE:
        return [{ op: 'set', slot: msg.slot, value: msg.value }];

      case MessageType.TREE: {
        // Flatten the tree into SET operations for each node
        const ops: SlotOp[] = [];
        this.flattenNode(msg.root, ops);
        // SET slot 0 as root reference
        ops.push({ op: 'set', slot: 0, value: { kind: 'root', child: { ref: msg.root.id + NODE_SLOT_OFFSET } } });
        return ops;
      }

      case MessageType.PATCH: {
        // Convert patches to SET operations on the affected slots
        const ops: SlotOp[] = [];
        for (const patchOp of msg.ops) {
          if (patchOp.remove) {
            ops.push({ op: 'del', slot: patchOp.target + NODE_SLOT_OFFSET });
          } else if (patchOp.replace) {
            this.flattenNode(patchOp.replace, ops);
          } else if (patchOp.set) {
            // Partial update: SET the slot with merged properties
            ops.push({
              op: 'set',
              slot: patchOp.target + NODE_SLOT_OFFSET,
              value: { kind: '_patch', ...patchOp.set },
            });
          }
          // childrenInsert, childrenRemove, childrenMove would need parent re-SET
          // (this is the known tradeoff of the slot graph approach)
          if (patchOp.childrenInsert) {
            this.flattenNode(patchOp.childrenInsert.node, ops);
            ops.push({
              op: 'set',
              slot: patchOp.target + NODE_SLOT_OFFSET,
              value: {
                kind: '_children_insert',
                index: patchOp.childrenInsert.index,
                child: { ref: patchOp.childrenInsert.node.id + NODE_SLOT_OFFSET },
              },
            });
          }
        }
        return ops;
      }

      case MessageType.SCHEMA:
        return [{ op: 'set', slot: msg.slot, value: { kind: 'schema', columns: msg.columns } }];

      case MessageType.DATA:
        // Data rows don't have a natural slot; use a synthetic slot
        return [{ op: 'set', slot: -1, value: { kind: 'data', schema: msg.schema, row: msg.row } }];

      case MessageType.INPUT:
        return [{ op: 'set', slot: -2, value: { kind: 'input', event: msg.event } }];

      case MessageType.ENV:
        return [{ op: 'set', slot: -3, value: { kind: 'env', env: msg.env } }];

      default:
        return [];
    }
  }

  /** Flatten a VNode tree into SET operations. */
  private flattenNode(node: VNode, ops: SlotOp[]): void {
    const slot = node.id + NODE_SLOT_OFFSET;
    const value: Record<string, unknown> = {
      kind: node.type,
      ...node.props,
    };

    if (node.children && node.children.length > 0) {
      value.children = node.children.map((c) => ({ ref: c.id + NODE_SLOT_OFFSET }));
      for (const child of node.children) {
        this.flattenNode(child, ops);
      }
    }

    if (node.textAlt !== undefined) {
      value.text_alt = node.textAlt;
    }

    ops.push({ op: 'set', slot, value });
  }

  /** Convert SET/DEL operations back to a high-level message. */
  private slotOpsToMessage(ops: SlotOp[]): ProtocolMessage {
    // Heuristic: look at the ops to determine the message type
    if (ops.length === 0) {
      throw new Error('Empty slot operations');
    }

    // Check for special synthetic slots
    const specialOp = ops.find((o) => o.slot < 0);
    if (specialOp?.slot === -1) {
      const v = specialOp.value as any;
      return { type: MessageType.DATA, schema: v.schema, row: v.row };
    }
    if (specialOp?.slot === -2) {
      const v = specialOp.value as any;
      return { type: MessageType.INPUT, event: v.event };
    }
    if (specialOp?.slot === -3) {
      const v = specialOp.value as any;
      return { type: MessageType.ENV, env: v.env };
    }

    // Check for root SET (indicates TREE message)
    const rootOp = ops.find((o) => o.slot === 0 && (o.value as any)?.kind === 'root');
    if (rootOp) {
      // Reconstruct tree from slots
      const slotMap = new Map<number, any>();
      for (const op of ops) {
        if (op.op === 'set' && op.slot > 0) {
          slotMap.set(op.slot, op.value);
        }
      }
      const rootRef = (rootOp.value as any).child.ref;
      const root = this.reconstructNode(rootRef, slotMap);
      return { type: MessageType.TREE, root };
    }

    // Single DEFINE
    if (ops.length === 1 && ops[0].op === 'set') {
      const slot = ops[0].slot;
      const value = ops[0].value as any;
      if (value?.kind === 'schema') {
        return { type: MessageType.SCHEMA, slot, columns: value.columns };
      }
      if (slot < NODE_SLOT_OFFSET) {
        return { type: MessageType.DEFINE, slot, value };
      }
    }

    // Otherwise it's a PATCH
    const patchOps = ops.map((o) => {
      if (o.op === 'del') {
        return { target: o.slot - NODE_SLOT_OFFSET, remove: true };
      }
      const v = o.value as any;
      if (v?.kind === '_patch') {
        const { kind, ...set } = v;
        return { target: o.slot - NODE_SLOT_OFFSET, set };
      }
      if (v?.kind === '_children_insert') {
        return {
          target: o.slot - NODE_SLOT_OFFSET,
          childrenInsert: { index: v.index, node: { id: 0, type: 'box' as const, props: {} } },
        };
      }
      return { target: o.slot - NODE_SLOT_OFFSET, set: v };
    });

    return { type: MessageType.PATCH, ops: patchOps };
  }

  /** Reconstruct a VNode from slot data. */
  private reconstructNode(slotId: number, slots: Map<number, any>): VNode {
    const data = slots.get(slotId);
    if (!data) {
      return { id: slotId - NODE_SLOT_OFFSET, type: 'box', props: {} };
    }

    const { kind, children, text_alt, ...props } = data;
    const childNodes = children
      ? (children as any[]).map((ref: any) => this.reconstructNode(ref.ref, slots))
      : undefined;

    return {
      id: slotId - NODE_SLOT_OFFSET,
      type: kind,
      props,
      ...(childNodes ? { children: childNodes } : {}),
      ...(text_alt !== undefined ? { textAlt: text_alt } : {}),
    };
  }
}

/** Create a new Protocol B backend instance. */
export function createSlotGraphBackend(): ProtocolBackend {
  return new SlotGraphBackend();
}
