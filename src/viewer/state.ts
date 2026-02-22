/**
 * ViewerState — local state store for the viewer side.
 *
 * The transport layer receives frames and calls applyMessage() to update
 * state. Changes mark affected nodes/slots/schemas as dirty. The renderer
 * runs independently, calling consumeDirty() at its own refresh rate to
 * discover what changed and render it.
 *
 * This decouples message ingestion rate from render rate:
 *   transport → applyMessage() → marks dirty
 *   renderer  → consumeDirty() → reads tree → renders → clears dirty
 */

import type {
  ProtocolMessage,
  RenderTree,
  SessionId,
  SlotValue,
  SchemaColumn,
  InputEvent,
} from '../core/types.js';
import { MessageType } from '../core/types.js';
import {
  createRenderTree,
  setTreeRoot,
  applyPatches,
  toRowArray,
} from '../core/tree.js';

/** Set of changes since last consumeDirty() call. */
export interface DirtySet {
  /** True if the entire tree was replaced (TREE message). */
  treeReplaced: boolean;
  /** Node IDs that were modified by PATCH operations. */
  nodes: Set<number>;
  /** Slot IDs that were defined or updated. */
  slots: Set<number>;
  /** Schema slot IDs that were defined or updated. */
  schemas: Set<number>;
  /** Data stream schema IDs that received new rows. */
  data: Set<number>;
  /** Input events received (viewer→app direction). */
  inputs: InputEvent[];
  /** Whether anything is dirty at all. */
  readonly dirty: boolean;
}

function createDirtySet(): DirtySet {
  return {
    treeReplaced: false,
    nodes: new Set(),
    slots: new Set(),
    schemas: new Set(),
    data: new Set(),
    inputs: [],
    get dirty() {
      return (
        this.treeReplaced ||
        this.nodes.size > 0 ||
        this.slots.size > 0 ||
        this.schemas.size > 0 ||
        this.data.size > 0 ||
        this.inputs.length > 0
      );
    },
  };
}

/**
 * ViewerState manages the committed render tree and tracks dirty state
 * for decoupled rendering.
 */
export class ViewerState {
  private tree: RenderTree = createRenderTree();
  private dirtySet: DirtySet = createDirtySet();

  /** Apply a protocol message to the state store.
   *  Called by the transport layer when a frame arrives. */
  applyMessage(msg: ProtocolMessage, session?: SessionId, seq?: bigint): void {
    const version = seq ?? 0n;

    switch (msg.type) {
      case MessageType.DEFINE: {
        const prev = this.tree.slotVersions.get(msg.slot);
        if (prev !== undefined && version > 0n && prev > version) break;
        this.tree.slots.set(msg.slot, msg.value);
        this.tree.slotVersions.set(msg.slot, version);
        this.dirtySet.slots.add(msg.slot);
        break;
      }

      case MessageType.TREE:
        setTreeRoot(this.tree, msg.root, version);
        this.dirtySet.treeReplaced = true;
        break;

      case MessageType.PATCH: {
        const { applied } = applyPatches(this.tree, msg.ops, version);
        if (applied > 0) {
          for (const op of msg.ops) {
            this.dirtySet.nodes.add(op.target);
          }
        }
        break;
      }

      case MessageType.SCHEMA: {
        const prev = this.tree.schemaVersions.get(msg.slot);
        if (prev !== undefined && version > 0n && prev > version) break;
        this.tree.schemas.set(msg.slot, msg.columns);
        this.tree.schemaVersions.set(msg.slot, version);
        this.dirtySet.schemas.add(msg.slot);
        break;
      }

      case MessageType.DATA: {
        const schemaSlot = msg.schema ?? 0;
        const prev = this.tree.dataVersions.get(schemaSlot);
        if (prev !== undefined && version > 0n && prev > version) break;
        if (!this.tree.dataRows.has(schemaSlot)) {
          this.tree.dataRows.set(schemaSlot, []);
        }
        const rowArray = toRowArray(msg.row, schemaSlot, this.tree);
        if (rowArray) {
          this.tree.dataRows.get(schemaSlot)!.push(rowArray);
        }
        this.tree.dataVersions.set(schemaSlot, version);
        this.dirtySet.data.add(schemaSlot);
        break;
      }

      case MessageType.INPUT:
        this.dirtySet.inputs.push(msg.event);
        break;

      case MessageType.ENV:
        // ENV updates don't need dirty tracking — they're metadata
        break;
    }
  }

  /**
   * Consume dirty state. Returns what changed since last call and
   * resets the dirty set. Called by the renderer at its own rate.
   */
  consumeDirty(): DirtySet {
    const consumed = this.dirtySet;
    this.dirtySet = createDirtySet();
    return consumed;
  }

  /** Read the current render tree (for rendering). */
  getTree(): RenderTree {
    return this.tree;
  }

  /** Check if there are pending dirty changes. */
  isDirty(): boolean {
    return this.dirtySet.dirty;
  }

  /** Reset all state. */
  reset(): void {
    this.tree = createRenderTree();
    this.dirtySet = createDirtySet();
  }
}
