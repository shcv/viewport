# Go Embeddable Viewer

**Status: Complete**

## Overview

A native Go implementation of the Viewport protocol embeddable viewer. This viewer
can be linked directly into Go applications — no IPC, no serialization. The app
passes VNodes directly and the viewer maintains the render tree, computes text
projection, and collects metrics.

This implements the `EmbeddableViewer` pattern from `../../core/types.ts` in Go.

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
- `viewer_test.go` — Comprehensive test suite

## Building and Testing

```bash
cd src/variants/viewer-go
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

## Reference

- TypeScript types: `../../core/types.ts`
- TypeScript tree utilities: `../../core/tree.ts`
- TypeScript text projection: `../../core/text-projection.ts`
- TypeScript headless viewer: `../viewer-headless/viewer.ts`
- EmbeddableViewer interface: `../../core/types.ts` (EmbeddableViewer)
