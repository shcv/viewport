# Protocol B: Unified Reactive Slot Graph

**Status: Stub — needs implementation**

## Overview

Everything — nodes, styles, data, configuration — lives in the slot table. The viewer
walks references from a root slot (slot 0) to discover the tree. Updates are SET/DEL
operations. Anything referencing a changed slot re-renders.

## Wire Format

Only two operations: SET and DEL on slots.

```
SET 5 {kind: "style", color: "#e0e0e0", weight: "bold"}
SET 2 {kind: "text", style: @5, content: "hello"}
SET 1 {kind: "box", children: [@2]}
SET 0 {kind: "root", child: @1}

// Update is just another SET:
SET 2 {kind: "text", style: @5, content: "goodbye"}

// Delete:
DEL 2
```

Slot references use `@N` notation in the design doc. In msgpack, these are encoded as
integers with a marker (e.g., negative numbers or a wrapper object).

## Task: Implement `SlotGraphBackend`

Create `backend.ts` implementing the `ProtocolBackend` interface from `../../core/types.ts`.

### Requirements

1. **encode(message: ProtocolMessage) → Uint8Array**
   - Convert high-level messages (TREE, PATCH, DEFINE, etc.) into SET/DEL operations
   - A TREE message becomes a series of SET operations for each node
   - A PATCH message becomes SET operations for changed nodes
   - A DEFINE message maps directly to a SET on the slot
   - Encode as msgpack

2. **decode(data: Uint8Array) → ProtocolMessage**
   - Decode SET/DEL operations back to high-level messages
   - This is the tricky part: the decoder needs to classify what kind of slot
     value it's looking at (node vs style vs data) and reconstruct the
     appropriate ProtocolMessage
   - Strategy: look at the `kind` field to determine slot type

3. **encodeFrame / decodeFrame**
   - Wrap encode/decode with the standard 8-byte frame header
   - Use `../../core/wire.ts` helpers

### Design Decisions to Make

- **Slot reference encoding:** How are references like `@5` encoded in msgpack?
  Options: negative integers, `{ref: 5}` wrapper objects, or a tagged extension type.
  Recommend: `{ref: N}` for clarity in the prototype.

- **Node-to-slot mapping:** When encoding a TREE message, assign slot IDs to nodes.
  Strategy: use the node's `id` field + an offset (e.g., slot = nodeId + 128, since
  0-127 are reserved).

- **Children encoding:** Children arrays hold slot references. When a child is
  inserted/removed, the parent's entire children array is re-SET.

- **Reactive dependency tracking:** The viewer implementation (not this backend)
  handles dependency tracking. This backend just serializes SET/DEL ops.

### Slot Organization

```
Slots 0-127:     Reserved (viewer-populated: colors, keybinds, transitions)
Slot 128+:       Application-defined (nodes, styles, data, schemas)
```

### Testing

Run existing tests with this backend swapped in:
```bash
npx tsx src/harness/cli.ts --matrix
```

The harness will automatically compare wire sizes, parse times, and quality between
Protocol A and Protocol B.

### Files to Create

- `backend.ts` — `SlotGraphBackend` class
- `index.ts` — Exports (see protocol-a-tree-patch/index.ts for pattern)

### Reference

- Design doc section 4.2, "Candidate B: Unified reactive slot graph"
- Core types: `../../core/types.ts`
- Wire format: `../../core/wire.ts`
- Protocol A reference: `../protocol-a-tree-patch/backend.ts`
