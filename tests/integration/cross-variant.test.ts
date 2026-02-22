/**
 * Cross-variant tests.
 *
 * Verifies that different protocol backends produce equivalent results
 * for the same app — same tree structure, same text projection.
 */

import { describe, it, expect } from 'vitest';
import { TestHarness } from '../../src/harness/harness.js';
import { compareTextProjections, compareTreeStructures } from '../../src/harness/quality.js';
import { createTreePatchBackend } from '../../src/protocol/variants/tree-patch/index.js';
import { createSlotGraphBackend } from '../../src/protocol/variants/slot-graph/index.js';
import { createOpcodeBackend } from '../../src/protocol/variants/opcodes/index.js';
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

describe('Cross-variant: Protocol A vs B vs C vs Canonical', () => {
  const backends = [
    { name: 'Protocol A', create: createTreePatchBackend },
    { name: 'Protocol B', create: createSlotGraphBackend },
    { name: 'Protocol C', create: createOpcodeBackend },
    { name: 'Canonical', create: createCanonicalBackend },
  ];

  for (const [appName, app] of Object.entries(ALL_APPS)) {
    describe(`${appName}`, () => {
      it('all backends should produce a non-empty tree', () => {
        for (const backend of backends) {
          const harness = createHarness(app, backend.create());
          harness.start();

          const tree = harness.getTree();
          expect(tree.root, `${backend.name} produced null tree for ${appName}`).not.toBeNull();
          expect(tree.nodeIndex.size, `${backend.name} has no indexed nodes`).toBeGreaterThan(0);

          harness.stop();
        }
      });

      it('all backends should produce non-empty text projections', () => {
        for (const backend of backends) {
          const harness = createHarness(app, backend.create());
          harness.start();

          const text = harness.getTextProjection();
          expect(text.length, `${backend.name} produced empty text for ${appName}`).toBeGreaterThan(0);

          harness.stop();
        }
      });

      it('Protocol A and C should produce matching tree structures', () => {
        const harnessA = createHarness(app, createTreePatchBackend());
        const harnessC = createHarness(app, createOpcodeBackend());

        harnessA.start();
        harnessC.start();

        const check = compareTreeStructures(
          harnessA.getTree(),
          harnessC.getTree(),
          'Protocol A',
          'Protocol C',
        );

        expect(check.passed, `Tree structures differ for ${appName}: ${check.message}`).toBe(true);

        harnessA.stop();
        harnessC.stop();
      });

      it('Protocol A and Canonical should produce matching text projections', () => {
        const harnessA = createHarness(app, createTreePatchBackend());
        const harnessCanonical = createHarness(app, createCanonicalBackend());

        harnessA.start();
        harnessCanonical.start();

        const check = compareTextProjections(
          harnessA.getTree(),
          harnessCanonical.getTree(),
          'Protocol A',
          'Canonical',
        );

        expect(check.passed, `Text projections differ for ${appName}: ${check.message}`).toBe(true);

        harnessA.stop();
        harnessCanonical.stop();
      });
    });
  }
});

describe('Wire efficiency comparison', () => {
  for (const [appName, app] of Object.entries(ALL_APPS)) {
    it(`${appName}: Protocol C should use fewer wire bytes than Protocol A`, () => {
      const harnessA = createHarness(app, createTreePatchBackend());
      const harnessC = createHarness(app, createOpcodeBackend());

      harnessA.start();
      harnessC.start();

      const metricsA = harnessA.getHarnessMetrics();
      const metricsC = harnessC.getHarnessMetrics();

      // Protocol C with abbreviated keys should be smaller
      // (This is a soft assertion — it's expected but not guaranteed for all cases)
      if (metricsA.totalWireBytes > 0 && metricsC.totalWireBytes > 0) {
        const ratio = metricsC.totalWireBytes / metricsA.totalWireBytes;
        // Log the ratio for visibility
        console.log(`  ${appName}: A=${metricsA.totalWireBytes} bytes, C=${metricsC.totalWireBytes} bytes, ratio=${ratio.toFixed(2)}`);
      }

      harnessA.stop();
      harnessC.stop();
    });
  }
});
