/**
 * Core test harness.
 *
 * Connects an app → protocol backend → viewer backend, with full
 * instrumentation of the message pipeline. This is the central
 * orchestrator that the runner, automation, and MCP server all use.
 */

import type {
  AppFactory,
  AppInstance,
  AppConnection,
  ProtocolBackend,
  ViewerBackend,
  ProtocolMessage,
  InputEvent,
  VNode,
  PatchOp,
  SlotValue,
  SchemaColumn,
  EnvInfo,
  RenderTree,
  ViewerMetrics,
  ScreenshotResult,
} from '../core/types.js';
import { MessageType } from '../core/types.js';

export interface HarnessConfig {
  app: AppFactory;
  protocol: ProtocolBackend;
  viewer: ViewerBackend;
  env?: Partial<EnvInfo>;
}

export interface MessageRecord {
  timestamp: number;
  direction: 'app-to-viewer' | 'viewer-to-app';
  type: MessageType;
  rawBytes: number;
  encodeTimeMs: number;
  decodeTimeMs: number;
  processTimeMs: number;
  message: ProtocolMessage;
}

export class TestHarness {
  readonly app: AppFactory;
  readonly protocol: ProtocolBackend;
  readonly viewer: ViewerBackend;

  private appInstance: AppInstance | null = null;
  private inputHandlers: Array<(event: InputEvent) => void> = [];
  private resizeHandlers: Array<(width: number, height: number) => void> = [];
  private messageLog: MessageRecord[] = [];
  private _width: number;
  private _height: number;
  private startTime: number = 0;

  constructor(config: HarnessConfig) {
    this.app = config.app;
    this.protocol = config.protocol;
    this.viewer = config.viewer;
    this._width = config.env?.displayWidth ?? 800;
    this._height = config.env?.displayHeight ?? 600;
  }

  /** Initialize the harness: set up viewer, connect app. */
  start(): void {
    this.startTime = performance.now();

    // Initialize viewer
    const env: EnvInfo = {
      viewportVersion: 1,
      displayWidth: this._width,
      displayHeight: this._height,
      pixelDensity: 2.0,
      gpu: false,
      colorDepth: 8,
      remote: false,
      latencyMs: 0,
    };
    this.viewer.init(env);

    // Wire viewer's outbound messages (INPUT events) to app
    this.viewer.onMessage((msg) => {
      if (msg.type === MessageType.INPUT) {
        for (const handler of this.inputHandlers) {
          handler(msg.event);
        }
      }
    });

    // Create instrumented connection for the app
    const connection = this.createConnection();

    // Start the app
    this.appInstance = this.app.create(connection);
  }

  /** Tear down. */
  stop(): void {
    this.appInstance?.destroy?.();
    this.viewer.destroy();
    this.appInstance = null;
  }

  /** Send an input event through the pipeline. */
  sendInput(event: InputEvent): void {
    // Record as viewer-to-app message
    const msg: ProtocolMessage = { type: MessageType.INPUT, event };
    this.recordMessage('viewer-to-app', msg, 0, 0, 0, 0);

    // Deliver to app's input handlers
    for (const handler of this.inputHandlers) {
      handler(event);
    }
  }

  /** Resize the viewport. */
  resize(width: number, height: number): void {
    this._width = width;
    this._height = height;
    for (const handler of this.resizeHandlers) {
      handler(width, height);
    }
  }

  /** Get the current render tree. */
  getTree(): RenderTree {
    return this.viewer.getTree();
  }

  /** Get the text projection. */
  getTextProjection(): string {
    return this.viewer.getTextProjection();
  }

  /** Get a screenshot from the viewer. */
  async screenshot(): Promise<ScreenshotResult> {
    return this.viewer.screenshot();
  }

  /** Get viewer metrics. */
  getViewerMetrics(): ViewerMetrics {
    return this.viewer.getMetrics();
  }

  /** Get the full message log. */
  getMessageLog(): MessageRecord[] {
    return [...this.messageLog];
  }

  /** Get aggregate harness metrics. */
  getHarnessMetrics(): HarnessMetrics {
    const appToViewer = this.messageLog.filter((m) => m.direction === 'app-to-viewer');
    const totalBytes = appToViewer.reduce((sum, m) => sum + m.rawBytes, 0);
    const totalEncodeTime = appToViewer.reduce((sum, m) => sum + m.encodeTimeMs, 0);
    const totalDecodeTime = appToViewer.reduce((sum, m) => sum + m.decodeTimeMs, 0);
    const totalProcessTime = appToViewer.reduce((sum, m) => sum + m.processTimeMs, 0);

    const byType = new Map<MessageType, { count: number; bytes: number }>();
    for (const m of appToViewer) {
      const entry = byType.get(m.type) ?? { count: 0, bytes: 0 };
      entry.count++;
      entry.bytes += m.rawBytes;
      byType.set(m.type, entry);
    }

    return {
      totalMessages: this.messageLog.length,
      appToViewerMessages: appToViewer.length,
      totalWireBytes: totalBytes,
      totalEncodeTimeMs: totalEncodeTime,
      totalDecodeTimeMs: totalDecodeTime,
      totalProcessTimeMs: totalProcessTime,
      messagesByType: Object.fromEntries(byType),
      elapsedMs: performance.now() - this.startTime,
      viewerMetrics: this.viewer.getMetrics(),
      encodeTimesMs: appToViewer.map((m) => m.encodeTimeMs),
      decodeTimesMs: appToViewer.map((m) => m.decodeTimeMs),
    };
  }

  /** Clear the message log (useful between test phases). */
  clearLog(): void {
    this.messageLog = [];
  }

  get width(): number { return this._width; }
  get height(): number { return this._height; }

  // ── Internal ─────────────────────────────────────────────────

  private createConnection(): AppConnection {
    const self = this;

    return {
      get width() { return self._width; },
      get height() { return self._height; },

      setTree(root: VNode): void {
        self.pipeToViewer({ type: MessageType.TREE, root });
      },

      patch(ops: PatchOp[]): void {
        self.pipeToViewer({ type: MessageType.PATCH, ops });
      },

      defineSlot(slot: number, value: SlotValue): void {
        self.pipeToViewer({ type: MessageType.DEFINE, slot, value });
      },

      defineSchema(slot: number, columns: SchemaColumn[]): void {
        self.pipeToViewer({ type: MessageType.SCHEMA, slot, columns });
      },

      emitData(schemaSlot: number, row: unknown[]): void {
        self.pipeToViewer({ type: MessageType.DATA, schema: schemaSlot, row });
      },

      onInput(handler: (event: InputEvent) => void): void {
        self.inputHandlers.push(handler);
      },

      onResize(handler: (width: number, height: number) => void): void {
        self.resizeHandlers.push(handler);
      },
    };
  }

  /** Encode → measure → decode → process pipeline. */
  private pipeToViewer(msg: ProtocolMessage): void {
    // Encode
    const encodeStart = performance.now();
    const encoded = this.protocol.encode(msg);
    const encodeTime = performance.now() - encodeStart;

    // Measure wire bytes
    const wireBytes = encoded.length;

    // Decode
    const decodeStart = performance.now();
    const decoded = this.protocol.decode(encoded);
    const decodeTime = performance.now() - decodeStart;

    // Process in viewer
    const processStart = performance.now();
    // Track bytes if the viewer supports it
    if ('trackBytes' in this.viewer && typeof (this.viewer as any).trackBytes === 'function') {
      (this.viewer as any).trackBytes(wireBytes);
    }
    this.viewer.processMessage(decoded);
    const processTime = performance.now() - processStart;

    // Record
    this.recordMessage('app-to-viewer', msg, wireBytes, encodeTime, decodeTime, processTime);
  }

  private recordMessage(
    direction: 'app-to-viewer' | 'viewer-to-app',
    message: ProtocolMessage,
    rawBytes: number,
    encodeTimeMs: number,
    decodeTimeMs: number,
    processTimeMs: number,
  ): void {
    this.messageLog.push({
      timestamp: performance.now() - this.startTime,
      direction,
      type: message.type,
      rawBytes,
      encodeTimeMs,
      decodeTimeMs,
      processTimeMs,
      message,
    });
  }
}

export interface HarnessMetrics {
  totalMessages: number;
  appToViewerMessages: number;
  totalWireBytes: number;
  totalEncodeTimeMs: number;
  totalDecodeTimeMs: number;
  totalProcessTimeMs: number;
  messagesByType: Record<number, { count: number; bytes: number }>;
  elapsedMs: number;
  viewerMetrics: ViewerMetrics;
  encodeTimesMs: number[];
  decodeTimesMs: number[];
}
