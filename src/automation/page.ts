/**
 * ViewportPage — Playwright-style page automation for Viewport apps.
 *
 * Provides a high-level API for interacting with Viewport apps:
 * finding elements, clicking, typing, asserting, and inspecting state.
 */

import type {
  RenderTree,
  RenderNode,
  InputEvent,
  ViewerMetrics,
  ScreenshotResult,
  AppFactory,
  ProtocolBackend,
  ViewerBackend,
} from '../core/types.js';
import { TestHarness } from '../harness/harness.js';
import { Locator } from './locator.js';

export interface PageOptions {
  /** Viewport width. */
  width?: number;
  /** Viewport height. */
  height?: number;
  /** Timeout for waitFor operations (ms). */
  defaultTimeout?: number;
}

export class ViewportPage {
  private harness: TestHarness;
  private _defaultTimeout: number;

  constructor(
    app: AppFactory,
    protocol: ProtocolBackend,
    viewer: ViewerBackend,
    options?: PageOptions,
  ) {
    this.harness = new TestHarness({
      app,
      protocol,
      viewer,
      env: {
        displayWidth: options?.width ?? 800,
        displayHeight: options?.height ?? 600,
      },
    });
    this._defaultTimeout = options?.defaultTimeout ?? 5000;
    this.harness.start();
  }

  /** Tear down the page and all resources. */
  close(): void {
    this.harness.stop();
  }

  // ── Locators ─────────────────────────────────────────────────

  /** Find element(s) by text content. */
  getByText(text: string, options?: { exact?: boolean }): Locator {
    return new Locator(
      { type: 'text', text, exact: options?.exact ?? false },
      () => this.harness.getTree(),
    );
  }

  /** Find element by node ID. */
  getById(id: number): Locator {
    return new Locator(
      { type: 'id', id },
      () => this.harness.getTree(),
    );
  }

  /** Find elements by role. */
  getByRole(role: string): Locator {
    return new Locator(
      { type: 'role', role },
      () => this.harness.getTree(),
    );
  }

  /** Find elements by node type. */
  getByType(nodeType: string): Locator {
    return new Locator(
      { type: 'type', nodeType },
      () => this.harness.getTree(),
    );
  }

  /** Find elements matching a predicate. */
  filter(fn: (node: RenderNode) => boolean, description?: string): Locator {
    return new Locator(
      { type: 'predicate', fn, description: description ?? 'custom filter' },
      () => this.harness.getTree(),
    );
  }

  // ── Actions ──────────────────────────────────────────────────

  /** Click on an element. */
  async click(target: Locator | number): Promise<void> {
    const id = this.resolveTarget(target);
    this.harness.sendInput({ kind: 'click', target: id, button: 0 });
  }

  /** Type text into an input element. */
  async type(target: Locator | number, text: string): Promise<void> {
    const id = this.resolveTarget(target);
    // First focus
    this.harness.sendInput({ kind: 'focus', target: id });
    // Then send value change
    this.harness.sendInput({ kind: 'value_change', target: id, value: text });
  }

  /** Clear and type text into an input element. */
  async fill(target: Locator | number, text: string): Promise<void> {
    return this.type(target, text);
  }

  /** Press a keyboard key. */
  async press(key: string): Promise<void> {
    this.harness.sendInput({ kind: 'key', key });
  }

  /** Hover over an element. */
  async hover(target: Locator | number): Promise<void> {
    const id = this.resolveTarget(target);
    this.harness.sendInput({ kind: 'hover', target: id });
  }

  /** Focus an element. */
  async focus(target: Locator | number): Promise<void> {
    const id = this.resolveTarget(target);
    this.harness.sendInput({ kind: 'focus', target: id });
  }

  /** Scroll a scroll region. */
  async scroll(target: Locator | number, scrollTop: number): Promise<void> {
    const id = this.resolveTarget(target);
    this.harness.sendInput({ kind: 'scroll', target: id, scrollTop });
  }

  /** Resize the viewport. */
  async resize(width: number, height: number): Promise<void> {
    this.harness.resize(width, height);
  }

  // ── Assertions ───────────────────────────────────────────────

  /** Wait for text to appear in the tree. */
  async waitForText(text: string, timeout?: number): Promise<void> {
    // In synchronous mode, just check immediately
    const projection = this.harness.getTextProjection();
    if (!projection.includes(text)) {
      throw new Error(`Text "${text}" not found in current projection`);
    }
  }

  /** Wait for a locator to match at least one element. */
  async waitForLocator(locator: Locator, timeout?: number): Promise<void> {
    if (locator.count() === 0) {
      throw new Error(`Locator ${locator.describe()} did not match any elements`);
    }
  }

  /** Assert that text appears in the projection. */
  expectText(text: string): void {
    const projection = this.harness.getTextProjection();
    if (!projection.includes(text)) {
      throw new Error(
        `Expected text "${text}" not found.\nProjection:\n${projection.slice(0, 500)}`
      );
    }
  }

  /** Assert that text does NOT appear in the projection. */
  expectNoText(text: string): void {
    const projection = this.harness.getTextProjection();
    if (projection.includes(text)) {
      throw new Error(`Text "${text}" should not be present but was found in projection`);
    }
  }

  /** Assert a locator matches exactly N elements. */
  expectCount(locator: Locator, count: number): void {
    const actual = locator.count();
    if (actual !== count) {
      throw new Error(
        `Expected ${locator.describe()} to match ${count} element(s), but found ${actual}`
      );
    }
  }

  /** Assert a locator matches at least one element. */
  expectVisible(locator: Locator): void {
    if (!locator.isVisible()) {
      throw new Error(`Expected ${locator.describe()} to be visible, but not found`);
    }
  }

  /** Assert a locator matches no elements. */
  expectHidden(locator: Locator): void {
    if (locator.isVisible()) {
      throw new Error(`Expected ${locator.describe()} to be hidden, but found ${locator.count()} match(es)`);
    }
  }

  // ── Inspection ───────────────────────────────────────────────

  /** Get the full text projection. */
  textContent(): string {
    return this.harness.getTextProjection();
  }

  /** Get a screenshot from the viewer. */
  async screenshot(): Promise<ScreenshotResult> {
    return this.harness.screenshot();
  }

  /** Get the current render tree. */
  getTree(): RenderTree {
    return this.harness.getTree();
  }

  /** Get viewer performance metrics. */
  metrics(): ViewerMetrics {
    return this.harness.getViewerMetrics();
  }

  /** Get the full harness metrics. */
  harnessMetrics() {
    return this.harness.getHarnessMetrics();
  }

  /** Get the message log. */
  messageLog() {
    return this.harness.getMessageLog();
  }

  /** Clear the message log. */
  clearLog(): void {
    this.harness.clearLog();
  }

  // ── Internal ─────────────────────────────────────────────────

  private resolveTarget(target: Locator | number): number {
    if (typeof target === 'number') return target;
    const node = target.resolveOrThrow();
    return node.id;
  }
}

/** Create a page for testing a Viewport app. */
export function createPage(
  app: AppFactory,
  protocol: ProtocolBackend,
  viewer: ViewerBackend,
  options?: PageOptions,
): ViewportPage {
  return new ViewportPage(app, protocol, viewer, options);
}
