# Zig Viewport Library

**Status: Viewer complete, source-side stub**

## Overview

A native Zig implementation of the Viewport protocol. Includes both a viewer
(embeddable, direct-call) and a source-side library (stub). The Zig viewer is
the primary standalone viewer target.

## Directory Structure

```
src/
  core/                     Shared types, wire format, tree ops, text projection
    types.zig               Core protocol types (VNode, RenderNode, RenderTree, etc.)
    wire.zig                Wire format: frame header encode/decode, FrameReader
    tree.zig                Render tree operations (create, set root, patch, query)
    text_projection.zig     Text projection engine (per-node-type rules)
  source/                   Source-side local state (stub)
    source.zig              SourceState: pending + published + flush
  viewer/                   Viewer implementation
    viewer.zig              Main Viewer struct (EmbeddableViewer implementation)
    example.zig             Smoke test / usage example
  main.zig                  Root module, re-exports all public symbols
```

## Building

```bash
zig build          # Build the library
zig build test     # Run unit tests
zig build run      # Run the example
```

Requires Zig 0.13+.

## Local State Architecture

The source-side `SourceState` (stub) mirrors the TypeScript implementation:
- App mutations go to pending state (coalesced)
- `flush()` bundles pending ops into protocol messages
- Published state tracks what has been sent to the viewer

The viewer already implements the viewer-side state model:
- `processMessage()` updates the render tree
- Dirty tracking to be added (currently processes eagerly)

## What Is Implemented

- All core types matching `src/core/types.ts`
- Binary frame header encode/decode
- FrameReader for streaming frame parsing
- Full render tree operations
- Complete text projection engine
- Viewer struct with embeddable API
- Metrics collection
- SourceState stub interface

## What Is NOT Implemented (TODOs)

- **CBOR decode/encode**: Wire payload parsing (not needed for embeddable mode)
- **Layout engine**: Computed layout is always null
- **SourceState implementation**: Pending/published state, flush, coalescing
- **Viewer dirty tracking**: Currently processes eagerly
- **Rendering backends**: ANSI, GPU, framebuffer are stubs

## Reference

- TypeScript core types: `../src/core/types.ts`
- TypeScript source state: `../src/source/state.ts`
- TypeScript viewer state: `../src/viewer/state.ts`
- Property key enums: `../src/core/prop-keys.ts`
