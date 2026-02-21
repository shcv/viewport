/**
 * Headless viewer — maintains render tree state, produces text
 * projection, collects metrics. No actual rendering.
 *
 * This is the primary viewer for testing and CI. It consumes protocol
 * messages, updates an in-memory render tree, and exposes the full
 * ViewerBackend interface.
 */

import type {
  ViewerBackend,
  ViewerMetrics,
  ScreenshotResult,
  ProtocolMessage,
  RenderTree,
  InputEvent,
  EnvInfo,
} from '../../core/types.js';
import { MessageType } from '../../core/types.js';
import {
  createRenderTree,
  setTreeRoot,
  applyPatches,
  countNodes,
  treeDepth,
  walkTree,
  findNodes,
} from '../../core/tree.js';
import { textProjection } from '../../core/text-projection.js';

export class HeadlessViewer implements ViewerBackend {
  readonly name = 'Headless Viewer';

  private tree: RenderTree = createRenderTree();
  private messageHandlers: Array<(msg: ProtocolMessage) => void> = [];
  private metrics: InternalMetrics = createMetrics();
  private env: EnvInfo | null = null;

  init(env: EnvInfo): void {
    this.env = env;
    this.tree = createRenderTree();
    this.metrics = createMetrics();
  }

  processMessage(msg: ProtocolMessage): void {
    const start = performance.now();
    this.metrics.messagesProcessed++;

    switch (msg.type) {
      case MessageType.DEFINE:
        this.tree.slots.set(msg.slot, msg.value);
        this.metrics.slotCount = this.tree.slots.size;
        break;

      case MessageType.TREE:
        setTreeRoot(this.tree, msg.root);
        this.metrics.treeNodeCount = countNodes(this.tree.root);
        this.metrics.treeDepth = treeDepth(this.tree.root);
        break;

      case MessageType.PATCH: {
        const { applied, failed } = applyPatches(this.tree, msg.ops);
        this.metrics.patchesApplied += applied;
        this.metrics.patchesFailed += failed;
        this.metrics.treeNodeCount = countNodes(this.tree.root);
        this.metrics.treeDepth = treeDepth(this.tree.root);
        break;
      }

      case MessageType.SCHEMA:
        this.tree.schemas.set(msg.slot, msg.columns);
        break;

      case MessageType.DATA: {
        const schemaSlot = msg.schema ?? 0;
        if (!this.tree.dataRows.has(schemaSlot)) {
          this.tree.dataRows.set(schemaSlot, []);
        }
        if (Array.isArray(msg.row)) {
          this.tree.dataRows.get(schemaSlot)!.push(msg.row);
        }
        this.metrics.dataRowCount++;
        break;
      }

      case MessageType.INPUT:
        // Forward input to registered handlers
        for (const handler of this.messageHandlers) {
          handler(msg);
        }
        break;

      case MessageType.ENV:
        this.env = msg.env;
        break;
    }

    const elapsed = performance.now() - start;
    this.metrics.frameTimes.push(elapsed);
    if (this.metrics.frameTimes.length > 1000) {
      this.metrics.frameTimes = this.metrics.frameTimes.slice(-500);
    }
    this.metrics.lastFrameTimeMs = elapsed;
    this.metrics.peakFrameTimeMs = Math.max(this.metrics.peakFrameTimeMs, elapsed);
  }

  getTree(): RenderTree {
    return this.tree;
  }

  getTextProjection(): string {
    return textProjection(this.tree);
  }

  async screenshot(): Promise<ScreenshotResult> {
    // Headless viewer produces an ANSI text representation
    const text = this.renderToAnsi();
    return {
      format: 'ansi',
      data: text,
      width: this.env?.displayWidth ?? 800,
      height: this.env?.displayHeight ?? 600,
    };
  }

  getMetrics(): ViewerMetrics {
    const ft = this.metrics.frameTimes;
    const avg = ft.length > 0 ? ft.reduce((a, b) => a + b, 0) / ft.length : 0;

    return {
      messagesProcessed: this.metrics.messagesProcessed,
      bytesReceived: this.metrics.bytesReceived,
      lastFrameTimeMs: this.metrics.lastFrameTimeMs,
      peakFrameTimeMs: this.metrics.peakFrameTimeMs,
      avgFrameTimeMs: avg,
      memoryUsageBytes: this.estimateMemory(),
      treeNodeCount: this.metrics.treeNodeCount,
      treeDepth: this.metrics.treeDepth,
      slotCount: this.metrics.slotCount,
      dataRowCount: this.metrics.dataRowCount,
      frameTimesMs: [...ft],
    };
  }

  sendInput(event: InputEvent): void {
    const msg: ProtocolMessage = { type: MessageType.INPUT, event };
    for (const handler of this.messageHandlers) {
      handler(msg);
    }
  }

  onMessage(handler: (msg: ProtocolMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  destroy(): void {
    this.messageHandlers = [];
    this.tree = createRenderTree();
    this.metrics = createMetrics();
  }

  /** Track bytes for metrics (called by harness). */
  trackBytes(n: number): void {
    this.metrics.bytesReceived += n;
  }

  // ── Internal helpers ───────────────────────────────────────────

  /** Render the tree to a simple ANSI text representation. */
  private renderToAnsi(): string {
    if (!this.tree.root) return '(empty tree)';

    const lines: string[] = [];
    walkTree(this.tree.root, (node, depth) => {
      const indent = '  '.repeat(depth);
      const idStr = `#${node.id}`;

      switch (node.type) {
        case 'text':
          lines.push(`${indent}${node.props.content ?? ''}`);
          break;
        case 'box':
          lines.push(`${indent}[box${idStr} ${node.props.direction ?? 'col'}]`);
          break;
        case 'scroll':
          lines.push(`${indent}[scroll${idStr}]`);
          break;
        case 'input':
          lines.push(`${indent}[input${idStr}: ${node.props.value ?? node.props.placeholder ?? ''}]`);
          break;
        case 'separator':
          lines.push(`${indent}────────────────`);
          break;
        case 'canvas':
          lines.push(`${indent}[canvas${idStr}: ${node.props.altText ?? ''}]`);
          break;
        case 'image':
          lines.push(`${indent}[image${idStr}: ${node.props.altText ?? ''}]`);
          break;
      }
    });

    return lines.join('\n');
  }

  /** Rough memory estimate for the tree. */
  private estimateMemory(): number {
    let bytes = 0;
    // Rough per-node estimate: 200 bytes for props + overhead
    bytes += this.metrics.treeNodeCount * 200;
    // Slots
    bytes += this.metrics.slotCount * 100;
    // Data rows: rough estimate
    bytes += this.metrics.dataRowCount * 50;
    // Index map overhead
    bytes += this.tree.nodeIndex.size * 32;

    return bytes;
  }
}

interface InternalMetrics {
  messagesProcessed: number;
  bytesReceived: number;
  lastFrameTimeMs: number;
  peakFrameTimeMs: number;
  treeNodeCount: number;
  treeDepth: number;
  slotCount: number;
  dataRowCount: number;
  patchesApplied: number;
  patchesFailed: number;
  frameTimes: number[];
}

function createMetrics(): InternalMetrics {
  return {
    messagesProcessed: 0,
    bytesReceived: 0,
    lastFrameTimeMs: 0,
    peakFrameTimeMs: 0,
    treeNodeCount: 0,
    treeDepth: 0,
    slotCount: 0,
    dataRowCount: 0,
    patchesApplied: 0,
    patchesFailed: 0,
    frameTimes: [],
  };
}

/** Create a new headless viewer instance. */
export function createHeadlessViewer(): HeadlessViewer {
  return new HeadlessViewer();
}
