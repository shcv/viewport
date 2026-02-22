/**
 * ANSI Terminal Viewer — renders the Viewport render tree to ANSI
 * terminal escape sequences for display in a terminal emulator.
 *
 * Supports:
 * - Flexbox-like layout (row/column direction)
 * - Text styling (bold, italic, underline, color)
 * - Box borders using Unicode box-drawing characters
 * - Separator lines
 * - Input field rendering
 * - Scrollable region clipping
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
  NodeProps,
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

// ── ANSI escape codes ──────────────────────────────────────────────

const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const ITALIC = `${ESC}3m`;
const UNDERLINE = `${ESC}4m`;
const STRIKETHROUGH = `${ESC}9m`;

function fg(color: string): string {
  const rgb = parseColor(color);
  if (!rgb) return '';
  return `${ESC}38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

function bg(color: string): string {
  const rgb = parseColor(color);
  if (!rgb) return '';
  return `${ESC}48;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

function parseColor(color: string): [number, number, number] | null {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16),
        parseInt(hex[1] + hex[1], 16),
        parseInt(hex[2] + hex[2], 16),
      ];
    }
    if (hex.length === 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    }
  }
  // Named colors (common subset)
  const named: Record<string, [number, number, number]> = {
    red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255],
    white: [255, 255, 255], black: [0, 0, 0], yellow: [255, 255, 0],
    cyan: [0, 255, 255], magenta: [255, 0, 255], gray: [128, 128, 128],
    grey: [128, 128, 128], orange: [255, 165, 0],
  };
  return named[color.toLowerCase()] ?? null;
}

// ── Cell-based terminal buffer ─────────────────────────────────────

interface Cell {
  char: string;
  style: string;
}

class TerminalBuffer {
  private cells: Cell[][];
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.cells = [];
    for (let y = 0; y < height; y++) {
      const row: Cell[] = [];
      for (let x = 0; x < width; x++) {
        row.push({ char: ' ', style: '' });
      }
      this.cells.push(row);
    }
  }

  set(x: number, y: number, char: string, style: string): void {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
      this.cells[y][x] = { char: char[0] ?? ' ', style };
    }
  }

  writeString(x: number, y: number, text: string, style: string): number {
    let col = x;
    for (const ch of text) {
      if (col >= this.width) break;
      if (col >= 0) {
        this.set(col, y, ch, style);
      }
      col++;
    }
    return col - x;
  }

  drawHLine(x: number, y: number, width: number, char: string, style: string): void {
    for (let i = 0; i < width; i++) {
      this.set(x + i, y, char, style);
    }
  }

  drawVLine(x: number, y: number, height: number, char: string, style: string): void {
    for (let i = 0; i < height; i++) {
      this.set(x, y + i, char, style);
    }
  }

  drawBox(x: number, y: number, w: number, h: number, style: string): void {
    if (w < 2 || h < 2) return;
    this.set(x, y, '┌', style);
    this.set(x + w - 1, y, '┐', style);
    this.set(x, y + h - 1, '└', style);
    this.set(x + w - 1, y + h - 1, '┘', style);
    this.drawHLine(x + 1, y, w - 2, '─', style);
    this.drawHLine(x + 1, y + h - 1, w - 2, '─', style);
    this.drawVLine(x, y + 1, h - 2, '│', style);
    this.drawVLine(x + w - 1, y + 1, h - 2, '│', style);
  }

  render(): string {
    const lines: string[] = [];
    for (const row of this.cells) {
      let line = '';
      let lastStyle = '';
      for (const cell of row) {
        if (cell.style !== lastStyle) {
          if (lastStyle) line += RESET;
          if (cell.style) line += cell.style;
          lastStyle = cell.style;
        }
        line += cell.char;
      }
      if (lastStyle) line += RESET;
      lines.push(line);
    }
    // Trim trailing empty lines
    while (lines.length > 0 && lines[lines.length - 1].replace(/\x1b\[[^m]*m/g, '').trim() === '') {
      lines.pop();
    }
    return lines.join('\n');
  }
}

// ── Layout rectangle ───────────────────────────────────────────────

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ── Viewer class ───────────────────────────────────────────────────

export class AnsiViewer implements ViewerBackend {
  readonly name = 'ANSI Terminal Viewer';

  private tree: RenderTree = createRenderTree();
  private messageHandlers: Array<(msg: ProtocolMessage) => void> = [];
  private _metrics: AnsiInternalMetrics = createAnsiMetrics();
  private env: EnvInfo | null = null;

  init(env: EnvInfo): void {
    this.env = env;
    this.tree = createRenderTree();
    this._metrics = createAnsiMetrics();
  }

  processMessage(msg: ProtocolMessage): void {
    const start = performance.now();
    this._metrics.messagesProcessed++;

    switch (msg.type) {
      case MessageType.DEFINE:
        this.tree.slots.set(msg.slot, msg.value);
        this._metrics.slotCount = this.tree.slots.size;
        break;

      case MessageType.TREE:
        setTreeRoot(this.tree, msg.root);
        this._metrics.treeNodeCount = countNodes(this.tree.root);
        this._metrics.treeDepth = treeDepth(this.tree.root);
        break;

      case MessageType.PATCH: {
        const { applied, failed } = applyPatches(this.tree, msg.ops);
        this._metrics.patchesApplied += applied;
        this._metrics.patchesFailed += failed;
        this._metrics.treeNodeCount = countNodes(this.tree.root);
        this._metrics.treeDepth = treeDepth(this.tree.root);
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
        const rowArray = toRowArray(msg.row, schemaSlot, this.tree);
        if (rowArray) {
          this.tree.dataRows.get(schemaSlot)!.push(rowArray);
        }
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
    const cols = Math.floor((this.env?.displayWidth ?? 800) / 8); // ~8px per char
    const rows = Math.floor((this.env?.displayHeight ?? 600) / 16); // ~16px per char
    const buf = new TerminalBuffer(Math.min(cols, 120), Math.min(rows, 40));

    if (this.tree.root) {
      this.renderNode(this.tree.root, buf, { x: 0, y: 0, w: buf.width, h: buf.height });
    }

    return {
      format: 'ansi',
      data: buf.render(),
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
    this._metrics = createAnsiMetrics();
  }

  trackBytes(n: number): void {
    this._metrics.bytesReceived += n;
  }

  // ── Rendering ─────────────────────────────────────────────────

  private renderNode(node: RenderNode, buf: TerminalBuffer, rect: Rect): void {
    if (rect.w <= 0 || rect.h <= 0) return;

    const style = this.nodeStyle(node);

    switch (node.type) {
      case 'text':
        this.renderText(node, buf, rect, style);
        break;

      case 'box':
        this.renderBox(node, buf, rect, style);
        break;

      case 'scroll':
        this.renderScroll(node, buf, rect, style);
        break;

      case 'input':
        this.renderInput(node, buf, rect, style);
        break;

      case 'separator':
        buf.drawHLine(rect.x, rect.y, rect.w, '─', style);
        break;

      case 'canvas':
      case 'image': {
        const alt = node.props.altText ?? (node.type === 'canvas' ? '[canvas]' : '[image]');
        buf.writeString(rect.x, rect.y, alt.slice(0, rect.w), DIM);
        break;
      }
    }
  }

  private renderText(node: RenderNode, buf: TerminalBuffer, rect: Rect, style: string): void {
    const content = node.props.content ?? '';
    const lines = content.split('\n');
    for (let i = 0; i < lines.length && rect.y + i < rect.y + rect.h; i++) {
      buf.writeString(rect.x, rect.y + i, lines[i].slice(0, rect.w), style);
    }
  }

  private renderBox(node: RenderNode, buf: TerminalBuffer, rect: Rect, style: string): void {
    const hasBorder = !!node.props.border;
    let innerRect = { ...rect };

    if (hasBorder) {
      const borderStyle = node.props.border?.color
        ? fg(String(node.props.border.color))
        : '';
      buf.drawBox(rect.x, rect.y, rect.w, rect.h, borderStyle);
      innerRect = {
        x: rect.x + 1,
        y: rect.y + 1,
        w: Math.max(0, rect.w - 2),
        h: Math.max(0, rect.h - 2),
      };
    }

    // Apply padding
    const pad = this.getPadding(node.props);
    innerRect.x += pad.left;
    innerRect.y += pad.top;
    innerRect.w = Math.max(0, innerRect.w - pad.left - pad.right);
    innerRect.h = Math.max(0, innerRect.h - pad.top - pad.bottom);

    if (node.children.length === 0) return;

    const isRow = node.props.direction === 'row';
    const gap = node.props.gap ?? 0;
    const childCount = node.children.length;

    if (isRow) {
      // Distribute width equally among children
      const totalGap = gap * (childCount - 1);
      const childWidth = Math.max(1, Math.floor((innerRect.w - totalGap) / childCount));
      let x = innerRect.x;
      for (const child of node.children) {
        const w = Math.min(childWidth, innerRect.x + innerRect.w - x);
        this.renderNode(child, buf, { x, y: innerRect.y, w, h: innerRect.h });
        x += childWidth + gap;
      }
    } else {
      // Stack vertically, allocate height by content
      const childHeight = Math.max(1, Math.floor((innerRect.h - gap * (childCount - 1)) / childCount));
      let y = innerRect.y;
      for (const child of node.children) {
        const h = this.estimateNodeHeight(child, innerRect.w);
        const allocH = Math.min(h, innerRect.y + innerRect.h - y);
        this.renderNode(child, buf, { x: innerRect.x, y, w: innerRect.w, h: allocH });
        y += allocH + gap;
      }
    }
  }

  private renderScroll(node: RenderNode, buf: TerminalBuffer, rect: Rect, style: string): void {
    // Render children within the scroll area
    let y = rect.y;
    for (const child of node.children) {
      const h = this.estimateNodeHeight(child, rect.w);
      if (y + h > rect.y + rect.h) break; // clip
      this.renderNode(child, buf, { x: rect.x, y, w: rect.w, h });
      y += h;
    }
  }

  private renderInput(node: RenderNode, buf: TerminalBuffer, rect: Rect, style: string): void {
    const value = node.props.value ?? '';
    const placeholder = node.props.placeholder ?? '';
    const display = value || placeholder;
    const displayStyle = value ? style : DIM;

    // Draw input frame
    const prefix = '> ';
    buf.writeString(rect.x, rect.y, prefix, DIM);
    buf.writeString(rect.x + prefix.length, rect.y, display.slice(0, rect.w - prefix.length), displayStyle);
  }

  private nodeStyle(node: RenderNode): string {
    let style = '';
    const props = node.props;

    if (props.weight === 'bold') style += BOLD;
    else if (props.weight === 'light') style += DIM;
    if (props.italic) style += ITALIC;
    if (props.decoration === 'underline') style += UNDERLINE;
    else if (props.decoration === 'strikethrough') style += STRIKETHROUGH;

    if (props.color && typeof props.color === 'string') {
      style += fg(props.color);
    }
    if (props.background && typeof props.background === 'string') {
      style += bg(props.background);
    }

    return style;
  }

  private getPadding(props: NodeProps): { top: number; right: number; bottom: number; left: number } {
    const p = props.padding;
    if (p === undefined) return { top: 0, right: 0, bottom: 0, left: 0 };
    if (typeof p === 'number') {
      // Scale down for terminal (1 unit ≈ 1/8 char)
      const v = Math.max(0, Math.round(p / 8));
      return { top: v, right: v, bottom: v, left: v };
    }
    if (Array.isArray(p) && p.length === 2) {
      const py = Math.round(p[0] / 8);
      const px = Math.round(p[1] / 8);
      return { top: py, right: px, bottom: py, left: px };
    }
    if (Array.isArray(p) && p.length === 4) {
      return {
        top: Math.round(p[0] / 8),
        right: Math.round(p[1] / 8),
        bottom: Math.round(p[2] / 8),
        left: Math.round(p[3] / 8),
      };
    }
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }

  private estimateNodeHeight(node: RenderNode, width: number): number {
    switch (node.type) {
      case 'text': {
        const content = node.props.content ?? '';
        const lines = content.split('\n');
        return Math.max(1, lines.length);
      }
      case 'separator':
        return 1;
      case 'input':
        return node.props.multiline ? 3 : 1;
      case 'box': {
        if (node.props.direction === 'row') {
          return Math.max(1, ...node.children.map(c => this.estimateNodeHeight(c, width)));
        }
        const gap = node.props.gap ?? 0;
        return node.children.reduce(
          (sum, c) => sum + this.estimateNodeHeight(c, width) + gap, 0
        ) - (node.children.length > 0 ? gap : 0) || 1;
      }
      case 'scroll':
        return Math.min(
          node.children.reduce((sum, c) => sum + this.estimateNodeHeight(c, width), 0),
          10 // clip scroll height
        ) || 1;
      default:
        return 1;
    }
  }

  private estimateMemory(): number {
    let bytes = 0;
    bytes += this._metrics.treeNodeCount * 200;
    bytes += this._metrics.slotCount * 100;
    bytes += this._metrics.dataRowCount * 50;
    bytes += this.tree.nodeIndex.size * 32;
    return bytes;
  }
}

// ── Internal metrics ──────────────────────────────────────────────

interface AnsiInternalMetrics {
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

function createAnsiMetrics(): AnsiInternalMetrics {
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

/** Create a new ANSI terminal viewer instance. */
export function createAnsiViewer(): AnsiViewer {
  return new AnsiViewer();
}
