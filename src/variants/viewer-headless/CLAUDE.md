# Headless Viewer

**Status: Reference implementation (complete)**

## Overview

The headless viewer maintains an in-memory render tree, produces text projections,
and collects performance/state metrics. No actual GPU rendering — this is the
primary viewer for testing, CI, and MCP server usage.

This implements the `ViewerBackend` interface (not `EmbeddableViewer`). It processes
protocol messages that have already been decoded from CBOR wire format. For native
embeddable viewer implementations, see `viewer-zig/` and `viewer-go/`.

## Key Features

- Processes all message types (DEFINE, TREE, PATCH, SCHEMA, DATA, INPUT, ENV)
- Maintains indexed render tree for O(1) node lookup
- Produces text projection using `../../core/text-projection.ts`
- Tracks frame times, byte counts, node counts
- Supports input injection for automation
- Memory estimation

## Key Files

- `viewer.ts` — `HeadlessViewer` class implementing `ViewerBackend`
- `index.ts` — Exports

## Testing

Used as the default viewer in the test harness:
```bash
npx tsx src/harness/cli.ts
```

## Extension Points

- Override `renderToAnsi()` for custom text rendering
- The `trackBytes()` method is called by the harness to feed wire size metrics
- For embeddable viewer (direct function calls, no protocol encoding), see the
  `EmbeddableViewer` interface in `../../core/types.ts` and the Zig/Go implementations
