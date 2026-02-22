/**
 * Core Viewport protocol types.
 *
 * These types are the shared language between apps, protocol backends,
 * viewers, and the test harness. They map directly to the concepts in
 * viewport-design.md.
 */

// ── Wire format constants ──────────────────────────────────────────

export const MAGIC = 0x5650; // ASCII 'VP'
export const PROTOCOL_VERSION = 1;

export enum MessageType {
  DEFINE = 0x01,
  TREE = 0x02,
  PATCH = 0x03,
  DATA = 0x04,
  INPUT = 0x05,
  ENV = 0x06,
  REGION = 0x07,
  AUDIO = 0x08,
  CANVAS = 0x09,
  SCHEMA = 0x0a,
}

export interface FrameHeader {
  magic: number;
  version: number;
  type: MessageType;
  length: number; // payload size in bytes (LE u32)
}

// ── Node types ─────────────────────────────────────────────────────

export type NodeType =
  | 'box'
  | 'text'
  | 'scroll'
  | 'input'
  | 'image'
  | 'canvas'
  | 'separator';

export interface BorderStyle {
  width?: number;
  color?: string | number; // color string or slot ref
  style?: 'solid' | 'dashed' | 'dotted' | 'none';
}

export interface ShadowStyle {
  x: number;
  y: number;
  blur: number;
  color: string;
}

// ── VNode: the virtual node tree apps produce ──────────────────────

export interface VNode {
  id: number;
  type: NodeType;
  props: NodeProps;
  children?: VNode[];
  textAlt?: string; // override text projection
}

/**
 * Union of all possible node properties. Which fields are relevant
 * depends on the node type. This keeps the type system simple while
 * allowing the protocol to carry any property.
 */
export interface NodeProps {
  // Box layout
  direction?: 'row' | 'column';
  wrap?: boolean;
  justify?: 'start' | 'end' | 'center' | 'between' | 'around' | 'evenly';
  align?: 'start' | 'end' | 'center' | 'stretch' | 'baseline';
  gap?: number;

  // Spacing
  padding?: number | [number, number] | [number, number, number, number];
  margin?: number | [number, number] | [number, number, number, number];

  // Visual
  border?: BorderStyle;
  borderRadius?: number;
  background?: string | number;
  opacity?: number;
  shadow?: ShadowStyle;

  // Sizing
  width?: number | string;
  height?: number | string;
  flex?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;

  // Text
  content?: string;
  fontFamily?: 'proportional' | 'monospace';
  size?: number;
  weight?: 'normal' | 'bold' | 'light';
  color?: string | number;
  decoration?: 'none' | 'underline' | 'strikethrough';
  textAlign?: 'left' | 'center' | 'right';
  italic?: boolean;

  // Scroll
  virtualHeight?: number;
  virtualWidth?: number;
  scrollTop?: number;
  scrollLeft?: number;
  schema?: number; // slot ref for data schema (display hints for data rows)

  // Input
  value?: string;
  placeholder?: string;
  multiline?: boolean;
  disabled?: boolean;

  // Image
  data?: Uint8Array;
  format?: 'png' | 'jpeg' | 'svg';
  altText?: string;

  // Canvas
  mode?: 'vector2d' | 'webgpu' | 'remote_stream';

  // Interactive behaviors
  interactive?: 'clickable' | 'focusable';
  tabIndex?: number;

  // Style slot reference
  style?: number; // slot ref

  // Transition reference
  transition?: number; // slot ref

  // Any additional properties
  [key: string]: unknown;
}

// ── Slot values (definition table) ─────────────────────────────────

export interface StyleSlot {
  kind: 'style';
  [key: string]: unknown;
}

export interface ColorSlot {
  kind: 'color';
  role: string;
  value: string;
}

export interface KeybindSlot {
  kind: 'keybind';
  action: string;
  key: string;
}

export interface TransitionSlot {
  kind: 'transition';
  role: string;
  durationMs: number;
  easing: string;
}

export interface TextSizeSlot {
  kind: 'text_size';
  role: string;
  value: number;
}

export interface SchemaSlot {
  kind: 'schema';
  columns: SchemaColumn[];
}

export type SlotValue =
  | StyleSlot
  | ColorSlot
  | KeybindSlot
  | TransitionSlot
  | TextSizeSlot
  | SchemaSlot
  | { kind: string; [key: string]: unknown };

// ── Schema ─────────────────────────────────────────────────────────

export interface SchemaColumn {
  id: number;
  name: string;
  type: 'string' | 'uint64' | 'int64' | 'float64' | 'bool' | 'timestamp';
  unit?: string;
  format?: string; // display format hint (e.g. 'human_bytes', 'relative_time')
}

// ── Protocol messages ──────────────────────────────────────────────

export interface DefineMessage {
  type: MessageType.DEFINE;
  slot: number;
  value: SlotValue;
}

export interface TreeMessage {
  type: MessageType.TREE;
  root: VNode;
}

export interface PatchOp {
  target: number;
  set?: Partial<NodeProps>;
  childrenInsert?: { index: number; node: VNode };
  childrenRemove?: { index: number };
  childrenMove?: { from: number; to: number };
  remove?: boolean;
  replace?: VNode;
  transition?: number; // slot ref for animation
}

export interface PatchMessage {
  type: MessageType.PATCH;
  ops: PatchOp[];
}

export interface DataMessage {
  type: MessageType.DATA;
  schema?: number; // slot ref
  row: unknown[] | Record<string, unknown>;
}

export interface InputEvent {
  target?: number;
  kind:
    | 'click'
    | 'hover'
    | 'focus'
    | 'blur'
    | 'key'
    | 'value_change'
    | 'canvas_pointer'
    | 'canvas_key'
    | 'scroll';
  key?: string;
  value?: string;
  x?: number;
  y?: number;
  button?: number;
  action?: string;
  scrollTop?: number;
  scrollLeft?: number;
}

export interface InputMessage {
  type: MessageType.INPUT;
  event: InputEvent;
}

export interface EnvInfo {
  viewportVersion: number;
  displayWidth: number;
  displayHeight: number;
  pixelDensity: number;
  gpu: boolean;
  gpuApi?: string;
  colorDepth: number;
  videoDecode?: string[];
  remote: boolean;
  latencyMs: number;
}

export interface EnvMessage {
  type: MessageType.ENV;
  env: EnvInfo;
}

export interface SchemaMessage {
  type: MessageType.SCHEMA;
  slot: number;
  columns: SchemaColumn[];
}

export type ProtocolMessage =
  | DefineMessage
  | TreeMessage
  | PatchMessage
  | DataMessage
  | InputMessage
  | EnvMessage
  | SchemaMessage;

// ── Render tree (materialized state in viewer) ─────────────────────

export interface RenderNode {
  id: number;
  type: NodeType;
  props: NodeProps;
  children: RenderNode[];
  computedLayout?: ComputedLayout;
}

export interface ComputedLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RenderTree {
  root: RenderNode | null;
  slots: Map<number, SlotValue>;
  schemas: Map<number, SchemaColumn[]>;
  dataRows: Map<number, unknown[][]>; // schema slot -> rows
  nodeIndex: Map<number, RenderNode>;
}

// ── Backend interfaces ─────────────────────────────────────────────

/**
 * A protocol backend handles serialization of protocol messages.
 * Different backends implement different wire encodings (Candidate A/B/C).
 */
export interface ProtocolBackend {
  readonly name: string;
  readonly variant: string; // 'tree-patch' | 'slot-graph' | 'opcodes'

  /** Encode a high-level message to wire bytes. */
  encode(message: ProtocolMessage): Uint8Array;

  /** Decode wire bytes back to a high-level message. */
  decode(data: Uint8Array): ProtocolMessage;

  /** Encode with frame header for the full wire format. */
  encodeFrame(message: ProtocolMessage): Uint8Array;

  /** Decode a complete frame (header + payload). */
  decodeFrame(data: Uint8Array): { header: FrameHeader; message: ProtocolMessage };
}

/**
 * A viewer backend maintains render state and produces outputs
 * (text projection, screenshots, metrics).
 */
export interface ViewerBackend {
  readonly name: string;

  /** Initialize with environment info. */
  init(env: EnvInfo): void;

  /** Process a decoded protocol message, updating internal state. */
  processMessage(msg: ProtocolMessage): void;

  /** Get the current render tree state. */
  getTree(): RenderTree;

  /** Get the text projection of the current tree. */
  getTextProjection(): string;

  /** Capture a visual representation (format depends on viewer type). */
  screenshot(): Promise<ScreenshotResult>;

  /** Get current performance/state metrics. */
  getMetrics(): ViewerMetrics;

  /** Inject an input event (for automation). */
  sendInput(event: InputEvent): void;

  /** Register a callback for outbound messages (e.g. input events to app). */
  onMessage(handler: (msg: ProtocolMessage) => void): void;

  /** Tear down. */
  destroy(): void;
}

export interface ScreenshotResult {
  format: 'ansi' | 'html' | 'png' | 'text';
  data: string | Uint8Array;
  width: number;
  height: number;
}

export interface ViewerMetrics {
  messagesProcessed: number;
  bytesReceived: number;
  lastFrameTimeMs: number;
  peakFrameTimeMs: number;
  avgFrameTimeMs: number;
  memoryUsageBytes: number;
  treeNodeCount: number;
  treeDepth: number;
  slotCount: number;
  dataRowCount: number;
  frameTimesMs: number[]; // last N frame times for percentile analysis
}

// ── Output mode (how the app is rendering) ────────────────────────

import type { OutputMode } from './transport.js';
export type { OutputMode } from './transport.js';

// ── Test app factory ───────────────────────────────────────────────

export interface AppConnection {
  /** Send a full render tree. */
  setTree(root: VNode): void;

  /** Send incremental patches. */
  patch(ops: PatchOp[]): void;

  /** Define a slot in the definition table. */
  defineSlot(slot: number, value: SlotValue): void;

  /** Define a schema for structured data. */
  defineSchema(slot: number, columns: SchemaColumn[]): void;

  /** Emit a data record (positional array or dict). */
  emitData(schemaSlot: number, row: unknown[] | Record<string, unknown>): void;

  /** Register input event handler. */
  onInput(handler: (event: InputEvent) => void): void;

  /** Register resize handler. */
  onResize(handler: (width: number, height: number) => void): void;

  /** Current viewport dimensions. */
  readonly width: number;
  readonly height: number;

  /**
   * The resolved output mode. Apps use this to adapt their UI to the
   * output context (text, ansi, viewer, headless).
   */
  readonly outputMode: OutputMode;
}

export interface AppFactory {
  readonly name: string;
  readonly description: string;
  /** Set up the app against a connection. */
  create(conn: AppConnection): AppInstance;
}

export interface AppInstance {
  /** Tear down. */
  destroy?(): void;
}

// ── Embeddable viewer ──────────────────────────────────────────────

/**
 * An embeddable viewer is linked directly into the app process.
 * No IPC, no serialization — the app passes VNodes directly and the
 * viewer maintains the render tree, computes layout, and produces
 * output (terminal ANSI, framebuffer, GPU surface, etc.).
 *
 * This is the interface that native Zig/Go/Rust implementations target.
 * It extends ViewerBackend with direct-call methods that bypass
 * protocol encoding.
 *
 * Architecture:
 *   Socket viewer:    app → serialize → IPC → deserialize → viewer
 *   Embeddable viewer: app → viewer (direct function calls)
 */
export interface EmbeddableViewer extends ViewerBackend {
  /** Set the root tree directly (no serialization). */
  setTree(root: VNode): void;

  /** Apply patches directly. */
  applyPatches(ops: PatchOp[]): void;

  /** Define a slot directly. */
  defineSlot(slot: number, value: SlotValue): void;

  /** Query a computed layout rectangle for a node. */
  getLayout(nodeId: number): ComputedLayout | null;

  /** Render to the target output. Returns whether anything changed. */
  render(): boolean;

  /**
   * Rendering target configuration.
   * Native viewers set this to control where output goes.
   */
  readonly renderTarget: RenderTarget;
}

export type RenderTarget =
  | { type: 'ansi'; fd: number }         // ANSI terminal output
  | { type: 'framebuffer'; ptr: number }  // Raw framebuffer
  | { type: 'texture' }                   // GPU texture (wgpu surface)
  | { type: 'headless' }                  // No output (testing)
  | { type: 'html'; container: string };  // DOM element ID
