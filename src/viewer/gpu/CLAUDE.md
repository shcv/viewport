# Native GPU Viewer

**Status: Foundation complete, native bridge pending**

## Overview

A viewer that renders the Viewport render tree using GPU-accelerated rendering.
In production, this uses wgpu + Taffy + HarfBuzz for high-performance rendering
to a native window or embedded surface.

## Architecture

The GPU viewer has two layers:

### TypeScript Layer (implemented)

- `viewer.ts` — `GpuViewer` class implementing `ViewerBackend`
  - Processes protocol messages (same as other viewers)
  - Computes layout using the pure-TS flexbox layout engine
  - Generates a GPU command list (`GpuCommand[]`) from the laid-out tree
  - In software fallback mode, renders the command list as descriptive text
  - When a `NativeGpuBridge` is provided, forwards commands to the native renderer

- `types.ts` — Type definitions for the GPU rendering pipeline
  - `GpuConfig` — Configuration (API, MSAA, fonts, debug overlays)
  - `GpuRenderPipeline` — Render pipeline stages and shader configuration
  - `GpuTextAtlas` — Text atlas for glyph rendering (HarfBuzz)
  - `GpuCommand` — Render command union (rect, text, clip, image)
  - `NativeGpuBridge` — FFI interface to the native renderer

### Native Layer (future work)

The native renderer would be implemented in Rust (or Zig) and would:

1. Create a wgpu device and surface
2. Compile WGSL shaders for rect/text/image rendering
3. Maintain a glyph atlas using HarfBuzz for text shaping
4. Accept `GpuCommand` batches from the TypeScript layer via FFI
5. Execute the command list as GPU draw calls
6. Present frames at the target frame rate
7. Support readback for screenshot testing

### Render Pipeline

```
App → Protocol → GpuViewer
                    ├── Layout (pure-TS flexbox)
                    ├── Command Generation (walk tree, emit rects/text/clips)
                    └── NativeGpuBridge.submit(commands)
                            ├── Rect shader (rounded corners, borders, shadows)
                            ├── Text shader (atlas lookup, subpixel rendering)
                            └── Present to surface
```

## GPU Command Types

| Command | Description |
|---------|-------------|
| `rect` | Filled rectangle with optional border, shadow, corner radii |
| `text` | Positioned text string with color and size |
| `clip` | Push clip rectangle (for scroll regions) |
| `unclip` | Pop clip rectangle |
| `image` | Textured rectangle from loaded image data |

## Files

- `viewer.ts` — `GpuViewer` class
- `types.ts` — GPU type definitions
- `index.ts` — Exports
