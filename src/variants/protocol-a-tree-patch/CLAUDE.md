# Protocol A: Tree + Patch with Separate Slot Table

**Status: Reference implementation (complete)**

## Overview

This is the "preferred direction" from the design doc — Candidate A. It uses separate
concepts for the definition table (styles, data bindings, templates) and the render
tree (live node hierarchy addressed by node IDs).

## Wire Format

Messages use named fields in CBOR (RFC 8949):

```
DEFINE {slot: 5, value: {kind: "style", color: "#e0e0e0", weight: "bold"}}
TREE   {root: {id: 1, type: "box", children: [{id: 2, type: "text", content: "hello"}]}}
PATCH  {ops: [{target: 2, set: {content: "goodbye"}}]}
```

Each message is wrapped in the standard 8-byte frame header before the CBOR payload.
CBOR is used for compatibility with other protocol layers in the stack.

## Key Files

- `backend.ts` — `TreePatchBackend` class implementing `ProtocolBackend`
- `index.ts` — Exports

## Implementation Notes

- Node properties are flattened into the serialized node object (not nested under "props")
- Children are serialized as a `children` array on the parent
- Patch operations use named keys: `set`, `children_insert`, `children_remove`, etc.
- Deserialization extracts `id`, `type`, `children`, `text_alt` from node objects; everything else becomes `props`
- CBOR encoding/decoding uses the `cborg` library

## What to Test

- Round-trip encode/decode fidelity for all message types
- Wire size compared to Protocol B and C for the same operations
- Parse performance on large trees (500+ nodes)
- Patch performance on deep trees

## Design Tradeoffs

**Pros:**
- Clear mental model (tree is a tree, slots are parameters)
- Explicit patches are easy to debug and replay
- Frameworks (React-like) already think in tree + diff terms

**Cons:**
- Two namespaces (slots and node IDs) — more protocol surface
- Named fields in CBOR add key-string overhead vs positional arrays
