/**
 * Protocol benchmarks.
 *
 * Measures encode/decode performance and wire sizes for
 * common operations using the canonical encoding.
 */

import { describe, it, expect } from 'vitest';
import { createCanonicalBackend } from '../../src/protocol/encoding.js';
import { MessageType, type ProtocolMessage, type ProtocolBackend, type VNode } from '../../src/core/types.js';

/** Build a tree of N nodes (balanced binary tree). */
function buildTree(nodeCount: number): VNode {
  let nextId = 1;

  function build(remaining: number): VNode {
    const id = nextId++;
    if (remaining <= 1) {
      return { id, type: 'text', props: { content: `Node ${id}`, color: '#cdd6f4' } };
    }
    const half = Math.floor((remaining - 1) / 2);
    const children = [];
    if (half > 0) children.push(build(half));
    if (remaining - 1 - half > 0) children.push(build(remaining - 1 - half));
    return {
      id,
      type: 'box',
      props: { direction: 'column', gap: 4, padding: 8 },
      children,
    };
  }

  return build(nodeCount);
}

/** Measure encode+decode round trip for a message. */
function benchMessage(backend: ProtocolBackend, msg: ProtocolMessage, iterations: number) {
  // Warm up
  for (let i = 0; i < 10; i++) {
    const encoded = backend.encode(msg);
    backend.decode(encoded);
  }

  // Measure encode
  const encodeStart = performance.now();
  let encodedSize = 0;
  for (let i = 0; i < iterations; i++) {
    const encoded = backend.encode(msg);
    encodedSize = encoded.length;
  }
  const encodeTime = performance.now() - encodeStart;

  // Measure decode
  const encoded = backend.encode(msg);
  const decodeStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    backend.decode(encoded);
  }
  const decodeTime = performance.now() - decodeStart;

  return {
    encodedSize,
    encodeTimeMs: encodeTime / iterations,
    decodeTimeMs: decodeTime / iterations,
    totalTimeMs: (encodeTime + decodeTime) / iterations,
  };
}

describe('Protocol benchmarks', () => {
  describe('small tree (10 nodes)', () => {
    const tree = buildTree(10);
    const msg: ProtocolMessage = { type: MessageType.TREE, root: tree };

    it('encode/decode round trip', () => {
      const backend = createCanonicalBackend();
      const result = benchMessage(backend, msg, 1000);

      console.log(`  Canonical: ${result.encodedSize} bytes, encode ${result.encodeTimeMs.toFixed(4)}ms, decode ${result.decodeTimeMs.toFixed(4)}ms`);

      expect(result.encodedSize).toBeGreaterThan(0);
      // Verify round-trip fidelity
      const encoded = backend.encode(msg);
      const decoded = backend.decode(encoded);
      expect(decoded.type).toBe(MessageType.TREE);
    });
  });

  describe('medium tree (100 nodes)', () => {
    const tree = buildTree(100);
    const msg: ProtocolMessage = { type: MessageType.TREE, root: tree };

    it('encode/decode round trip', () => {
      const backend = createCanonicalBackend();
      const result = benchMessage(backend, msg, 100);

      console.log(`  Canonical: ${result.encodedSize} bytes, encode ${result.encodeTimeMs.toFixed(4)}ms, decode ${result.decodeTimeMs.toFixed(4)}ms`);

      expect(result.encodedSize).toBeGreaterThan(0);
    });
  });

  describe('large tree (500 nodes)', () => {
    const tree = buildTree(500);
    const msg: ProtocolMessage = { type: MessageType.TREE, root: tree };

    it('encode/decode round trip', () => {
      const backend = createCanonicalBackend();
      const result = benchMessage(backend, msg, 50);

      console.log(`  Canonical: ${result.encodedSize} bytes, encode ${result.encodeTimeMs.toFixed(4)}ms, decode ${result.decodeTimeMs.toFixed(4)}ms`);

      expect(result.encodedSize).toBeGreaterThan(0);
    });
  });

  describe('single cell update (PATCH)', () => {
    const msg: ProtocolMessage = {
      type: MessageType.PATCH,
      ops: [{ target: 42, set: { content: 'updated value' } }],
    };

    it('single patch', () => {
      const backend = createCanonicalBackend();
      const result = benchMessage(backend, msg, 5000);

      console.log(`  Canonical: ${result.encodedSize} bytes, encode ${result.encodeTimeMs.toFixed(4)}ms, decode ${result.decodeTimeMs.toFixed(4)}ms`);

      expect(result.encodedSize).toBeGreaterThan(0);
    });
  });

  describe('batch patch (100 updates)', () => {
    const msg: ProtocolMessage = {
      type: MessageType.PATCH,
      ops: Array.from({ length: 100 }, (_, i) => ({
        target: i + 1,
        set: { content: `row ${i} updated`, color: '#ff0000' },
      })),
    };

    it('batch patch', () => {
      const backend = createCanonicalBackend();
      const result = benchMessage(backend, msg, 100);

      console.log(`  Canonical: ${result.encodedSize} bytes, encode ${result.encodeTimeMs.toFixed(4)}ms, decode ${result.decodeTimeMs.toFixed(4)}ms`);

      expect(result.encodedSize).toBeGreaterThan(0);
    });
  });

  describe('data record streaming (1000 records)', () => {
    it('1000 data records', () => {
      const backend = createCanonicalBackend();

      let totalBytes = 0;
      const start = performance.now();

      for (let i = 0; i < 1000; i++) {
        const msg: ProtocolMessage = {
          type: MessageType.DATA,
          schema: 100,
          row: [`file_${i}.txt`, 1024 * (i + 1), Date.now() / 1000 - i * 3600],
        };
        const encoded = backend.encode(msg);
        totalBytes += encoded.length;
        backend.decode(encoded);
      }

      const elapsed = performance.now() - start;
      console.log(`  Canonical: ${totalBytes} total bytes, ${(totalBytes / 1000).toFixed(1)} bytes/record, ${elapsed.toFixed(1)}ms total`);

      expect(totalBytes).toBeGreaterThan(0);
    });
  });

  describe('wire size summary', () => {
    it('should print wire sizes for common operations', () => {
      const backend = createCanonicalBackend();

      const scenarios: Array<{ name: string; msg: ProtocolMessage }> = [
        {
          name: 'Small tree (10 nodes)',
          msg: { type: MessageType.TREE, root: buildTree(10) },
        },
        {
          name: 'Medium tree (100 nodes)',
          msg: { type: MessageType.TREE, root: buildTree(100) },
        },
        {
          name: 'Single patch',
          msg: { type: MessageType.PATCH, ops: [{ target: 42, set: { content: 'updated' } }] },
        },
        {
          name: 'Batch patch (100)',
          msg: {
            type: MessageType.PATCH,
            ops: Array.from({ length: 100 }, (_, i) => ({ target: i, set: { content: `v${i}` } })),
          },
        },
        {
          name: 'DEFINE slot',
          msg: { type: MessageType.DEFINE, slot: 5, value: { kind: 'style', color: '#e0e0e0', weight: 'bold' } },
        },
        {
          name: 'DATA record',
          msg: { type: MessageType.DATA, schema: 100, row: ['server.log', 48231, 1738764180] },
        },
      ];

      console.log('\n  Wire Sizes (Canonical Encoding):');
      console.log('  ' + '-'.repeat(40));
      console.log(`  ${'Scenario'.padEnd(25)} ${'Bytes'.padStart(10)}`);
      console.log('  ' + '-'.repeat(40));

      for (const scenario of scenarios) {
        const size = backend.encode(scenario.msg).length;
        console.log(`  ${scenario.name.padEnd(25)} ${String(size).padStart(10)}`);
      }

      console.log('  ' + '-'.repeat(40));
    });
  });
});
