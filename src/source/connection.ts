/**
 * AppConnection implementation backed by SourceState.
 *
 * This bridges the AppConnection interface (what apps code against)
 * to the SourceState (pending/published local state model). Apps
 * call setTree(), patch(), etc. and the mutations accumulate in the
 * SourceState's pending buffer until flushed.
 */

import type {
  AppConnection,
  InputEvent,
  VNode,
  PatchOp,
  SlotValue,
  SchemaColumn,
  OutputMode,
} from '../core/types.js';
import { SourceState } from './state.js';

/**
 * Create an AppConnection backed by a SourceState.
 *
 * The connection delegates all mutations to the SourceState's pending
 * buffer. Flushing is controlled externally (by the harness, transport,
 * or a flush helper).
 */
export function createSourceConnection(
  state: SourceState,
  options?: {
    width?: number;
    height?: number;
    outputMode?: OutputMode;
  },
): SourceConnection {
  return new SourceConnection(state, options);
}

export class SourceConnection implements AppConnection {
  private inputHandlers: Array<(event: InputEvent) => void> = [];
  private resizeHandlers: Array<(width: number, height: number) => void> = [];
  private _width: number;
  private _height: number;
  readonly outputMode: OutputMode;
  readonly state: SourceState;

  constructor(
    state: SourceState,
    options?: {
      width?: number;
      height?: number;
      outputMode?: OutputMode;
    },
  ) {
    this.state = state;
    this._width = options?.width ?? 800;
    this._height = options?.height ?? 600;
    this.outputMode = options?.outputMode ?? { type: 'headless' };
  }

  get width(): number { return this._width; }
  get height(): number { return this._height; }

  setTree(root: VNode): void {
    this.state.setTree(root);
  }

  patch(ops: PatchOp[]): void {
    this.state.patch(ops);
  }

  defineSlot(slot: number, value: SlotValue): void {
    this.state.defineSlot(slot, value);
  }

  defineSchema(slot: number, columns: SchemaColumn[]): void {
    this.state.defineSchema(slot, columns);
  }

  emitData(schemaSlot: number, row: unknown[] | Record<string, unknown>): void {
    this.state.emitData(schemaSlot, row);
  }

  onInput(handler: (event: InputEvent) => void): void {
    this.inputHandlers.push(handler);
  }

  onResize(handler: (width: number, height: number) => void): void {
    this.resizeHandlers.push(handler);
  }

  /** Deliver an input event from the viewer to the app's handlers. */
  deliverInput(event: InputEvent): void {
    for (const handler of this.inputHandlers) {
      handler(event);
    }
  }

  /** Deliver a resize event to the app's handlers. */
  deliverResize(width: number, height: number): void {
    this._width = width;
    this._height = height;
    for (const handler of this.resizeHandlers) {
      handler(width, height);
    }
  }
}
