# Protocol B: Unified Reactive Slot Graph

**Status: Complete**

## Overview

Everything — nodes, styles, data, configuration — lives in the slot table. The viewer
walks references from a root slot (slot 0) to discover the tree. Updates are SET/DEL
operations. Anything referencing a changed slot re-renders.

## Wire Format

Only two operations: SET and DEL on slots, encoded as CBOR (RFC 8949).

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

Slot references use `@N` notation in the design doc. In CBOR, these are encoded as
`{ref: N}` wrapper objects for clarity.

## Key Files

- `backend.ts` — `SlotGraphBackend` class implementing `ProtocolBackend`
- `index.ts` — Exports

## Implementation Notes

- All messages are converted to SET/DEL slot operations
- TREE messages flatten the node tree into individual SET ops per node
- PATCH messages become SET ops for changed nodes, DEL ops for removed nodes
- DEFINE messages map directly to a SET on the target slot
- Node IDs are mapped to slot IDs via offset (slot = nodeId + 128, since 0-127 reserved)
- Children arrays hold `{ref: slotId}` references
- Special synthetic slots for non-slot messages: DATA → slot -1, INPUT → slot -2, ENV → slot -3
- CBOR encoding/decoding uses the `cborg` library

### Slot Organization

```
Slots 0-127:     Reserved (viewer-populated: colors, keybinds, transitions)
Slot 128+:       Application-defined (nodes, styles, data, schemas)
```

## Design Tradeoffs

**Pros:**
- Uniform model — everything is a slot, only SET/DEL operations
- Natural for reactive systems (dependency tracking on slot references)
- Easy to implement incremental updates

**Cons:**
- Heuristic needed to reconstruct high-level messages from slot ops on decode
- Children modifications require re-SET of the parent slot
- Slightly more complex than direct tree+patch for simple cases

## Testing

```bash
npx tsx src/harness/cli.ts --matrix   # Compare across all protocols
npm test                               # Run full test suite
```
