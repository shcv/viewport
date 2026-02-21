# Protocol C: Integer Opcode Tuples

**Status: Stub — needs implementation**

## Overview

Each message is a small positional array. Opcode is an integer. Maximally compact
wire format — no named keys, no schema overhead.

## Wire Format

```
[0, 5, {k: "style", c: "#e0e0e0", w: "bold"}]   // SET slot 5
[0, 2, {k: "text", s: 5, c: "hello"}]              // SET node slot
[1, 2]                                               // DEL slot 2
[2, {t: 2, c: "goodbye"}]                            // PATCH target=2
[3, {r: {id: 1, t: "box", ch: [...]}}]              // TREE
```

## Opcodes

```
0 = SET(slot, value)      — define a slot
1 = DEL(slot)             — remove a slot
2 = PATCH(ops)            — incremental tree update
3 = TREE(root)            — full tree
4 = DATA(schema?, row)    — structured data record
5 = SCHEMA(slot, columns) — schema definition
6 = INPUT(event)          — input event
7 = ENV(env)              — environment info
```

## Task: Implement `OpcodeBackend`

Create `backend.ts` implementing the `ProtocolBackend` interface from `../../core/types.ts`.

### Requirements

1. **encode(message: ProtocolMessage) → Uint8Array**
   - Convert messages to positional arrays with abbreviated keys
   - Use single-letter property names for node props to minimize wire size
   - Encode as msgpack

2. **decode(data: Uint8Array) → ProtocolMessage**
   - Decode positional arrays back to high-level messages
   - Expand abbreviated keys back to full property names

3. **encodeFrame / decodeFrame**
   - Standard 8-byte frame header wrapper

### Key Design: Property Abbreviation Map

To minimize wire size, use a mapping for property names:

```typescript
const ABBREV = {
  // Node fields
  id: 'i',
  type: 't',
  children: 'ch',
  content: 'c',
  direction: 'd',
  // ... etc
};
```

Reconstruct full names on decode. This is the main advantage over Protocol A
(smaller wire size) and the main disadvantage (harder to debug, fragile schema).

### Testing

Run existing tests with:
```bash
npx tsx src/harness/cli.ts --matrix
```

The key metric to beat Protocol A on: **wire bytes per message**.
The key metric Protocol A beats this on: **debuggability / readability**.

### Files to Create

- `backend.ts` — `OpcodeBackend` class
- `index.ts` — Exports

### Reference

- Design doc section 4.2, "Candidate C: Integer opcode tuples"
- Core types: `../../core/types.ts`
- Protocol A reference: `../protocol-a-tree-patch/backend.ts`
