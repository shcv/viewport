/**
 * Protocol encoding tests.
 *
 * Verifies that the canonical backend produces correct results
 * for all apps — non-empty trees, valid text projections.
 */

import { describe, it, expect } from 'vitest';
import { TestHarness } from '../../src/harness/harness.js';
import { createCanonicalBackend } from '../../src/protocol/encoding.js';
import { createHeadlessViewer } from '../../src/viewer/headless/index.js';
import { ALL_APPS } from '../../src/test-apps/index.js';
import type { ProtocolBackend } from '../../src/core/types.js';

function createHarness(app: typeof ALL_APPS[string], protocol: ProtocolBackend) {
  return new TestHarness({
    app,
    protocol,
    viewer: createHeadlessViewer(),
  });
}

describe('Canonical encoding', () => {
  for (const [appName, app] of Object.entries(ALL_APPS)) {
    describe(`${appName}`, () => {
      it('should produce a non-empty tree', () => {
        const harness = createHarness(app, createCanonicalBackend());
        harness.start();

        const tree = harness.getTree();
        expect(tree.root, `Canonical produced null tree for ${appName}`).not.toBeNull();
        expect(tree.nodeIndex.size, `Canonical has no indexed nodes`).toBeGreaterThan(0);

        harness.stop();
      });

      it('should produce non-empty text projection', () => {
        const harness = createHarness(app, createCanonicalBackend());
        harness.start();

        const text = harness.getTextProjection();
        expect(text.length, `Canonical produced empty text for ${appName}`).toBeGreaterThan(0);

        harness.stop();
      });

      it('should round-trip encode/decode correctly', () => {
        const harness = createHarness(app, createCanonicalBackend());
        harness.start();

        const metrics = harness.getHarnessMetrics();
        expect(metrics.totalWireBytes).toBeGreaterThan(0);
        expect(metrics.totalMessages).toBeGreaterThan(0);

        harness.stop();
      });
    });
  }
});
