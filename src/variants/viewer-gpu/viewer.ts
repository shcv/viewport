/**
 * GPU Viewer — ViewerBackend implementation for the GPU rendering path.
 *
 * This implementation has two modes:
 *
 * 1. **Software fallback** (default): Processes messages and maintains
 *    render tree state, generates GPU command lists, but renders to a
 *    simple text representation. Used for testing and CI.
 *
 * 2. **Native GPU** (when NativeGpuBridge is provided): Forwards
 *    command lists to a native renderer for actual GPU-accelerated
 *    rendering via wgpu.
 *
 * The GPU viewer uses the pure-TS layout engine for computing layout
 * rectangles, which are then converted to GPU render commands.
 */

import type {
  ViewerBackend,
  ViewerMetrics,
  ScreenshotResult,
  ProtocolMessage,
  RenderTree,
  RenderNode,
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
  toRowArray,
} from '../../core/tree.js';
import { textProjection } from '../../core/text-projection.js';
import { computeLayout } from '../../core/layout.js';
import type { GpuConfig, GpuCommand, NativeGpuBridge } from './types.js';

const DEFAULT_CONFIG: GpuConfig = {
  api: 'vulkan',
  msaa: 4,
  targetFps: 60,
  clearColor: [1, 1, 1, 1],
  font: { family: 'Inter', sizePx: 14 },
  layoutEngine: 'pure-ts',
  debug: { wireframe: false, layoutBounds: false, textAtlas: false, gpuTimings: false },
};

export class GpuViewer implements ViewerBackend {
  readonly name = 'GPU Viewer';

  private tree: RenderTree = createRenderTree();
  private messageHandlers: Array<(msg: ProtocolMessage) => void> = [];
  private _metrics: GpuInternalMetrics = createGpuMetrics();
  private env: EnvInfo | null = null;
  private config: GpuConfig;
  private nativeBridge: NativeGpuBridge | null;
  private dirty = false;
  private lastCommandList: GpuCommand[] = [];

  constructor(config?: Partial<GpuConfig>, nativeBridge?: NativeGpuBridge) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.nativeBridge = nativeBridge ?? null;
  }

  init(env: EnvInfo): void {
    this.env = env;
    this.tree = createRenderTree();
    this._metrics = createGpuMetrics();
    this.dirty = true;
  }

  processMessage(msg: ProtocolMessage, seq?: bigint): void {
    const start = performance.now();
    const version = seq ?? 0n;
    this._metrics.messagesProcessed++;

    switch (msg.type) {
      case MessageType.DEFINE: {
        const prev = this.tree.slotVersions.get(msg.slot);
        if (prev !== undefined && version > 0n && prev > version) break;
        this.tree.slots.set(msg.slot, msg.value);
        this.tree.slotVersions.set(msg.slot, version);
        this._metrics.slotCount = this.tree.slots.size;
        this.dirty = true;
        break;
      }

      case MessageType.TREE:
        setTreeRoot(this.tree, msg.root, version);
        this._metrics.treeNodeCount = countNodes(this.tree.root);
        this._metrics.treeDepth = treeDepth(this.tree.root);
        this.dirty = true;
        break;

      case MessageType.PATCH: {
        const { applied, failed } = applyPatches(this.tree, msg.ops, version);
        this._metrics.patchesApplied += applied;
        this._metrics.patchesFailed += failed;
        this._metrics.treeNodeCount = countNodes(this.tree.root);
        this._metrics.treeDepth = treeDepth(this.tree.root);
        this.dirty = true;
        break;
      }

      case MessageType.SCHEMA: {
        const prev = this.tree.schemaVersions.get(msg.slot);
        if (prev !== undefined && version > 0n && prev > version) break;
        this.tree.schemas.set(msg.slot, msg.columns);
        this.tree.schemaVersions.set(msg.slot, version);
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
        this._metrics.dataRowCount++;
        break;
      }

      case MessageType.INPUT:
        for (const handler of this.messageHandlers) {
          handler(msg);
        }
        break;

      case MessageType.ENV:
        this.env = msg.env;
        this.dirty = true;
        break;
    }

    const elapsed = performance.now() - start;
    this._metrics.frameTimes.push(elapsed);
    if (this._metrics.frameTimes.length > 1000) {
      this._metrics.frameTimes = this._metrics.frameTimes.slice(-500);
    }
    this._metrics.lastFrameTimeMs = elapsed;
    this._metrics.peakFrameTimeMs = Math.max(this._metrics.peakFrameTimeMs, elapsed);
  }

  getTree(): RenderTree {
    return this.tree;
  }

  getTextProjection(): string {
    return textProjection(this.tree);
  }

  async screenshot(): Promise<ScreenshotResult> {
    this.render();

    if (this.nativeBridge) {
      const pixels = this.nativeBridge.readPixels();
      return {
        format: 'png',
        data: pixels,
        width: this.env?.displayWidth ?? 800,
        height: this.env?.displayHeight ?? 600,
      };
    }

    // Software fallback: describe the command list as text
    const lines: string[] = [];
    lines.push(`GPU Viewer — ${this.lastCommandList.length} commands`);
    lines.push(`Viewport: ${this.env?.displayWidth ?? 800}x${this.env?.displayHeight ?? 600}`);
    lines.push(`Config: ${this.config.api}, MSAA=${this.config.msaa}, Layout=${this.config.layoutEngine}`);
    lines.push('');

    for (const cmd of this.lastCommandList.slice(0, 50)) {
      switch (cmd.type) {
        case 'rect':
          lines.push(`RECT (${cmd.rect.x.toFixed(0)},${cmd.rect.y.toFixed(0)}) ${cmd.rect.width.toFixed(0)}x${cmd.rect.height.toFixed(0)} rgba(${cmd.rect.color.join(',')})`);
          break;
        case 'text':
          lines.push(`TEXT (${cmd.x.toFixed(0)},${cmd.y.toFixed(0)}) "${cmd.text.slice(0, 40)}" ${cmd.sizePx}px`);
          break;
        case 'clip':
          lines.push(`CLIP (${cmd.rect.x.toFixed(0)},${cmd.rect.y.toFixed(0)}) ${cmd.rect.width.toFixed(0)}x${cmd.rect.height.toFixed(0)}`);
          break;
        case 'unclip':
          lines.push('UNCLIP');
          break;
        case 'image':
          lines.push(`IMAGE (${cmd.x},${cmd.y}) ${cmd.width}x${cmd.height} tex=${cmd.textureId}`);
          break;
      }
    }
    if (this.lastCommandList.length > 50) {
      lines.push(`... and ${this.lastCommandList.length - 50} more commands`);
    }

    return {
      format: 'text',
      data: lines.join('\n'),
      width: this.env?.displayWidth ?? 800,
      height: this.env?.displayHeight ?? 600,
    };
  }

  getMetrics(): ViewerMetrics {
    const ft = this._metrics.frameTimes;
    const avg = ft.length > 0 ? ft.reduce((a, b) => a + b, 0) / ft.length : 0;

    return {
      messagesProcessed: this._metrics.messagesProcessed,
      bytesReceived: this._metrics.bytesReceived,
      lastFrameTimeMs: this._metrics.lastFrameTimeMs,
      peakFrameTimeMs: this._metrics.peakFrameTimeMs,
      avgFrameTimeMs: avg,
      memoryUsageBytes: this.estimateMemory(),
      treeNodeCount: this._metrics.treeNodeCount,
      treeDepth: this._metrics.treeDepth,
      slotCount: this._metrics.slotCount,
      dataRowCount: this._metrics.dataRowCount,
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
    this._metrics = createGpuMetrics();
    this.nativeBridge?.destroy();
  }

  trackBytes(n: number): void {
    this._metrics.bytesReceived += n;
  }

  /** Get the last generated GPU command list (for testing). */
  getCommandList(): GpuCommand[] {
    return [...this.lastCommandList];
  }

  // ── Rendering ─────────────────────────────────────────────────

  private render(): void {
    if (!this.dirty && this.lastCommandList.length > 0) return;
    this.dirty = false;

    const width = this.env?.displayWidth ?? 800;
    const height = this.env?.displayHeight ?? 600;

    // Compute layout
    const layoutResult = computeLayout(this.tree, { width, height });

    // Generate command list
    const commands: GpuCommand[] = [];

    // Clear
    commands.push({
      type: 'rect',
      rect: {
        x: 0, y: 0, width, height,
        color: this.config.clearColor,
      },
    });

    // Walk tree and generate commands
    if (this.tree.root) {
      this.generateCommands(this.tree.root, commands, layoutResult.layouts);
    }

    this.lastCommandList = commands;
    this._metrics.commandCount = commands.length;

    // Submit to native bridge if available
    if (this.nativeBridge) {
      this.nativeBridge.submit(commands);
      this.nativeBridge.present();
    }
  }

  private generateCommands(
    node: RenderNode,
    commands: GpuCommand[],
    layouts: Map<number, { x: number; y: number; width: number; height: number }>,
  ): void {
    const layout = layouts.get(node.id) ?? node.computedLayout;
    if (!layout) return;

    const { x, y, width, height } = layout;

    switch (node.type) {
      case 'box': {
        // Background
        if (node.props.background && typeof node.props.background === 'string') {
          const rgba = cssColorToRgba(node.props.background);
          commands.push({
            type: 'rect',
            rect: {
              x, y, width, height,
              color: rgba,
              cornerRadii: node.props.borderRadius
                ? [node.props.borderRadius, node.props.borderRadius, node.props.borderRadius, node.props.borderRadius]
                : undefined,
            },
          });
        }

        // Border
        if (node.props.border) {
          const borderColor = typeof node.props.border.color === 'string'
            ? cssColorToRgba(node.props.border.color)
            : [0, 0, 0, 1] as [number, number, number, number];
          commands.push({
            type: 'rect',
            rect: {
              x, y, width, height,
              color: [0, 0, 0, 0],
              borderWidth: node.props.border.width ?? 1,
              borderColor,
            },
          });
        }
        break;
      }

      case 'text': {
        const color = typeof node.props.color === 'string'
          ? cssColorToRgba(node.props.color)
          : [0, 0, 0, 1] as [number, number, number, number];
        commands.push({
          type: 'text',
          x, y,
          text: node.props.content ?? '',
          color,
          sizePx: (node.props.size as number) ?? this.config.font.sizePx,
        });
        break;
      }

      case 'scroll': {
        // Set up clip region
        commands.push({
          type: 'clip',
          rect: { x, y, width, height, color: [0, 0, 0, 0] },
        });
        // Children rendered below
        break;
      }

      case 'input': {
        // Input background
        commands.push({
          type: 'rect',
          rect: {
            x, y, width, height,
            color: [0.98, 0.98, 0.98, 1],
            borderWidth: 1,
            borderColor: [0.8, 0.8, 0.8, 1],
            cornerRadii: [4, 4, 4, 4],
          },
        });
        // Input text
        const displayText = node.props.value || node.props.placeholder || '';
        const textColor: [number, number, number, number] = node.props.value
          ? [0, 0, 0, 1]
          : [0.6, 0.6, 0.6, 1];
        commands.push({
          type: 'text',
          x: x + 8, y: y + 4,
          text: displayText,
          color: textColor,
          sizePx: this.config.font.sizePx,
        });
        break;
      }

      case 'separator': {
        commands.push({
          type: 'rect',
          rect: {
            x, y: y + height / 2,
            width, height: 1,
            color: [0.8, 0.8, 0.8, 1],
          },
        });
        break;
      }

      case 'image': {
        commands.push({
          type: 'image',
          x, y, width, height,
          textureId: 0, // placeholder
        });
        break;
      }

      case 'canvas': {
        commands.push({
          type: 'rect',
          rect: {
            x, y, width, height,
            color: [0.94, 0.94, 0.94, 1],
          },
        });
        break;
      }
    }

    // Render children
    for (const child of node.children) {
      this.generateCommands(child, commands, layouts);
    }

    // Pop clip for scroll regions
    if (node.type === 'scroll') {
      commands.push({ type: 'unclip' });
    }
  }

  private estimateMemory(): number {
    let bytes = 0;
    bytes += this._metrics.treeNodeCount * 200;
    bytes += this._metrics.slotCount * 100;
    bytes += this._metrics.dataRowCount * 50;
    bytes += this.tree.nodeIndex.size * 32;
    bytes += this._metrics.commandCount * 64; // GPU command list
    return bytes;
  }
}

// ── Color helpers ─────────────────────────────────────────────────

function cssColorToRgba(color: string): [number, number, number, number] {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16) / 255,
        parseInt(hex[1] + hex[1], 16) / 255,
        parseInt(hex[2] + hex[2], 16) / 255,
        1,
      ];
    }
    if (hex.length === 6) {
      return [
        parseInt(hex.slice(0, 2), 16) / 255,
        parseInt(hex.slice(2, 4), 16) / 255,
        parseInt(hex.slice(4, 6), 16) / 255,
        1,
      ];
    }
  }
  return [0, 0, 0, 1];
}

// ── Internal metrics ──────────────────────────────────────────────

interface GpuInternalMetrics {
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
  commandCount: number;
}

function createGpuMetrics(): GpuInternalMetrics {
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
    commandCount: 0,
  };
}

/** Create a new GPU viewer instance. */
export function createGpuViewer(config?: Partial<GpuConfig>, nativeBridge?: NativeGpuBridge): GpuViewer {
  return new GpuViewer(config, nativeBridge);
}
