/**
 * SourceState — local state store for the source (app) side.
 *
 * App mutations (setTree, patch, defineSlot, etc.) accumulate in a
 * pending buffer. Multiple rapid updates may overwrite each other in
 * the pending state before being sent — this is the coalescing behavior.
 *
 * On flush(), pending operations are bundled into protocol messages,
 * and the published state is updated to reflect what has been sent.
 *
 * The published state tracks what the viewer has been told. It mirrors
 * the viewer's received state (they converge as messages are delivered).
 *
 *   app mutations → pending (coalesced)
 *   flush()       → bundle messages → transport sends → update published
 */

import type {
  ProtocolMessage,
  VNode,
  PatchOp,
  SlotValue,
  SchemaColumn,
  NodeProps,
} from '../core/types.js';
import { MessageType } from '../core/types.js';

/** A snapshot of what has been published (sent to the viewer). */
export interface PublishedSnapshot {
  /** The last full tree sent, if any. */
  tree: VNode | null;
  /** Current slot values. */
  slots: Map<number, SlotValue>;
  /** Current schema definitions. */
  schemas: Map<number, SchemaColumn[]>;
  /** Sequence number of the last flush. */
  seq: bigint;
}

/** Pending operations accumulated since last flush. */
interface PendingOps {
  /** If set, a full tree replacement is pending (overrides any pending patches). */
  tree: VNode | null;
  /** Accumulated patch ops, keyed by target ID for coalescing. */
  patches: Map<number, PatchOp>;
  /** Pending slot definitions, keyed by slot ID (last-write-wins). */
  slots: Map<number, SlotValue>;
  /** Pending schema definitions, keyed by slot ID (last-write-wins). */
  schemas: Map<number, SchemaColumn[]>;
  /** Pending data rows (not coalesced — order matters). */
  dataRows: Array<{ schemaSlot: number; row: unknown[] | Record<string, unknown> }>;
  /** Whether there are any pending changes at all. */
  dirty: boolean;
}

function createPending(): PendingOps {
  return {
    tree: null,
    patches: new Map(),
    slots: new Map(),
    schemas: new Map(),
    dataRows: [],
    dirty: false,
  };
}

/**
 * SourceState manages pending and published state for the app side.
 */
export class SourceState {
  private published: PublishedSnapshot = {
    tree: null,
    slots: new Map(),
    schemas: new Map(),
    seq: 0n,
  };
  private pending: PendingOps = createPending();

  /**
   * Set the full tree. Replaces any pending patches (a full tree
   * makes individual patches obsolete).
   */
  setTree(root: VNode): void {
    this.pending.tree = root;
    // A full tree replacement makes pending patches irrelevant
    this.pending.patches.clear();
    this.pending.dirty = true;
  }

  /**
   * Apply patch operations. If the same target has a pending patch,
   * the new op's set properties are merged (last-write-wins per property).
   * Non-set ops (insert, remove, move, replace) are not coalesced.
   */
  patch(ops: PatchOp[]): void {
    for (const op of ops) {
      const existing = this.pending.patches.get(op.target);
      if (existing && op.set && existing.set && !op.childrenInsert && !op.childrenRemove && !op.childrenMove && !op.remove && !op.replace) {
        // Coalesce: merge set properties (last-write-wins per key)
        existing.set = { ...existing.set, ...op.set };
      } else {
        // Non-coalesceable or first patch for this target
        this.pending.patches.set(op.target, { ...op });
      }
    }
    this.pending.dirty = true;
  }

  /** Define a slot (last-write-wins for same slot ID). */
  defineSlot(slot: number, value: SlotValue): void {
    this.pending.slots.set(slot, value);
    this.pending.dirty = true;
  }

  /** Define a schema (last-write-wins for same slot ID). */
  defineSchema(slot: number, columns: SchemaColumn[]): void {
    this.pending.schemas.set(slot, columns);
    this.pending.dirty = true;
  }

  /** Emit a data row. Data rows are not coalesced (order matters). */
  emitData(schemaSlot: number, row: unknown[] | Record<string, unknown>): void {
    this.pending.dataRows.push({ schemaSlot, row });
    this.pending.dirty = true;
  }

  /**
   * Flush: bundle all pending operations into protocol messages,
   * update published state, and return the messages for the transport
   * to send.
   *
   * Returns an empty array if nothing is pending.
   */
  flush(): ProtocolMessage[] {
    if (!this.pending.dirty) return [];

    const messages: ProtocolMessage[] = [];

    // Slot definitions first (viewer may need them before tree/patches)
    for (const [slot, value] of this.pending.slots) {
      messages.push({ type: MessageType.DEFINE, slot, value });
      this.published.slots.set(slot, value);
    }

    // Schema definitions
    for (const [slot, columns] of this.pending.schemas) {
      messages.push({ type: MessageType.SCHEMA, slot, columns });
      this.published.schemas.set(slot, columns);
    }

    // Full tree or patches (never both — setTree clears patches)
    if (this.pending.tree !== null) {
      messages.push({ type: MessageType.TREE, root: this.pending.tree });
      this.published.tree = this.pending.tree;
    } else if (this.pending.patches.size > 0) {
      const ops = Array.from(this.pending.patches.values());
      messages.push({ type: MessageType.PATCH, ops });
    }

    // Data rows (in order)
    for (const { schemaSlot, row } of this.pending.dataRows) {
      messages.push({ type: MessageType.DATA, schema: schemaSlot, row });
    }

    // Reset pending
    this.pending = createPending();
    this.published.seq++;

    return messages;
  }

  /** Check if there are pending changes to flush. */
  hasPending(): boolean {
    return this.pending.dirty;
  }

  /** Get the published state snapshot. */
  getPublished(): Readonly<PublishedSnapshot> {
    return this.published;
  }

  /** Get the current sequence number. */
  get seq(): bigint {
    return this.published.seq;
  }

  /** Reset all state. */
  reset(): void {
    this.published = {
      tree: null,
      slots: new Map(),
      schemas: new Map(),
      seq: 0n,
    };
    this.pending = createPending();
  }
}
