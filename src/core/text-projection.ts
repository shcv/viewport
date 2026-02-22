/**
 * Text projection engine.
 *
 * Every Viewport node has a well-defined text projection rule.
 * This module computes the text representation of a render tree,
 * matching the rules from viewport-design.md §4.7.
 */

import type { RenderNode, RenderTree, SchemaColumn } from './types.js';

export interface TextProjectionOptions {
  /** Separator between box children. Defaults to '\n' for column, '\t' for row. */
  boxSeparator?: { row: string; column: string };
  /** Whether to include scroll content beyond the visible range. */
  fullScrollContent?: boolean;
  /** Maximum width for wrapping (0 = no wrap). */
  maxWidth?: number;
  /** Indent depth per level for nested boxes. */
  indentSize?: number;
}

const DEFAULT_OPTIONS: TextProjectionOptions = {
  boxSeparator: { row: '\t', column: '\n' },
  fullScrollContent: true,
  maxWidth: 0,
  indentSize: 0,
};

/** Compute the text projection of an entire render tree. */
export function textProjection(tree: RenderTree, options?: TextProjectionOptions): string {
  if (!tree.root) return '';
  const opts = { ...DEFAULT_OPTIONS, ...options };
  return projectNode(tree.root, tree, opts, 0);
}

/** Compute the text projection of a single node. */
export function projectNode(
  node: RenderNode,
  tree: RenderTree,
  options: TextProjectionOptions,
  depth: number
): string {
  // Check for explicit text_alt override
  if (node.props.textAlt !== undefined) {
    return String(node.props.textAlt);
  }

  const indent = options.indentSize ? ' '.repeat(depth * (options.indentSize ?? 0)) : '';

  switch (node.type) {
    case 'text':
      return indent + (node.props.content ?? '');

    case 'box': {
      const dir = node.props.direction ?? 'column';
      const sep = dir === 'row'
        ? (options.boxSeparator?.row ?? '\t')
        : (options.boxSeparator?.column ?? '\n');

      const childTexts = node.children
        .map((c) => projectNode(c, tree, options, depth + 1))
        .filter((t) => t.length > 0);

      return childTexts.join(sep);
    }

    case 'scroll': {
      // Scroll regions project their children content
      const childTexts = node.children
        .map((c) => projectNode(c, tree, options, depth + 1))
        .filter((t) => t.length > 0);

      // If the scroll has a schema ref and data rows, project those too
      if (node.props.schema !== undefined) {
        const schemaSlot = node.props.schema as number;
        const rows = tree.dataRows.get(schemaSlot);
        const schema = tree.schemas.get(schemaSlot);
        if (rows && schema) {
          const dataText = projectDataRows(rows, schema);
          if (dataText) childTexts.push(dataText);
        }
      }

      return childTexts.join('\n');
    }

    case 'input':
      return indent + (node.props.value ?? node.props.placeholder ?? '');

    case 'image':
    case 'canvas':
      return indent + (node.props.altText ?? '[image]');

    case 'separator':
      return indent + '────────────────';

    default:
      return '';
  }
}

/** Project data rows as a TSV-like table. */
function projectDataRows(rows: unknown[][], schema: SchemaColumn[]): string {
  if (rows.length === 0) return '';

  const lines: string[] = [];

  // Header
  lines.push(schema.map((col) => col.name).join('\t'));

  // Rows
  for (const row of rows) {
    const cells = schema.map((col, i) => formatValue(row[i], col));
    lines.push(cells.join('\t'));
  }

  return lines.join('\n');
}

/** Format a data value for text projection. */
function formatValue(value: unknown, column: SchemaColumn): string {
  if (value === null || value === undefined) return '';

  if (column.format === 'human_bytes') {
    return humanBytes(Number(value));
  }

  if (column.format === 'relative_time') {
    return relativeTime(Number(value));
  }

  return String(value);
}

function humanBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let b = bytes;
  while (b >= 1024 && i < units.length - 1) {
    b /= 1024;
    i++;
  }
  return `${b.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function relativeTime(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/**
 * Compare two text projections and return differences.
 * Useful for quality checks in the test harness.
 */
export function diffTextProjection(
  expected: string,
  actual: string
): { match: boolean; differences: TextDiff[] } {
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  const differences: TextDiff[] = [];

  const maxLines = Math.max(expectedLines.length, actualLines.length);
  for (let i = 0; i < maxLines; i++) {
    const exp = expectedLines[i] ?? '';
    const act = actualLines[i] ?? '';
    if (exp !== act) {
      differences.push({ line: i + 1, expected: exp, actual: act });
    }
  }

  return { match: differences.length === 0, differences };
}

export interface TextDiff {
  line: number;
  expected: string;
  actual: string;
}
