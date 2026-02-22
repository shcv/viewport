# Go Viewport Library

**Status: Viewer complete, source-side stub**

## Overview

A native Go implementation of the Viewport protocol. Includes both a viewer
(embeddable, direct-call) and a source-side library (stub). All files live in a
single `package viewer` following Go package conventions.

This implements the `EmbeddableViewer` pattern from `../src/core/types.ts` in Go.

## Architecture

```
Socket viewer:     app → serialize → IPC → deserialize → viewer
Embeddable viewer: app → viewer (direct function calls)
```

The viewer supports both modes:
1. **Direct-call** — `SetTree()`, `ApplyPatches()`, `DefineSlot()` (no serialization)
2. **Wire protocol** — `ProcessMessage()` processes decoded protocol messages

## Key Files

- `types.go` — All core types: NodeType, VNode, RenderNode, RenderTree, PatchOp, etc.
- `wire.go` — Wire format: frame header encode/decode, FrameReader streaming parser, CBOR support
- `tree.go` — Tree operations: SetTreeRoot, ApplyPatch, WalkTree, FindByID, CountNodes
- `text_projection.go` — Text projection engine matching TypeScript rules
- `viewer.go` — Main Viewer struct with full embeddable viewer API
- `source.go` — Source-side local state (stub: interface defined, implementation TODO)
- `viewer_test.go` — Comprehensive test suite

## Building and Testing

```bash
cd go
go test ./...            # Run all tests
go test -v ./...         # Verbose output
go test -bench=. ./...   # Run benchmarks
```

## Dependencies

- `github.com/fxamacker/cbor/v2` — CBOR encoding/decoding (RFC 8949)
- Standard library only for everything else

## Wire Format

8-byte binary frame header + CBOR payload:

```
[0:2]  magic   (big-endian uint16, 0x5650 = 'VP')
[2]    version (uint8, 1)
[3]    type    (uint8, MessageType)
[4:8]  length  (little-endian uint32, payload bytes)
```

The `FrameReader` handles streaming with buffering, supporting partial reads.

## Text Projection Rules

Matching the TypeScript implementation:
- `text` → content string
- `box` → children joined by `\n` (column) or `\t` (row)
- `scroll` → children content (+ data rows from schema if present)
- `input` → value or placeholder
- `image`/`canvas` → altText or `[image]`
- `separator` → `────────────────`
- If `textAlt` is set on a node, it overrides the projection

## Thread Safety

The `Viewer` struct is safe for concurrent use — all public methods acquire a `sync.Mutex`.

## Render Targets

- `HeadlessTarget{}` — No visual output (testing, CI)
- `AnsiTarget{FD: 1}` — ANSI terminal output
- `FramebufferTarget{Ptr: addr}` — Raw framebuffer
- `TextureTarget{}` — GPU texture (wgpu surface)
- `HtmlTarget{Container: "id"}` — DOM element

## Usage Example

```go
package main

import viewer "github.com/anthropics/viewport/viewer"

func main() {
    v := viewer.NewViewer(viewer.HeadlessTarget{})
    v.Init(viewer.EnvInfo{
        ViewportVersion: 1,
        DisplayWidth:    800,
        DisplayHeight:   600,
        PixelDensity:    1.0,
        ColorDepth:      24,
    })

    content := "Hello, Viewport!"
    v.SetTree(&viewer.VNode{
        ID:   1,
        Type: viewer.NodeBox,
        Children: []*viewer.VNode{
            {
                ID:    2,
                Type:  viewer.NodeText,
                Props: viewer.NodeProps{Content: &content},
            },
        },
    })

    text := v.GetTextProjection()
    println(text) // "Hello, Viewport!"
}
```

## Extending

- Add new render target types by implementing the `RenderTarget` interface
- The `ProcessMessage` method can be extended for new message types
- The `applyPropsSet` function in tree.go handles property updates — add new properties there
- For CBOR wire protocol integration, use `EncodeFrame`/`DecodeFrame` + `FrameReader`

## What Is Implemented

- All core types matching `src/core/types.ts`
- Binary frame header encode/decode + CBOR support
- FrameReader for streaming frame parsing
- Full render tree operations
- Complete text projection engine
- Viewer struct with full embeddable API
- Metrics collection
- SourceState stub interface

## What Is NOT Implemented (TODOs)

- **SourceState implementation**: Pending/published state, flush, coalescing
- **Layout engine**: Computed layout is always nil
- **Viewer dirty tracking**: Currently processes eagerly

## Reference

- TypeScript types: `../src/core/types.ts`
- TypeScript tree utilities: `../src/core/tree.ts`
- TypeScript text projection: `../src/core/text-projection.ts`
- TypeScript headless viewer: `../src/viewer/headless/viewer.ts`
- TypeScript source state: `../src/source/state.ts`
- TypeScript viewer state: `../src/viewer/state.ts`
- Property key enums: `../src/core/prop-keys.ts`
- EmbeddableViewer interface: `../src/core/types.ts` (EmbeddableViewer)
