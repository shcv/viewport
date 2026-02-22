/**
 * Protocol module — canonical encoding and comparison variants.
 *
 * The canonical encoding uses integer-keyed CBOR maps with opcode tuples.
 * Comparison variants (tree-patch, slot-graph, opcodes) are preserved
 * under variants/ for benchmarking.
 */

export { CanonicalBackend, createCanonicalBackend } from './encoding.js';

// Comparison variants
export { createTreePatchBackend } from './variants/tree-patch/index.js';
export { createSlotGraphBackend } from './variants/slot-graph/index.js';
export { createOpcodeBackend } from './variants/opcodes/index.js';
