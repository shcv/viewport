/**
 * App framework.
 *
 * Provides defineApp() — the entry point for writing test apps.
 * Apps receive an AppConnection and use it to build their UI.
 */

import type {
  AppFactory,
  AppInstance,
  AppConnection,
  InputEvent,
  OutputMode,
  VNode,
  PatchOp,
  SlotValue,
  SchemaColumn,
} from '../core/types.js';
import { resetIdCounter } from './components.js';

/** Define a Viewport test application. */
export function defineApp(config: {
  name: string;
  description: string;
  setup: (conn: AppConnection) => AppInstance | void;
}): AppFactory {
  return {
    name: config.name,
    description: config.description,
    create(conn: AppConnection): AppInstance {
      // Reset auto-ID counter for each app instance to avoid collisions
      resetIdCounter();
      const result = config.setup(conn);
      return result ?? {};
    },
  };
}

/**
 * An in-memory AppConnection used during testing.
 * Records all messages sent by the app for inspection.
 */
export class RecordingConnection implements AppConnection {
  private inputHandlers: Array<(event: InputEvent) => void> = [];
  private resizeHandlers: Array<(width: number, height: number) => void> = [];
  private _width: number;
  private _height: number;

  /** All messages sent by the app, in order. */
  readonly messages: RecordedMessage[] = [];

  /** The last tree set by the app. */
  lastTree: VNode | null = null;

  /** The output mode for this connection. */
  readonly outputMode: OutputMode;

  constructor(width = 800, height = 600, outputMode?: OutputMode) {
    this._width = width;
    this._height = height;
    this.outputMode = outputMode ?? { type: 'headless' };
  }

  get width(): number { return this._width; }
  get height(): number { return this._height; }

  setTree(root: VNode): void {
    this.lastTree = root;
    this.messages.push({ kind: 'tree', root });
  }

  patch(ops: PatchOp[]): void {
    this.messages.push({ kind: 'patch', ops });
  }

  defineSlot(slot: number, value: SlotValue): void {
    this.messages.push({ kind: 'define', slot, value });
  }

  defineSchema(slot: number, columns: SchemaColumn[]): void {
    this.messages.push({ kind: 'schema', slot, columns });
  }

  emitData(schemaSlot: number, row: unknown[] | Record<string, unknown>): void {
    this.messages.push({ kind: 'data', schemaSlot, row });
  }

  onInput(handler: (event: InputEvent) => void): void {
    this.inputHandlers.push(handler);
  }

  onResize(handler: (width: number, height: number) => void): void {
    this.resizeHandlers.push(handler);
  }

  /** Simulate an input event from the viewer. */
  simulateInput(event: InputEvent): void {
    for (const handler of this.inputHandlers) {
      handler(event);
    }
  }

  /** Simulate a resize event. */
  simulateResize(width: number, height: number): void {
    this._width = width;
    this._height = height;
    for (const handler of this.resizeHandlers) {
      handler(width, height);
    }
  }
}

export type RecordedMessage =
  | { kind: 'tree'; root: VNode }
  | { kind: 'patch'; ops: PatchOp[] }
  | { kind: 'define'; slot: number; value: SlotValue }
  | { kind: 'schema'; slot: number; columns: SchemaColumn[] }
  | { kind: 'data'; schemaSlot: number; row: unknown[] | Record<string, unknown> };
