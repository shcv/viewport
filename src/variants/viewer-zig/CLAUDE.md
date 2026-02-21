# Zig Embeddable Viewer

**Status: Core implementation complete, CBOR decode stub**

## Overview

A standalone Zig library implementing the Viewport protocol's `EmbeddableViewer`
pattern. The viewer maintains an in-memory render tree, produces text projections,
and collects performance/state metrics. Currently targets headless mode for testing.

Unlike socket-based viewers that receive serialized protocol messages over IPC, the
embeddable viewer links directly into the application process and accepts VNode trees
and PatchOp arrays via direct function calls -- no serialization overhead.

## Architecture

```
src/
  main.zig             Root module, re-exports all public symbols
  types.zig            Core protocol types (VNode, RenderNode, RenderTree, etc.)
  wire.zig             Wire format: frame header encode/decode, FrameReader
  tree.zig             Render tree operations (create, set root, patch, query)
  text_projection.zig  Text projection engine (per-node-type rules)
  viewer.zig           Main Viewer struct (EmbeddableViewer implementation)
  example.zig          Smoke test / usage example
```

## Building

```bash
# Build the library
zig build

# Run unit tests
zig build test

# Run the example
zig build run
```

Requires Zig 0.13+.

## Usage

```zig
const viewport = @import("viewport");

var viewer = viewport.Viewer.init(allocator);
defer viewer.deinit();

// Set tree directly (no serialization)
try viewer.setTree(.{
    .id = 1,
    .node_type = .box,
    .props = .{ .direction = .column },
    .children = &.{
        .{ .id = 2, .node_type = .text, .props = .{ .content = "Hello" }, .children = &.{} },
    },
});

// Get text projection
const text = try viewer.getTextProjection();
defer allocator.free(text);

// Apply patches
try viewer.applyPatches(&.{
    .{ .target = 2, .set = .{ .content = "Updated" } },
});

// Check metrics
const m = viewer.getMetrics();
```

## Key Design Decisions

- **Allocator pattern**: All structs accept `std.mem.Allocator` for flexible memory
  management. No global allocator.
- **Owned memory**: Text projections and screenshots return owned slices that the
  caller must free.
- **No CBOR yet**: The wire format module parses binary frame headers but CBOR payload
  decoding is stubbed. The embeddable viewer bypasses wire encoding entirely, so this
  is not a blocker for testing. For production wire protocol support, integrate a
  CBOR library.
- **comptime prop merging**: `tree.zig` uses `inline for` over struct fields with
  `comptime` to merge NodeProps without manually listing every field.
- **Headless rendering**: In headless mode, `render()` is a no-op that just tracks
  dirty state. The `screenshot()` method produces an ANSI text representation.

## Text Projection Rules

Matching the TypeScript reference (`src/core/text-projection.ts`):

| Node type   | Projection rule                                               |
|-------------|---------------------------------------------------------------|
| text        | `props.content`                                               |
| box         | Children joined by `\n` (column) or `\t` (row), skip empty   |
| scroll      | Children content, plus data rows if template slot is set      |
| input       | `props.value` or `props.placeholder`                          |
| image       | `props.alt_text` or `[image]`                                 |
| canvas      | `props.alt_text` or `[image]`                                 |
| separator   | `────────────────` (16 horizontal box-drawing characters)     |

A node's `text_alt` property overrides the default projection.

## What Is Implemented

- All core types matching `src/core/types.ts`
- Binary frame header encode/decode (8-byte VP header)
- FrameReader for streaming frame parsing
- Full render tree operations: create, set root, apply patches (set, insert, remove,
  move, replace), count nodes, tree depth, find by ID, find by text
- Complete text projection engine with all node types
- Viewer struct with embeddable API and protocol message processing
- Metrics collection (frame times, node counts, memory estimates)
- Input event injection and handler registration
- Comprehensive unit tests

## What Is NOT Implemented (TODOs)

- **CBOR decode/encode**: Wire payload parsing. Not needed for embeddable mode.
- **Layout engine**: Computed layout is always null. Integrate Taffy (via C API)
  or implement a flexbox subset in Zig.
- **ANSI terminal rendering**: `RenderTarget.ansi` is recognized but not rendered.
- **GPU/framebuffer rendering**: `RenderTarget.texture` and `.framebuffer` are stubs.
- **HTML rendering**: `RenderTarget.html` is a stub.
- **Data format helpers**: `relative_time` formatting for data rows.
- **TypeScript harness integration**: FFI bridge for running this viewer in the
  test harness alongside the TypeScript implementations.

## Extending

### Adding CBOR support

Implement `decodeCborPayload` and `encodeCborPayload` in `wire.zig`. The frame
header parsing is already done; you just need to decode the CBOR map into the
appropriate `ProtocolMessage` variant based on the `MessageType` from the header.

### Adding a layout engine

Set `computed_layout` on each `RenderNode` after tree modifications. The Taffy
layout engine (Rust) can be called via its C API, or implement a simplified
flexbox layout in pure Zig.

### Adding terminal rendering

Implement the `RenderTarget.ansi` case in `Viewer.render()`. Walk the tree,
compute text positions from layout, and write ANSI escape sequences to the fd.

## Reference

- Core types: `../../core/types.ts`
- Tree utilities: `../../core/tree.ts`
- Text projection: `../../core/text-projection.ts`
- Headless viewer reference: `../viewer-headless/viewer.ts`
- Embeddable viewer interface: `../../core/types.ts` (`EmbeddableViewer`)
