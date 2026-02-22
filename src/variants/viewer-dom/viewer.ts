/**
 * DOM-based viewer — renders the Viewport render tree as HTML.
 *
 * Operates in HTML-string mode: builds the full HTML representation
 * of the render tree for screenshot comparison and visual testing.
 * No browser DOM dependency — pure string generation.
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
  BorderStyle,
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

export class DomViewer implements ViewerBackend {
  readonly name = 'DOM Viewer';

  private tree: RenderTree = createRenderTree();
  private messageHandlers: Array<(msg: ProtocolMessage) => void> = [];
  private _metrics: DomInternalMetrics = createDomMetrics();
  private env: EnvInfo | null = null;

  init(env: EnvInfo): void {
    this.env = env;
    this.tree = createRenderTree();
    this._metrics = createDomMetrics();
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
        break;
      }

      case MessageType.TREE:
        setTreeRoot(this.tree, msg.root, version);
        this._metrics.treeNodeCount = countNodes(this.tree.root);
        this._metrics.treeDepth = treeDepth(this.tree.root);
        break;

      case MessageType.PATCH: {
        const { applied, failed } = applyPatches(this.tree, msg.ops, version);
        this._metrics.patchesApplied += applied;
        this._metrics.patchesFailed += failed;
        this._metrics.treeNodeCount = countNodes(this.tree.root);
        this._metrics.treeDepth = treeDepth(this.tree.root);
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
    const html = this.renderToHtml();
    return {
      format: 'html',
      data: html,
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
    this._metrics = createDomMetrics();
  }

  trackBytes(n: number): void {
    this._metrics.bytesReceived += n;
  }

  // ── HTML rendering ──────────────────────────────────────────────

  private renderToHtml(): string {
    const width = this.env?.displayWidth ?? 800;
    const height = this.env?.displayHeight ?? 600;

    const body = this.tree.root
      ? renderNodeToHtml(this.tree.root)
      : '<p>(empty tree)</p>';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Viewport DOM Viewer</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; width: ${width}px; height: ${height}px; overflow: hidden; }
.vp-box { display: flex; }
.vp-text { display: inline-block; }
.vp-scroll { overflow: auto; }
.vp-input { font-family: inherit; font-size: inherit; }
.vp-separator { border: none; border-top: 1px solid #ccc; margin: 4px 0; }
.vp-canvas { background: #f0f0f0; display: flex; align-items: center; justify-content: center; color: #999; }
.vp-image { max-width: 100%; }
</style>
</head>
<body>
${body}
</body>
</html>`;
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

// ── Node-to-HTML rendering ──────────────────────────────────────────

function renderNodeToHtml(node: RenderNode): string {
  const id = node.id;
  const dataAttr = `data-viewport-id="${id}"`;

  switch (node.type) {
    case 'box': {
      const style = boxStyle(node.props);
      const interactive = node.props.interactive === 'clickable'
        ? ` role="button" tabindex="${node.props.tabIndex ?? 0}"`
        : '';
      const children = node.children.map(renderNodeToHtml).join('\n');
      return `<div class="vp-box" ${dataAttr} style="${style}"${interactive}>\n${children}\n</div>`;
    }

    case 'text': {
      const style = textStyle(node.props);
      return `<span class="vp-text" ${dataAttr} style="${style}">${escapeHtml(node.props.content ?? '')}</span>`;
    }

    case 'scroll': {
      const style = scrollStyle(node.props);
      const children = node.children.map(renderNodeToHtml).join('\n');
      return `<div class="vp-scroll" ${dataAttr} style="${style}">\n${children}\n</div>`;
    }

    case 'input': {
      const style = inputStyle(node.props);
      if (node.props.multiline) {
        return `<textarea class="vp-input" ${dataAttr} style="${style}" placeholder="${escapeAttr(node.props.placeholder ?? '')}">${escapeHtml(node.props.value ?? '')}</textarea>`;
      }
      return `<input class="vp-input" ${dataAttr} style="${style}" type="text" value="${escapeAttr(node.props.value ?? '')}" placeholder="${escapeAttr(node.props.placeholder ?? '')}"${node.props.disabled ? ' disabled' : ''}>`;
    }

    case 'separator':
      return `<hr class="vp-separator" ${dataAttr}>`;

    case 'canvas': {
      const style = canvasStyle(node.props);
      return `<div class="vp-canvas" ${dataAttr} style="${style}">${escapeHtml(node.props.altText ?? '[canvas]')}</div>`;
    }

    case 'image': {
      const alt = escapeAttr(node.props.altText ?? '');
      const style = imageStyle(node.props);
      return `<img class="vp-image" ${dataAttr} style="${style}" alt="${alt}">`;
    }

    default:
      return `<div ${dataAttr}></div>`;
  }
}

// ── Style generation ──────────────────────────────────────────────

function boxStyle(props: NodeProps): string {
  const parts: string[] = [];
  parts.push(`flex-direction: ${props.direction === 'row' ? 'row' : 'column'}`);

  if (props.wrap) parts.push('flex-wrap: wrap');
  if (props.gap !== undefined) parts.push(`gap: ${props.gap}px`);
  if (props.justify) parts.push(`justify-content: ${cssJustify(props.justify)}`);
  if (props.align) parts.push(`align-items: ${cssAlign(props.align)}`);

  pushSpacing(parts, props);
  pushVisual(parts, props);
  pushSizing(parts, props);

  return parts.join('; ');
}

function textStyle(props: NodeProps): string {
  const parts: string[] = [];

  if (props.fontFamily === 'monospace') parts.push('font-family: monospace');
  if (props.size) parts.push(`font-size: ${props.size}px`);
  if (props.weight === 'bold') parts.push('font-weight: bold');
  else if (props.weight === 'light') parts.push('font-weight: 300');
  if (props.color && typeof props.color === 'string') parts.push(`color: ${props.color}`);
  if (props.decoration === 'underline') parts.push('text-decoration: underline');
  else if (props.decoration === 'strikethrough') parts.push('text-decoration: line-through');
  if (props.textAlign) parts.push(`text-align: ${props.textAlign}`);
  if (props.italic) parts.push('font-style: italic');

  return parts.join('; ');
}

function scrollStyle(props: NodeProps): string {
  const parts: string[] = [];
  if (props.virtualHeight) parts.push(`max-height: ${props.virtualHeight}px`);
  if (props.virtualWidth) parts.push(`max-width: ${props.virtualWidth}px`);

  pushSpacing(parts, props);
  pushVisual(parts, props);
  pushSizing(parts, props);

  return parts.join('; ');
}

function inputStyle(props: NodeProps): string {
  const parts: string[] = [];
  if (props.width) parts.push(`width: ${typeof props.width === 'number' ? props.width + 'px' : props.width}`);
  return parts.join('; ');
}

function canvasStyle(props: NodeProps): string {
  const parts: string[] = [];
  pushSizing(parts, props);
  return parts.join('; ');
}

function imageStyle(props: NodeProps): string {
  const parts: string[] = [];
  pushSizing(parts, props);
  return parts.join('; ');
}

function pushSpacing(parts: string[], props: NodeProps): void {
  if (props.padding !== undefined) {
    parts.push(`padding: ${cssSpacing(props.padding)}`);
  }
  if (props.margin !== undefined) {
    parts.push(`margin: ${cssSpacing(props.margin)}`);
  }
}

function pushVisual(parts: string[], props: NodeProps): void {
  if (props.background && typeof props.background === 'string') {
    parts.push(`background: ${props.background}`);
  }
  if (props.opacity !== undefined) parts.push(`opacity: ${props.opacity}`);
  if (props.border) {
    const b = props.border as BorderStyle;
    parts.push(`border: ${b.width ?? 1}px ${b.style ?? 'solid'} ${b.color ?? '#000'}`);
  }
  if (props.borderRadius !== undefined) parts.push(`border-radius: ${props.borderRadius}px`);
  if (props.shadow) {
    const s = props.shadow;
    parts.push(`box-shadow: ${s.x}px ${s.y}px ${s.blur}px ${s.color}`);
  }
}

function pushSizing(parts: string[], props: NodeProps): void {
  if (props.width !== undefined) {
    parts.push(`width: ${typeof props.width === 'number' ? props.width + 'px' : props.width}`);
  }
  if (props.height !== undefined) {
    parts.push(`height: ${typeof props.height === 'number' ? props.height + 'px' : props.height}`);
  }
  if (props.flex !== undefined) parts.push(`flex: ${props.flex}`);
  if (props.minWidth !== undefined) parts.push(`min-width: ${props.minWidth}px`);
  if (props.minHeight !== undefined) parts.push(`min-height: ${props.minHeight}px`);
  if (props.maxWidth !== undefined) parts.push(`max-width: ${props.maxWidth}px`);
  if (props.maxHeight !== undefined) parts.push(`max-height: ${props.maxHeight}px`);
}

function cssSpacing(val: number | [number, number] | [number, number, number, number]): string {
  if (typeof val === 'number') return `${val}px`;
  if (val.length === 2) return `${val[0]}px ${val[1]}px`;
  return `${val[0]}px ${val[1]}px ${val[2]}px ${val[3]}px`;
}

function cssJustify(val: string): string {
  const map: Record<string, string> = {
    start: 'flex-start', end: 'flex-end', center: 'center',
    between: 'space-between', around: 'space-around', evenly: 'space-evenly',
  };
  return map[val] ?? val;
}

function cssAlign(val: string): string {
  const map: Record<string, string> = {
    start: 'flex-start', end: 'flex-end', center: 'center',
    stretch: 'stretch', baseline: 'baseline',
  };
  return map[val] ?? val;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Internal metrics ──────────────────────────────────────────────

interface DomInternalMetrics {
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

function createDomMetrics(): DomInternalMetrics {
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

/** Create a new DOM viewer instance. */
export function createDomViewer(): DomViewer {
  return new DomViewer();
}
