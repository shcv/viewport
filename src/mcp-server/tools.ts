/**
 * MCP tool definitions for Viewport interaction.
 *
 * These tools allow AI agents to interact with Viewport apps
 * programmatically — loading apps, inspecting state, automating
 * input, and collecting metrics.
 */

import type { AppFactory, InputEvent } from '../core/types.js';
import { ALL_APPS } from '../test-apps/index.js';
import { createTreePatchBackend } from '../variants/protocol-a-tree-patch/index.js';
import { createHeadlessViewer } from '../variants/viewer-headless/index.js';
import { ViewportPage, createPage } from '../automation/page.js';
import { runQualityChecks } from '../harness/quality.js';
import { summarizeMetrics } from '../harness/metrics.js';

/** Active page sessions, keyed by session ID. */
const sessions = new Map<string, ViewportPage>();
let nextSessionId = 1;

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/** All available MCP tools. */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'viewport_list_apps',
    description: 'List all available Viewport test applications and their descriptions.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'viewport_load_app',
    description: 'Load a Viewport test app into a new session. Returns a session ID for subsequent operations.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'App name (e.g. "counter", "file-browser")' },
        width: { type: 'number', description: 'Viewport width (default: 800)' },
        height: { type: 'number', description: 'Viewport height (default: 600)' },
      },
      required: ['app'],
    },
  },
  {
    name: 'viewport_get_tree',
    description: 'Get the current render tree structure of a loaded app session.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID from viewport_load_app' },
        maxDepth: { type: 'number', description: 'Maximum tree depth to return (default: unlimited)' },
      },
      required: ['session'],
    },
  },
  {
    name: 'viewport_get_text',
    description: 'Get the text projection (accessible text content) of a loaded app session.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID from viewport_load_app' },
      },
      required: ['session'],
    },
  },
  {
    name: 'viewport_click',
    description: 'Click on an element in the app by node ID.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        target: { type: 'number', description: 'Node ID to click' },
      },
      required: ['session', 'target'],
    },
  },
  {
    name: 'viewport_type',
    description: 'Type text into an input field.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        target: { type: 'number', description: 'Input node ID' },
        text: { type: 'string', description: 'Text to type' },
      },
      required: ['session', 'target', 'text'],
    },
  },
  {
    name: 'viewport_press',
    description: 'Press a keyboard key (e.g. "Enter", "ArrowUp", "k", "Escape").',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        key: { type: 'string', description: 'Key to press' },
      },
      required: ['session', 'key'],
    },
  },
  {
    name: 'viewport_find',
    description: 'Find elements by text content, returning matching node IDs and their properties.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        text: { type: 'string', description: 'Text to search for' },
        exact: { type: 'boolean', description: 'Exact match (default: false)' },
      },
      required: ['session', 'text'],
    },
  },
  {
    name: 'viewport_screenshot',
    description: 'Get a text-based screenshot (ANSI rendering) of the current app state.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
      },
      required: ['session'],
    },
  },
  {
    name: 'viewport_metrics',
    description: 'Get performance and state metrics for a session.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
      },
      required: ['session'],
    },
  },
  {
    name: 'viewport_quality_check',
    description: 'Run quality checks (accessibility, tree integrity, etc.) on a session.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
      },
      required: ['session'],
    },
  },
  {
    name: 'viewport_close',
    description: 'Close a session and free resources.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
      },
      required: ['session'],
    },
  },
  {
    name: 'viewport_resize',
    description: 'Resize the viewport of a session.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        width: { type: 'number', description: 'New width' },
        height: { type: 'number', description: 'New height' },
      },
      required: ['session', 'width', 'height'],
    },
  },
];

/** Handle a tool call. */
export function handleToolCall(name: string, args: Record<string, unknown>): ToolResult {
  try {
    switch (name) {
      case 'viewport_list_apps':
        return listApps();
      case 'viewport_load_app':
        return loadApp(args.app as string, args.width as number | undefined, args.height as number | undefined);
      case 'viewport_get_tree':
        return getTree(args.session as string, args.maxDepth as number | undefined);
      case 'viewport_get_text':
        return getText(args.session as string);
      case 'viewport_click':
        return click(args.session as string, args.target as number);
      case 'viewport_type':
        return typeText(args.session as string, args.target as number, args.text as string);
      case 'viewport_press':
        return press(args.session as string, args.key as string);
      case 'viewport_find':
        return find(args.session as string, args.text as string, args.exact as boolean | undefined);
      case 'viewport_screenshot':
        return screenshot(args.session as string);
      case 'viewport_metrics':
        return getMetrics(args.session as string);
      case 'viewport_quality_check':
        return qualityCheck(args.session as string);
      case 'viewport_close':
        return closeSession(args.session as string);
      case 'viewport_resize':
        return resize(args.session as string, args.width as number, args.height as number);
      default:
        return error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return error(String(err));
  }
}

// ── Tool implementations ───────────────────────────────────────────

function listApps(): ToolResult {
  const apps = Object.entries(ALL_APPS).map(([name, app]) =>
    `- ${name}: ${app.description}`
  ).join('\n');
  return ok(`Available Viewport test apps:\n\n${apps}`);
}

function loadApp(appName: string, width?: number, height?: number): ToolResult {
  const app = ALL_APPS[appName];
  if (!app) return error(`Unknown app: "${appName}". Available: ${Object.keys(ALL_APPS).join(', ')}`);

  const protocol = createTreePatchBackend();
  const viewer = createHeadlessViewer();
  const page = createPage(app, protocol, viewer, { width, height });

  const sessionId = `s${nextSessionId++}`;
  sessions.set(sessionId, page);

  const tree = page.getTree();
  const nodeCount = tree.nodeIndex.size;

  return ok(`Loaded "${appName}" as session ${sessionId} (${nodeCount} nodes, ${width ?? 800}×${height ?? 600})`);
}

function getTree(sessionId: string, maxDepth?: number): ToolResult {
  const page = getSession(sessionId);
  if (!page) return error(`Session not found: ${sessionId}`);

  const tree = page.getTree();
  if (!tree.root) return ok('(empty tree)');

  const lines: string[] = [];
  const walk = (node: any, depth: number) => {
    if (maxDepth !== undefined && depth > maxDepth) return;
    const indent = '  '.repeat(depth);
    const props: string[] = [];
    if (node.props.content) props.push(`"${node.props.content}"`);
    if (node.props.direction) props.push(`dir=${node.props.direction}`);
    if (node.props.interactive) props.push(node.props.interactive);
    if (node.props.value !== undefined) props.push(`value="${node.props.value}"`);
    if (node.props.placeholder) props.push(`placeholder="${node.props.placeholder}"`);
    const propsStr = props.length > 0 ? ` ${props.join(' ')}` : '';
    lines.push(`${indent}<${node.type} id=${node.id}${propsStr}>`);
    for (const child of node.children) {
      walk(child, depth + 1);
    }
  };
  walk(tree.root, 0);

  return ok(lines.join('\n'));
}

function getText(sessionId: string): ToolResult {
  const page = getSession(sessionId);
  if (!page) return error(`Session not found: ${sessionId}`);
  return ok(page.textContent());
}

function click(sessionId: string, target: number): ToolResult {
  const page = getSession(sessionId);
  if (!page) return error(`Session not found: ${sessionId}`);
  page.click(target);
  // Return updated text projection
  return ok(`Clicked node #${target}.\n\nCurrent state:\n${page.textContent()}`);
}

function typeText(sessionId: string, target: number, text: string): ToolResult {
  const page = getSession(sessionId);
  if (!page) return error(`Session not found: ${sessionId}`);
  page.type(target, text);
  return ok(`Typed "${text}" into node #${target}.\n\nCurrent state:\n${page.textContent()}`);
}

function press(sessionId: string, key: string): ToolResult {
  const page = getSession(sessionId);
  if (!page) return error(`Session not found: ${sessionId}`);
  page.press(key);
  return ok(`Pressed "${key}".\n\nCurrent state:\n${page.textContent()}`);
}

function find(sessionId: string, text: string, exact?: boolean): ToolResult {
  const page = getSession(sessionId);
  if (!page) return error(`Session not found: ${sessionId}`);

  const locator = page.getByText(text, { exact: exact ?? false });
  const matches = locator.resolveAll();

  if (matches.length === 0) {
    return ok(`No elements found matching "${text}"`);
  }

  const results = matches.map((m) => {
    const props: string[] = [];
    if (m.props.content) props.push(`content="${m.props.content}"`);
    if (m.props.interactive) props.push(`interactive=${m.props.interactive}`);
    return `  #${m.id} <${m.type}> ${props.join(' ')}`;
  }).join('\n');

  return ok(`Found ${matches.length} element(s) matching "${text}":\n${results}`);
}

function screenshot(sessionId: string): ToolResult {
  const page = getSession(sessionId);
  if (!page) return error(`Session not found: ${sessionId}`);

  // Use synchronous screenshot data
  const tree = page.getTree();
  if (!tree.root) return ok('(empty)');

  // Build a simple text rendering
  const text = page.textContent();
  return ok(`Screenshot (text projection):\n\n${text}`);
}

function getMetrics(sessionId: string): ToolResult {
  const page = getSession(sessionId);
  if (!page) return error(`Session not found: ${sessionId}`);

  const m = page.metrics();
  const hm = page.harnessMetrics();
  const summary = summarizeMetrics(hm);

  const lines = [
    `Messages processed: ${m.messagesProcessed}`,
    `Tree nodes: ${m.treeNodeCount}`,
    `Tree depth: ${m.treeDepth}`,
    `Slots: ${m.slotCount}`,
    `Data rows: ${m.dataRowCount}`,
    `Wire bytes: ${summary.totalBytes}`,
    `Avg process time: ${summary.avgProcessTimeMs.toFixed(3)} ms`,
    `Peak frame time: ${m.peakFrameTimeMs.toFixed(3)} ms`,
    `Est. memory: ${(m.memoryUsageBytes / 1024).toFixed(1)} KB`,
  ];

  return ok(lines.join('\n'));
}

function qualityCheck(sessionId: string): ToolResult {
  const page = getSession(sessionId);
  if (!page) return error(`Session not found: ${sessionId}`);

  const report = runQualityChecks(page.getTree());
  const lines = [
    `Quality score: ${report.score}% (${report.passed ? 'PASS' : 'FAIL'})`,
    '',
    ...report.checks.map((c) => {
      const icon = c.passed ? '✓' : c.severity === 'error' ? '✗' : '⚠';
      let line = `${icon} ${c.name}: ${c.message}`;
      if (c.details) line += `\n  ${c.details}`;
      return line;
    }),
  ];

  return ok(lines.join('\n'));
}

function closeSession(sessionId: string): ToolResult {
  const page = sessions.get(sessionId);
  if (!page) return error(`Session not found: ${sessionId}`);
  page.close();
  sessions.delete(sessionId);
  return ok(`Session ${sessionId} closed.`);
}

function resize(sessionId: string, width: number, height: number): ToolResult {
  const page = getSession(sessionId);
  if (!page) return error(`Session not found: ${sessionId}`);
  page.resize(width, height);
  return ok(`Resized to ${width}×${height}.`);
}

// ── Helpers ────────────────────────────────────────────────────────

function getSession(id: string): ViewportPage | null {
  return sessions.get(id) ?? null;
}

function ok(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

function error(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
