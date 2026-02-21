/**
 * Integration tests for the test harness.
 *
 * Tests that the full pipeline works: app → protocol → viewer,
 * with correct metrics, text projection, and quality checks.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TestHarness } from '../../src/harness/harness.js';
import { runQualityChecks } from '../../src/harness/quality.js';
import { summarizeMetrics } from '../../src/harness/metrics.js';
import { createTreePatchBackend } from '../../src/variants/protocol-a-tree-patch/index.js';
import { createHeadlessViewer } from '../../src/variants/viewer-headless/index.js';
import { counterApp } from '../../src/test-apps/counter.js';
import { fileBrowserApp } from '../../src/test-apps/file-browser.js';
import { dashboardApp } from '../../src/test-apps/dashboard.js';
import { tableViewApp } from '../../src/test-apps/table-view.js';
import { formWizardApp } from '../../src/test-apps/form-wizard.js';
import { chatApp } from '../../src/test-apps/chat.js';
import { ALL_APPS } from '../../src/test-apps/index.js';

function createHarness(app: typeof counterApp) {
  return new TestHarness({
    app,
    protocol: createTreePatchBackend(),
    viewer: createHeadlessViewer(),
  });
}

describe('TestHarness', () => {
  describe('counter app', () => {
    let harness: TestHarness;

    beforeEach(() => {
      harness = createHarness(counterApp);
      harness.start();
    });

    it('should produce a non-empty tree after start', () => {
      const tree = harness.getTree();
      expect(tree.root).not.toBeNull();
      expect(tree.nodeIndex.size).toBeGreaterThan(0);
    });

    it('should produce non-empty text projection', () => {
      const text = harness.getTextProjection();
      expect(text).toContain('Counter');
      expect(text).toContain('Count: 0');
    });

    it('should handle increment click', () => {
      harness.sendInput({ kind: 'click', target: 7 }); // INC_BTN
      const text = harness.getTextProjection();
      expect(text).toContain('Count: 1');
    });

    it('should handle decrement click', () => {
      harness.sendInput({ kind: 'click', target: 7 }); // increment
      harness.sendInput({ kind: 'click', target: 7 }); // increment
      harness.sendInput({ kind: 'click', target: 5 }); // decrement
      const text = harness.getTextProjection();
      expect(text).toContain('Count: 1');
    });

    it('should handle keyboard input', () => {
      harness.sendInput({ kind: 'key', key: 'ArrowUp' });
      harness.sendInput({ kind: 'key', key: 'ArrowUp' });
      harness.sendInput({ kind: 'key', key: 'ArrowUp' });
      const text = harness.getTextProjection();
      expect(text).toContain('Count: 3');
    });

    it('should handle reset', () => {
      harness.sendInput({ kind: 'key', key: 'ArrowUp' });
      harness.sendInput({ kind: 'click', target: 9 }); // RESET_BTN
      const text = harness.getTextProjection();
      expect(text).toContain('Count: 0');
    });

    it('should collect metrics', () => {
      const metrics = harness.getHarnessMetrics();
      expect(metrics.totalMessages).toBeGreaterThan(0);
      expect(metrics.totalWireBytes).toBeGreaterThan(0);
      expect(metrics.viewerMetrics.treeNodeCount).toBeGreaterThan(0);
    });

    it('should pass quality checks', () => {
      const report = runQualityChecks(harness.getTree());
      expect(report.passed).toBe(true);
      expect(report.score).toBeGreaterThan(50);
    });
  });

  describe('all apps load successfully', () => {
    for (const [name, app] of Object.entries(ALL_APPS)) {
      it(`${name} should load and produce a tree`, () => {
        const harness = createHarness(app);
        harness.start();

        const tree = harness.getTree();
        expect(tree.root).not.toBeNull();
        expect(tree.nodeIndex.size).toBeGreaterThan(0);

        const text = harness.getTextProjection();
        expect(text.length).toBeGreaterThan(0);

        const metrics = harness.getHarnessMetrics();
        expect(metrics.totalMessages).toBeGreaterThan(0);

        harness.stop();
      });

      it(`${name} should pass quality checks`, () => {
        const harness = createHarness(app);
        harness.start();

        const report = runQualityChecks(harness.getTree());
        // All apps should at least pass error-level checks
        const errors = report.checks.filter((c) => c.severity === 'error' && !c.passed);
        expect(errors).toHaveLength(0);

        harness.stop();
      });
    }
  });

  describe('file-browser app', () => {
    it('should define schema and emit data', () => {
      const harness = createHarness(fileBrowserApp);
      harness.start();

      const tree = harness.getTree();
      expect(tree.schemas.size).toBeGreaterThan(0);
      expect(tree.dataRows.size).toBeGreaterThan(0);

      const text = harness.getTextProjection();
      expect(text).toContain('File Browser');

      harness.stop();
    });

    it('should handle navigation', () => {
      const harness = createHarness(fileBrowserApp);
      harness.start();

      harness.sendInput({ kind: 'key', key: 'ArrowDown' });
      harness.sendInput({ kind: 'key', key: 'ArrowDown' });

      const text = harness.getTextProjection();
      expect(text).toContain('File Browser');

      harness.stop();
    });
  });

  describe('dashboard app', () => {
    it('should handle refresh updates', () => {
      const harness = createHarness(dashboardApp);
      harness.start();

      const initialText = harness.getTextProjection();
      expect(initialText).toContain('System Monitor');

      // Refresh several times
      for (let i = 0; i < 5; i++) {
        harness.sendInput({ kind: 'key', key: 'r' });
      }

      const metrics = harness.getHarnessMetrics();
      expect(metrics.totalMessages).toBeGreaterThan(5);

      harness.stop();
    });
  });

  describe('table-view app', () => {
    it('should handle filtering', () => {
      const harness = createHarness(tableViewApp);
      harness.start();

      harness.sendInput({ kind: 'value_change', target: 5, value: 'Admin' });

      const text = harness.getTextProjection();
      expect(text).toContain('Users');

      harness.stop();
    });
  });

  describe('form-wizard app', () => {
    it('should handle multi-step navigation', () => {
      const harness = createHarness(formWizardApp);
      harness.start();

      // Fill step 1
      harness.sendInput({ kind: 'value_change', target: 101, value: 'Test User' });
      harness.sendInput({ kind: 'value_change', target: 104, value: 'test@example.com' });

      // Next
      harness.sendInput({ kind: 'click', target: 403 });

      const text = harness.getTextProjection();
      expect(text).toContain('Preferences');

      harness.stop();
    });
  });

  describe('chat app', () => {
    it('should handle sending messages', () => {
      const harness = createHarness(chatApp);
      harness.start();

      // Type and send
      harness.sendInput({ kind: 'value_change', target: 11, value: 'Hello!' });
      harness.sendInput({ kind: 'key', key: 'Enter' });

      const text = harness.getTextProjection();
      expect(text).toContain('Hello!');

      harness.stop();
    });
  });

  describe('metrics', () => {
    it('should produce valid metric summaries', () => {
      const harness = createHarness(counterApp);
      harness.start();

      // Do some interactions
      for (let i = 0; i < 10; i++) {
        harness.sendInput({ kind: 'click', target: 7 });
      }

      const metrics = harness.getHarnessMetrics();
      const summary = summarizeMetrics(metrics);

      expect(summary.totalBytes).toBeGreaterThan(0);
      expect(summary.bytesPerMessage).toBeGreaterThan(0);
      expect(summary.finalNodeCount).toBeGreaterThan(0);
      expect(summary.messagesPerSecond).toBeGreaterThan(0);

      harness.stop();
    });
  });
});
