# ANSI Terminal Viewer

**Status: Complete**

## Overview

A viewer that renders the Viewport render tree to ANSI terminal escape sequences.
This is the fallback/compatibility viewer for displaying Viewport apps in traditional
terminal emulators.

## Architecture

The viewer uses a cell-based terminal buffer (`TerminalBuffer`) that represents the
terminal as a 2D grid of characters with ANSI style attributes. The render tree is
walked and each node is painted into the buffer at its allocated rectangle.

### Rendering Pipeline

1. **Message processing** — Same as headless viewer (tree/patch/slot/data handling)
2. **Layout** — Simple flexbox-like allocation (row = split width, column = stack height)
3. **Paint** — Each node type maps to terminal drawing operations
4. **Output** — Buffer serialized to ANSI escape sequences

### Node Type Mapping

| Viewport Node | Terminal Rendering |
|--------------|-------------------|
| `box` | Rectangle with optional Unicode box-drawing border |
| `text` | Styled text with ANSI attributes (bold, italic, color) |
| `scroll` | Clipped region (children beyond height are hidden) |
| `input` | `> value` or `> placeholder` (dimmed) |
| `separator` | Horizontal line using `─` character |
| `canvas` | Alt text in dim style |
| `image` | Alt text in dim style |

### Color Support

Uses 24-bit true color (SGR 38;2;r;g;b and 48;2;r;g;b). Supports:
- Hex colors (#RGB, #RRGGBB)
- Named colors (red, green, blue, etc.)

## Files

- `viewer.ts` — `AnsiViewer` class implementing `ViewerBackend`
- `index.ts` — Exports
