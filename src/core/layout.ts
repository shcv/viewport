/**
 * Pure TypeScript layout engine — flexbox subset.
 *
 * Computes layout rectangles (x, y, width, height) for a render tree
 * using a simplified flexbox algorithm. This is the "Pure TS" layout
 * engine option from the design doc, suitable for testing and
 * environments where native Taffy/Yoga bindings aren't available.
 *
 * Supported features:
 * - flex-direction: row | column
 * - justify-content: start | end | center | between | around | evenly
 * - align-items: start | end | center | stretch
 * - gap
 * - padding (uniform, 2-value, 4-value)
 * - margin (uniform, 2-value, 4-value)
 * - width, height (fixed px or percentage string)
 * - flex grow
 * - min/max width/height constraints
 * - wrap (basic)
 */

import type { RenderNode, RenderTree, ComputedLayout, NodeProps } from './types.js';

export interface LayoutConstraints {
  /** Available width for this subtree. */
  availableWidth: number;
  /** Available height for this subtree. */
  availableHeight: number;
}

export interface LayoutResult {
  /** Map from node ID to computed layout rectangle. */
  layouts: Map<number, ComputedLayout>;
}

/**
 * Compute layout for an entire render tree.
 * Sets `computedLayout` on each RenderNode in-place and returns
 * a map of all computed layouts.
 */
export function computeLayout(tree: RenderTree, viewport: { width: number; height: number }): LayoutResult {
  const layouts = new Map<number, ComputedLayout>();

  if (!tree.root) return { layouts };

  const rootLayout: ComputedLayout = {
    x: 0,
    y: 0,
    width: viewport.width,
    height: viewport.height,
  };

  layoutNode(tree.root, rootLayout, layouts, viewport.width);

  return { layouts };
}

/**
 * Layout a single node within a given bounding rectangle.
 */
function layoutNode(
  node: RenderNode,
  bounds: ComputedLayout,
  layouts: Map<number, ComputedLayout>,
  viewportWidth: number,
): void {
  const props = node.props;

  // Resolve explicit size
  const resolvedWidth = resolveSize(props.width, bounds.width, viewportWidth);
  const resolvedHeight = resolveSize(props.height, bounds.height, viewportWidth);

  let width = resolvedWidth ?? bounds.width;
  let height = resolvedHeight ?? bounds.height;

  // Apply constraints
  if (props.minWidth !== undefined) width = Math.max(width, props.minWidth);
  if (props.maxWidth !== undefined) width = Math.min(width, props.maxWidth);
  if (props.minHeight !== undefined) height = Math.max(height, props.minHeight);
  if (props.maxHeight !== undefined) height = Math.min(height, props.maxHeight);

  // Apply margin
  const margin = resolveSpacing(props.margin);

  const layout: ComputedLayout = {
    x: bounds.x + margin.left,
    y: bounds.y + margin.top,
    width: Math.max(0, width - margin.left - margin.right),
    height: Math.max(0, height - margin.top - margin.bottom),
  };

  node.computedLayout = layout;
  layouts.set(node.id, layout);

  // Layout children if this is a container
  if (node.children.length > 0 && (node.type === 'box' || node.type === 'scroll')) {
    layoutChildren(node, layout, layouts, viewportWidth);
  }
}

/**
 * Layout children of a flex container.
 */
function layoutChildren(
  parent: RenderNode,
  parentLayout: ComputedLayout,
  layouts: Map<number, ComputedLayout>,
  viewportWidth: number,
): void {
  const props = parent.props;
  const padding = resolveSpacing(props.padding);
  const gap = props.gap ?? 0;
  const direction = props.direction ?? 'column';
  const justify = props.justify ?? 'start';
  const align = props.align ?? 'stretch';

  const contentX = parentLayout.x + padding.left;
  const contentY = parentLayout.y + padding.top;
  const contentW = Math.max(0, parentLayout.width - padding.left - padding.right);
  const contentH = Math.max(0, parentLayout.height - padding.top - padding.bottom);

  const isRow = direction === 'row';
  const mainSize = isRow ? contentW : contentH;
  const crossSize = isRow ? contentH : contentW;

  const children = parent.children;
  if (children.length === 0) return;

  // Measure children: determine intrinsic sizes and flex factors
  const childInfos = children.map((child) => {
    const cProps = child.props;
    const fixedMain = isRow
      ? resolveSize(cProps.width, contentW, viewportWidth)
      : resolveSize(cProps.height, contentH, viewportWidth);
    const fixedCross = isRow
      ? resolveSize(cProps.height, contentH, viewportWidth)
      : resolveSize(cProps.width, contentW, viewportWidth);
    const flexGrow = cProps.flex ?? 0;
    const cMargin = resolveSpacing(cProps.margin);
    const mainMargin = isRow ? cMargin.left + cMargin.right : cMargin.top + cMargin.bottom;

    return {
      child,
      fixedMain,
      fixedCross,
      flexGrow,
      margin: cMargin,
      mainMargin,
      allocatedMain: 0,
      allocatedCross: 0,
    };
  });

  // First pass: allocate fixed sizes and determine remaining space
  const totalGap = gap * (children.length - 1);
  let fixedTotal = totalGap;
  let totalFlex = 0;

  for (const info of childInfos) {
    if (info.fixedMain !== null) {
      fixedTotal += info.fixedMain + info.mainMargin;
      info.allocatedMain = info.fixedMain;
    } else if (info.flexGrow > 0) {
      totalFlex += info.flexGrow;
      fixedTotal += info.mainMargin;
    } else {
      // No fixed size, no flex: give a default based on content
      const defaultSize = estimateContentSize(info.child, isRow, contentW, contentH);
      fixedTotal += defaultSize + info.mainMargin;
      info.allocatedMain = defaultSize;
    }
  }

  // Second pass: distribute remaining space to flex items
  const remaining = Math.max(0, mainSize - fixedTotal);
  if (totalFlex > 0) {
    for (const info of childInfos) {
      if (info.fixedMain === null && info.flexGrow > 0) {
        info.allocatedMain = (info.flexGrow / totalFlex) * remaining;
      }
    }
  }

  // Apply min/max constraints on main axis
  for (const info of childInfos) {
    const cProps = info.child.props;
    if (isRow) {
      if (cProps.minWidth !== undefined) info.allocatedMain = Math.max(info.allocatedMain, cProps.minWidth);
      if (cProps.maxWidth !== undefined) info.allocatedMain = Math.min(info.allocatedMain, cProps.maxWidth);
    } else {
      if (cProps.minHeight !== undefined) info.allocatedMain = Math.max(info.allocatedMain, cProps.minHeight);
      if (cProps.maxHeight !== undefined) info.allocatedMain = Math.min(info.allocatedMain, cProps.maxHeight);
    }
  }

  // Cross-axis allocation
  for (const info of childInfos) {
    const crossMargin = isRow
      ? info.margin.top + info.margin.bottom
      : info.margin.left + info.margin.right;

    if (info.fixedCross !== null) {
      info.allocatedCross = info.fixedCross;
    } else if (align === 'stretch') {
      info.allocatedCross = Math.max(0, crossSize - crossMargin);
    } else {
      info.allocatedCross = Math.max(0, crossSize - crossMargin);
    }
  }

  // Determine total used main-axis space for justify
  const totalUsed = childInfos.reduce((sum, info) => sum + info.allocatedMain + info.mainMargin, 0) + totalGap;
  const freeSpace = Math.max(0, mainSize - totalUsed);

  // Compute starting position based on justify-content
  let mainPos = isRow ? contentX : contentY;
  let itemGap = gap;

  switch (justify) {
    case 'end':
      mainPos += freeSpace;
      break;
    case 'center':
      mainPos += freeSpace / 2;
      break;
    case 'between':
      if (children.length > 1) {
        itemGap = gap + freeSpace / (children.length - 1);
      }
      break;
    case 'around':
      if (children.length > 0) {
        const space = freeSpace / children.length;
        mainPos += space / 2;
        itemGap = gap + space;
      }
      break;
    case 'evenly':
      if (children.length > 0) {
        const space = freeSpace / (children.length + 1);
        mainPos += space;
        itemGap = gap + space;
      }
      break;
    // 'start' is default
  }

  // Position each child
  for (let i = 0; i < childInfos.length; i++) {
    const info = childInfos[i];

    const mainOffset = isRow ? info.margin.left : info.margin.top;
    const crossOffset = isRow ? info.margin.top : info.margin.left;

    // Cross-axis alignment
    let crossPos = isRow ? contentY : contentX;
    const crossAvail = crossSize;
    const childCross = info.allocatedCross;

    switch (align) {
      case 'end':
        crossPos += crossAvail - childCross - crossOffset;
        break;
      case 'center':
        crossPos += (crossAvail - childCross) / 2;
        break;
      case 'baseline': // treat as start for simplicity
      case 'start':
        crossPos += crossOffset;
        break;
      case 'stretch':
      default:
        crossPos += crossOffset;
        break;
    }

    const childBounds: ComputedLayout = isRow
      ? {
          x: mainPos + mainOffset,
          y: crossPos,
          width: info.allocatedMain,
          height: info.allocatedCross,
        }
      : {
          x: crossPos,
          y: mainPos + mainOffset,
          width: info.allocatedCross,
          height: info.allocatedMain,
        };

    layoutNode(info.child, childBounds, layouts, viewportWidth);

    mainPos += info.allocatedMain + info.mainMargin + (i < childInfos.length - 1 ? itemGap : 0);
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function resolveSize(
  size: number | string | undefined,
  parentSize: number,
  viewportWidth: number,
): number | null {
  if (size === undefined) return null;
  if (typeof size === 'number') return size;
  if (typeof size === 'string') {
    if (size.endsWith('%')) {
      return (parseFloat(size) / 100) * parentSize;
    }
    if (size.endsWith('px')) {
      return parseFloat(size);
    }
    if (size.endsWith('vw')) {
      return (parseFloat(size) / 100) * viewportWidth;
    }
    const n = parseFloat(size);
    if (!isNaN(n)) return n;
  }
  return null;
}

interface Spacing {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function resolveSpacing(val: number | [number, number] | [number, number, number, number] | undefined): Spacing {
  if (val === undefined) return { top: 0, right: 0, bottom: 0, left: 0 };
  if (typeof val === 'number') return { top: val, right: val, bottom: val, left: val };
  if (Array.isArray(val)) {
    if (val.length === 2) return { top: val[0], right: val[1], bottom: val[0], left: val[1] };
    if (val.length === 4) return { top: val[0], right: val[1], bottom: val[2], left: val[3] };
  }
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

function estimateContentSize(node: RenderNode, isMainRow: boolean, parentW: number, parentH: number): number {
  switch (node.type) {
    case 'text': {
      const content = node.props.content ?? '';
      if (isMainRow) {
        // Width: rough character estimate (8px per char)
        const maxLineLen = Math.max(...content.split('\n').map((l) => l.length), 1);
        return Math.min(maxLineLen * 8, parentW);
      }
      // Height: line count * line height
      const lineCount = content.split('\n').length;
      return lineCount * 20;
    }
    case 'separator':
      return isMainRow ? parentW : 2;
    case 'input':
      return isMainRow ? Math.min(200, parentW) : (node.props.multiline ? 60 : 24);
    case 'box':
    case 'scroll':
      // Container with no explicit size: take proportional share
      return isMainRow ? Math.floor(parentW / 2) : Math.floor(parentH / 4);
    default:
      return isMainRow ? 100 : 20;
  }
}
