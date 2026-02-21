/**
 * Render tree manipulation utilities.
 *
 * These operate on the materialized RenderTree that viewers maintain.
 * They are shared across viewer implementations.
 */

import type { RenderTree, RenderNode, VNode, PatchOp, NodeProps } from './types.js';

/** Create an empty render tree. */
export function createRenderTree(): RenderTree {
  return {
    root: null,
    slots: new Map(),
    schemas: new Map(),
    dataRows: new Map(),
    nodeIndex: new Map(),
  };
}

/** Convert a VNode to a RenderNode and index all nodes. */
export function vnodeToRenderNode(vnode: VNode, index: Map<number, RenderNode>): RenderNode {
  const children: RenderNode[] = (vnode.children ?? []).map((c) => vnodeToRenderNode(c, index));

  const node: RenderNode = {
    id: vnode.id,
    type: vnode.type,
    props: { ...vnode.props },
    children,
  };

  if (vnode.textAlt !== undefined) {
    node.props.textAlt = vnode.textAlt;
  }

  index.set(node.id, node);
  return node;
}

/** Set the root of a render tree from a VNode. */
export function setTreeRoot(tree: RenderTree, root: VNode): void {
  tree.nodeIndex.clear();
  tree.root = vnodeToRenderNode(root, tree.nodeIndex);
}

/** Apply a single patch operation to a render tree. */
export function applyPatch(tree: RenderTree, op: PatchOp): boolean {
  if (op.remove) {
    return removeNode(tree, op.target);
  }

  if (op.replace) {
    return replaceNode(tree, op.target, op.replace);
  }

  const node = tree.nodeIndex.get(op.target);
  if (!node) return false;

  if (op.set) {
    Object.assign(node.props, op.set);
  }

  if (op.childrenInsert) {
    const child = vnodeToRenderNode(op.childrenInsert.node, tree.nodeIndex);
    const idx = Math.min(op.childrenInsert.index, node.children.length);
    node.children.splice(idx, 0, child);
  }

  if (op.childrenRemove) {
    const idx = op.childrenRemove.index;
    if (idx >= 0 && idx < node.children.length) {
      const removed = node.children[idx];
      removeSubtreeFromIndex(tree.nodeIndex, removed);
      node.children.splice(idx, 1);
    }
  }

  if (op.childrenMove) {
    const { from, to } = op.childrenMove;
    if (from >= 0 && from < node.children.length && to >= 0 && to < node.children.length) {
      const [child] = node.children.splice(from, 1);
      node.children.splice(to, 0, child);
    }
  }

  return true;
}

/** Apply a batch of patch operations. */
export function applyPatches(tree: RenderTree, ops: PatchOp[]): { applied: number; failed: number } {
  let applied = 0;
  let failed = 0;
  for (const op of ops) {
    if (applyPatch(tree, op)) {
      applied++;
    } else {
      failed++;
    }
  }
  return { applied, failed };
}

/** Remove a node and its subtree from the tree. */
function removeNode(tree: RenderTree, targetId: number): boolean {
  const node = tree.nodeIndex.get(targetId);
  if (!node) return false;

  // Find parent
  const parent = findParent(tree.root, targetId);
  if (parent) {
    const idx = parent.children.findIndex((c) => c.id === targetId);
    if (idx >= 0) {
      parent.children.splice(idx, 1);
    }
  } else if (tree.root?.id === targetId) {
    tree.root = null;
  }

  removeSubtreeFromIndex(tree.nodeIndex, node);
  return true;
}

/** Replace a node in the tree. */
function replaceNode(tree: RenderTree, targetId: number, replacement: VNode): boolean {
  const existing = tree.nodeIndex.get(targetId);
  if (!existing) return false;

  // Remove old subtree from index
  removeSubtreeFromIndex(tree.nodeIndex, existing);

  // Build new subtree
  const newNode = vnodeToRenderNode(replacement, tree.nodeIndex);

  // Find parent and swap
  const parent = findParent(tree.root, targetId);
  if (parent) {
    const idx = parent.children.findIndex((c) => c.id === targetId);
    if (idx >= 0) {
      parent.children[idx] = newNode;
    }
  } else if (tree.root?.id === targetId) {
    tree.root = newNode;
  }

  return true;
}

/** Remove a node and all descendants from the index. */
function removeSubtreeFromIndex(index: Map<number, RenderNode>, node: RenderNode): void {
  index.delete(node.id);
  for (const child of node.children) {
    removeSubtreeFromIndex(index, child);
  }
}

/** Find the parent of a node by ID. */
function findParent(root: RenderNode | null, targetId: number): RenderNode | null {
  if (!root) return null;

  for (const child of root.children) {
    if (child.id === targetId) return root;
    const found = findParent(child, targetId);
    if (found) return found;
  }

  return null;
}

/** Count all nodes in a tree. */
export function countNodes(node: RenderNode | null): number {
  if (!node) return 0;
  return 1 + node.children.reduce((sum, c) => sum + countNodes(c), 0);
}

/** Compute the maximum depth of a tree. */
export function treeDepth(node: RenderNode | null): number {
  if (!node) return 0;
  if (node.children.length === 0) return 1;
  return 1 + Math.max(...node.children.map(treeDepth));
}

/** Walk all nodes in depth-first order. */
export function walkTree(node: RenderNode | null, visitor: (node: RenderNode, depth: number) => void, depth = 0): void {
  if (!node) return;
  visitor(node, depth);
  for (const child of node.children) {
    walkTree(child, visitor, depth + 1);
  }
}

/** Find nodes matching a predicate. */
export function findNodes(root: RenderNode | null, predicate: (node: RenderNode) => boolean): RenderNode[] {
  const results: RenderNode[] = [];
  walkTree(root, (node) => {
    if (predicate(node)) results.push(node);
  });
  return results;
}

/** Find a single node by text content. */
export function findByText(root: RenderNode | null, text: string): RenderNode | null {
  const results = findNodes(root, (n) => n.type === 'text' && n.props.content === text);
  return results[0] ?? null;
}

/** Find a single node by ID. */
export function findById(root: RenderNode | null, id: number): RenderNode | null {
  const results = findNodes(root, (n) => n.id === id);
  return results[0] ?? null;
}
