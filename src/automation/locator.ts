/**
 * Locator — identifies elements in the Viewport render tree.
 *
 * Inspired by Playwright's Locator API. Locators are lazy — they
 * don't resolve until an action or assertion is performed.
 */

import type { RenderNode, RenderTree } from '../core/types.js';
import { findNodes, walkTree } from '../core/tree.js';

export type LocatorStrategy =
  | { type: 'id'; id: number }
  | { type: 'text'; text: string; exact: boolean }
  | { type: 'type'; nodeType: string }
  | { type: 'role'; role: string }
  | { type: 'predicate'; fn: (node: RenderNode) => boolean; description: string }
  | { type: 'chain'; parent: LocatorStrategy; child: LocatorStrategy }
  | { type: 'nth'; inner: LocatorStrategy; index: number };

export class Locator {
  constructor(
    private strategy: LocatorStrategy,
    private treeProvider: () => RenderTree,
  ) {}

  /** Resolve the locator against the current tree. Returns all matches. */
  resolveAll(): RenderNode[] {
    const tree = this.treeProvider();
    return resolveStrategy(tree, this.strategy);
  }

  /** Resolve to the first match, or null. */
  resolve(): RenderNode | null {
    return this.resolveAll()[0] ?? null;
  }

  /** Resolve to the first match, throwing if not found. */
  resolveOrThrow(): RenderNode {
    const node = this.resolve();
    if (!node) {
      throw new Error(`Locator did not match any element: ${this.describe()}`);
    }
    return node;
  }

  /** Number of matching elements. */
  count(): number {
    return this.resolveAll().length;
  }

  /** Chain: find within this locator's matches. */
  locator(child: Locator): Locator {
    return new Locator(
      { type: 'chain', parent: this.strategy, child: child.strategy },
      this.treeProvider,
    );
  }

  /** Get the nth match. */
  nth(index: number): Locator {
    return new Locator(
      { type: 'nth', inner: this.strategy, index },
      this.treeProvider,
    );
  }

  /** Get the first match. */
  first(): Locator {
    return this.nth(0);
  }

  /** Get the last match. */
  last(): Locator {
    return new Locator(
      { type: 'nth', inner: this.strategy, index: -1 },
      this.treeProvider,
    );
  }

  /** Human-readable description. */
  describe(): string {
    return describeStrategy(this.strategy);
  }

  /** Get text content of the matched node(s). */
  textContent(): string {
    const node = this.resolve();
    if (!node) return '';
    return getTextContent(node);
  }

  /** Get a property value from the first match. */
  getAttribute(key: string): unknown {
    const node = this.resolve();
    return node?.props[key];
  }

  /** Check if the locator matches any element. */
  isVisible(): boolean {
    return this.resolve() !== null;
  }
}

// ── Resolution ─────────────────────────────────────────────────────

function resolveStrategy(tree: RenderTree, strategy: LocatorStrategy): RenderNode[] {
  switch (strategy.type) {
    case 'id': {
      const node = tree.nodeIndex.get(strategy.id);
      return node ? [node] : [];
    }

    case 'text': {
      return findNodes(tree.root, (n) => {
        if (n.type !== 'text' || !n.props.content) return false;
        if (strategy.exact) return n.props.content === strategy.text;
        return (n.props.content as string).includes(strategy.text);
      });
    }

    case 'type': {
      return findNodes(tree.root, (n) => n.type === strategy.nodeType);
    }

    case 'role': {
      // Map roles to node properties
      switch (strategy.role) {
        case 'button':
          return findNodes(tree.root, (n) => n.props.interactive === 'clickable');
        case 'input':
        case 'textbox':
          return findNodes(tree.root, (n) => n.type === 'input');
        case 'list':
          return findNodes(tree.root, (n) => n.type === 'scroll');
        case 'heading':
          return findNodes(tree.root, (n) =>
            n.type === 'text' && (n.props.weight === 'bold' && (n.props.size as number) > 14)
          );
        case 'separator':
          return findNodes(tree.root, (n) => n.type === 'separator');
        default:
          return [];
      }
    }

    case 'predicate': {
      return findNodes(tree.root, strategy.fn);
    }

    case 'chain': {
      const parents = resolveStrategy(tree, strategy.parent);
      const results: RenderNode[] = [];
      for (const parent of parents) {
        // Search within each parent's subtree
        const children = findNodes(parent, (n) => n !== parent);
        const childTree: RenderTree = {
          ...tree,
          root: parent,
        };
        const matches = resolveStrategy(childTree, strategy.child);
        results.push(...matches);
      }
      return results;
    }

    case 'nth': {
      const all = resolveStrategy(tree, strategy.inner);
      if (strategy.index === -1) {
        return all.length > 0 ? [all[all.length - 1]] : [];
      }
      return strategy.index < all.length ? [all[strategy.index]] : [];
    }
  }
}

function describeStrategy(strategy: LocatorStrategy): string {
  switch (strategy.type) {
    case 'id': return `getById(${strategy.id})`;
    case 'text': return `getByText("${strategy.text}"${strategy.exact ? ', exact' : ''})`;
    case 'type': return `getByType("${strategy.nodeType}")`;
    case 'role': return `getByRole("${strategy.role}")`;
    case 'predicate': return `filter(${strategy.description})`;
    case 'chain': return `${describeStrategy(strategy.parent)} >> ${describeStrategy(strategy.child)}`;
    case 'nth': return `${describeStrategy(strategy.inner)}.nth(${strategy.index})`;
  }
}

function getTextContent(node: RenderNode): string {
  if (node.type === 'text') return node.props.content as string ?? '';
  if (node.type === 'input') return node.props.value as string ?? '';
  return node.children.map(getTextContent).join('');
}
