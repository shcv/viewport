/**
 * Quality checks for the test harness.
 *
 * Validates render output: text projection correctness, tree structure
 * integrity, screenshot comparison, and accessibility checks.
 */

import type { RenderTree, RenderNode, VNode } from '../core/types.js';
import { walkTree, countNodes, treeDepth } from '../core/tree.js';
import { textProjection, diffTextProjection } from '../core/text-projection.js';

export interface QualityReport {
  passed: boolean;
  checks: QualityCheck[];
  score: number; // 0-100
}

export interface QualityCheck {
  name: string;
  passed: boolean;
  severity: 'error' | 'warning' | 'info';
  message: string;
  details?: string;
}

/** Run all quality checks on a render tree. */
export function runQualityChecks(tree: RenderTree): QualityReport {
  const checks: QualityCheck[] = [
    checkTreeIntegrity(tree),
    checkNodeIdUniqueness(tree),
    checkTextProjectionNonEmpty(tree),
    checkNoOrphanedNodes(tree),
    checkInteractiveAccessibility(tree),
    checkDepthLimit(tree),
    checkContentPresence(tree),
  ];

  const passed = checks.every((c) => c.severity !== 'error' || c.passed);
  const passedCount = checks.filter((c) => c.passed).length;
  const score = Math.round((passedCount / checks.length) * 100);

  return { passed, checks, score };
}

/** Compare text projections between two variants for the same app. */
export function compareTextProjections(
  treeA: RenderTree,
  treeB: RenderTree,
  labelA: string,
  labelB: string,
): QualityCheck {
  const textA = textProjection(treeA);
  const textB = textProjection(treeB);
  const diff = diffTextProjection(textA, textB);

  if (diff.match) {
    return {
      name: 'text-projection-match',
      passed: true,
      severity: 'info',
      message: `Text projections match between ${labelA} and ${labelB}`,
    };
  }

  const diffSummary = diff.differences
    .slice(0, 10)
    .map((d) => `  Line ${d.line}: "${d.expected}" vs "${d.actual}"`)
    .join('\n');

  return {
    name: 'text-projection-match',
    passed: false,
    severity: 'warning',
    message: `Text projections differ: ${diff.differences.length} line(s)`,
    details: diffSummary,
  };
}

/** Compare tree structures between two variants. */
export function compareTreeStructures(
  treeA: RenderTree,
  treeB: RenderTree,
  labelA: string,
  labelB: string,
): QualityCheck {
  const countA = countNodes(treeA.root);
  const countB = countNodes(treeB.root);
  const depthA = treeDepth(treeA.root);
  const depthB = treeDepth(treeB.root);

  const structA = treeFingerprint(treeA.root);
  const structB = treeFingerprint(treeB.root);

  if (structA === structB) {
    return {
      name: 'tree-structure-match',
      passed: true,
      severity: 'info',
      message: `Tree structures match: ${countA} nodes, depth ${depthA}`,
    };
  }

  return {
    name: 'tree-structure-match',
    passed: false,
    severity: 'warning',
    message: `Tree structures differ: ${labelA} has ${countA} nodes (depth ${depthA}), ${labelB} has ${countB} nodes (depth ${depthB})`,
  };
}

// ── Individual checks ──────────────────────────────────────────────

function checkTreeIntegrity(tree: RenderTree): QualityCheck {
  if (!tree.root) {
    return {
      name: 'tree-integrity',
      passed: false,
      severity: 'error',
      message: 'Tree has no root node',
    };
  }

  // Check that index is consistent with tree
  let indexedCount = 0;
  walkTree(tree.root, (node) => {
    indexedCount++;
    if (!tree.nodeIndex.has(node.id)) {
      return; // will be caught by orphan check
    }
  });

  const indexSize = tree.nodeIndex.size;
  if (indexedCount !== indexSize) {
    return {
      name: 'tree-integrity',
      passed: false,
      severity: 'error',
      message: `Index size (${indexSize}) doesn't match tree walk count (${indexedCount})`,
    };
  }

  return {
    name: 'tree-integrity',
    passed: true,
    severity: 'info',
    message: `Tree intact: ${indexedCount} nodes indexed`,
  };
}

function checkNodeIdUniqueness(tree: RenderTree): QualityCheck {
  if (!tree.root) {
    return { name: 'node-id-unique', passed: true, severity: 'info', message: 'No tree' };
  }

  const seen = new Set<number>();
  const duplicates: number[] = [];

  walkTree(tree.root, (node) => {
    if (seen.has(node.id)) {
      duplicates.push(node.id);
    }
    seen.add(node.id);
  });

  if (duplicates.length > 0) {
    return {
      name: 'node-id-unique',
      passed: false,
      severity: 'error',
      message: `Duplicate node IDs found: ${duplicates.join(', ')}`,
    };
  }

  return {
    name: 'node-id-unique',
    passed: true,
    severity: 'info',
    message: `All ${seen.size} node IDs are unique`,
  };
}

function checkTextProjectionNonEmpty(tree: RenderTree): QualityCheck {
  const text = textProjection(tree);

  if (!text.trim()) {
    return {
      name: 'text-projection-nonempty',
      passed: false,
      severity: 'warning',
      message: 'Text projection is empty',
    };
  }

  return {
    name: 'text-projection-nonempty',
    passed: true,
    severity: 'info',
    message: `Text projection: ${text.split('\n').length} lines, ${text.length} chars`,
  };
}

function checkNoOrphanedNodes(tree: RenderTree): QualityCheck {
  if (!tree.root) {
    return { name: 'no-orphans', passed: true, severity: 'info', message: 'No tree' };
  }

  const treeIds = new Set<number>();
  walkTree(tree.root, (node) => treeIds.add(node.id));

  const orphans: number[] = [];
  for (const id of tree.nodeIndex.keys()) {
    if (!treeIds.has(id)) {
      orphans.push(id);
    }
  }

  if (orphans.length > 0) {
    return {
      name: 'no-orphans',
      passed: false,
      severity: 'warning',
      message: `${orphans.length} orphaned node(s) in index: ${orphans.slice(0, 5).join(', ')}`,
    };
  }

  return {
    name: 'no-orphans',
    passed: true,
    severity: 'info',
    message: 'No orphaned nodes',
  };
}

function checkInteractiveAccessibility(tree: RenderTree): QualityCheck {
  if (!tree.root) {
    return { name: 'accessibility', passed: true, severity: 'info', message: 'No tree' };
  }

  const issues: string[] = [];

  walkTree(tree.root, (node) => {
    // Clickable nodes should have text content (for screen readers)
    if (node.props.interactive === 'clickable') {
      const hasText = hasTextContent(node);
      if (!hasText) {
        issues.push(`Clickable node #${node.id} has no text content`);
      }
    }

    // Canvas/image should have alt text
    if (node.type === 'canvas' || node.type === 'image') {
      if (!node.props.altText && !node.props.textAlt) {
        issues.push(`${node.type} node #${node.id} has no alt text`);
      }
    }
  });

  if (issues.length > 0) {
    return {
      name: 'accessibility',
      passed: false,
      severity: 'warning',
      message: `${issues.length} accessibility issue(s)`,
      details: issues.join('\n'),
    };
  }

  return {
    name: 'accessibility',
    passed: true,
    severity: 'info',
    message: 'All interactive elements have accessible text',
  };
}

function checkDepthLimit(tree: RenderTree, maxDepth = 20): QualityCheck {
  const depth = treeDepth(tree.root);

  if (depth > maxDepth) {
    return {
      name: 'depth-limit',
      passed: false,
      severity: 'warning',
      message: `Tree depth (${depth}) exceeds recommended limit (${maxDepth})`,
    };
  }

  return {
    name: 'depth-limit',
    passed: true,
    severity: 'info',
    message: `Tree depth: ${depth}`,
  };
}

function checkContentPresence(tree: RenderTree): QualityCheck {
  if (!tree.root) {
    return { name: 'content-present', passed: false, severity: 'error', message: 'No root' };
  }

  let textNodes = 0;
  let inputNodes = 0;
  walkTree(tree.root, (node) => {
    if (node.type === 'text') textNodes++;
    if (node.type === 'input') inputNodes++;
  });

  if (textNodes === 0 && inputNodes === 0) {
    return {
      name: 'content-present',
      passed: false,
      severity: 'warning',
      message: 'No text or input nodes found in tree',
    };
  }

  return {
    name: 'content-present',
    passed: true,
    severity: 'info',
    message: `Content: ${textNodes} text nodes, ${inputNodes} input nodes`,
  };
}

// ── Helpers ────────────────────────────────────────────────────────

function hasTextContent(node: RenderNode): boolean {
  if (node.type === 'text' && node.props.content) return true;
  return node.children.some(hasTextContent);
}

function treeFingerprint(node: RenderNode | null): string {
  if (!node) return '';
  const childFingerprints = node.children.map(treeFingerprint).join(',');
  return `${node.type}(${childFingerprints})`;
}
