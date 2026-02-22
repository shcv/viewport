# Protocol C: Integer Opcode Tuples

**Status: Complete**

## Overview

Each message is a small positional array. Opcode is an integer. Maximally compact
wire format — no named keys, no schema overhead. Encoded as CBOR (RFC 8949).

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

## Key Files

- `backend.ts` — `OpcodeBackend` class implementing `ProtocolBackend`
- `index.ts` — Exports

## Implementation Notes

- Messages are converted to positional arrays `[opcode, ...args]`
- Property names are abbreviated to single/short keys to minimize wire size
- CBOR encoding/decoding uses the `cborg` library
- Full abbreviation map in `ENCODE_ABBREV` / `DECODE_ABBREV` constants
- VNode serialization uses abbreviated keys: `i` (id), `t` (type), `ch` (children), `c` (content), `d` (direction), etc.
- Patch ops also use abbreviated keys: `tg` (target), `s` (set), `ci` (childrenInsert), etc.

### Property Abbreviation Map

```typescript
const ENCODE_ABBREV = {
  id: 'i', type: 't', children: 'ch', content: 'c',
  direction: 'd', justify: 'j', align: 'al', gap: 'g',
  padding: 'p', margin: 'm', border: 'bd', borderRadius: 'br',
  background: 'bg', opacity: 'op', width: 'w', height: 'h',
  flex: 'f', color: 'cl', weight: 'wt', size: 'sz',
  // ... see backend.ts for full map
};
```

## Design Tradeoffs

**Pros:**
- Smallest wire size (~60% of Protocol A for typical messages)
- Simple integer opcodes for fast dispatch
- Positional arrays avoid repeated key strings

**Cons:**
- Hard to debug (abbreviated keys, no field names)
- Fragile — adding new fields requires careful abbreviation management
- Decode requires full reverse mapping

## Testing

```bash
npx tsx src/harness/cli.ts --matrix   # Compare wire sizes across protocols
npm test                               # Run full test suite
```

The key metric to beat Protocol A on: **wire bytes per message**.
Benchmarks confirm Protocol C achieves ~60% of Protocol A's wire size.
