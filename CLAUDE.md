# Viewport Protocol — Multi-Language Library

## Project Overview

This repository contains the design document for the **Viewport Protocol** (a new
application display protocol to replace terminal emulators) and implementations in
multiple languages (TypeScript, Zig, Go).

Each language implementation provides both **source** (app-side) and **viewer** (display-side)
libraries. The source library manages pending/published state with explicit flush control.
The viewer library manages render state with dirty tracking for decoupled rendering.

## Quick Start

```bash
# TypeScript (reference implementation + test harness)
npm install
npm test                                    # Run all tests
npx tsx src/harness/cli.ts                  # Run all apps with default config
npx tsx src/harness/cli.ts --benchmark      # Run with interaction sequences
npx tsx src/harness/cli.ts --matrix         # Run full protocol×viewer matrix
npx tsx src/harness/cli.ts --app counter    # Run specific app

# Zig (primary standalone viewer)
cd zig && zig build test

# Go (embeddable viewer)
cd go && go test ./...
```

## Repository Structure

```
src/                              TypeScript implementation
├── core/                         Shared types, wire format, tree ops, text projection
│   ├── types.ts                  All protocol types (VNode, RenderTree, PatchOp, etc.)
│   ├── wire.ts                   Frame header encode/decode
│   ├── tree.ts                   Render tree operations
│   ├── text-projection.ts        Text projection engine
│   ├── prop-keys.ts              Integer property key enums (canonical encoding)
│   └── transport*.ts             Transport interfaces and registry
├── source/                       Source-side local state library
│   ├── state.ts                  SourceState: pending + published + flush
│   ├── connection.ts             AppConnection backed by SourceState
│   └── flush.ts                  Flush helpers (auto, idle, immediate)
├── viewer/                       Viewer implementations
│   ├── state.ts                  ViewerState: dirty tracking
│   ├── headless/                 Headless viewer (testing, CI)
│   ├── dom/                      DOM viewer (HTML rendering)
│   ├── ansi/                     ANSI terminal viewer
│   └── gpu/                      GPU viewer (wgpu-based)
├── protocol/                     Protocol encoding
│   ├── encoding.ts               Canonical: integer-keyed CBOR opcode tuples
│   └── variants/                 Comparison variants (tree-patch, slot-graph, opcodes)
├── transports/                   Transport implementations (unix, tcp, stdio, websocket)
├── harness/                      Test orchestrator, metrics, quality checks, CLI
├── automation/                   Playwright-style ViewportPage API
├── mcp-server/                   MCP interface for AI agent interaction
├── app-sdk/                      App framework (defineApp, components)
└── test-apps/                    6 classic TUI test applications

zig/                              Zig implementation (primary standalone viewer)
├── src/
│   ├── core/                     Types, wire format, tree ops, text projection
│   ├── source/                   Source-side local state (stub)
│   ├── viewer/                   Embeddable viewer
│   └── main.zig                  Root module
├── build.zig
└── CLAUDE.md

go/                               Go implementation (embeddable viewer)
├── types.go, wire.go, tree.go    Core types and operations
├── text_projection.go            Text projection engine
├── viewer.go                     Embeddable viewer
├── source.go                     Source-side local state (stub)
├── viewer_test.go                Tests
├── go.mod
└── CLAUDE.md

specs/                            Design documents
```

## Local State Architecture

Both source and viewer sides use a local state model that decouples
producers from consumers:

```
Source (app) side:
  app mutations → pending state (coalesced) → flush() → transport sends
                                                          ↓
                                            published state updated

Viewer (display) side:
  transport receives → applyMessage() → tree updated + dirty marks
  renderer           → consumeDirty() → reads tree → renders → clears dirty
```

The two published states (source-side "what I've sent" and viewer-side
"what I've received") converge as messages are delivered.

### Source State (src/source/)

- `SourceState` accumulates app mutations in a pending buffer
- Multiple rapid updates coalesce (last-write-wins per property)
- `flush()` bundles pending ops into protocol messages
- Flush helpers: `autoFlush(intervalMs)`, `flushOnIdle()`, `flushImmediate()`

### Viewer State (src/viewer/)

- `ViewerState` applies messages and tracks dirty nodes/slots/schemas
- `consumeDirty()` returns what changed since last call and clears dirty flags
- Renderers call `consumeDirty()` at their own refresh rate

## Wire Format

All protocol messages use **CBOR** (RFC 8949) as the payload encoding, wrapped in a
24-byte binary frame header:

```
┌─────────┬─────────┬────────┬─────────────┬──────────────┬──────────────┬──────────────────┐
│ magic   │ version │ type   │ length      │ session      │ seq          │ CBOR payload     │
│ 2 bytes │ 1 byte  │ 1 byte │ 4 bytes LE  │ 8 bytes LE   │ 8 bytes LE   │ variable         │
└─────────┴─────────┴────────┴─────────────┴──────────────┴──────────────┴──────────────────┘
```

### Canonical Encoding

The canonical wire encoding uses `[opcode, ...args]` CBOR tuples with integer
property keys (defined in `src/core/prop-keys.ts`). CBOR encodes small integers
(0-23) in a single byte, making this more compact than string keys.

Comparison variants (Protocol A: tree-patch, B: slot-graph, C: opcodes) are
preserved under `src/protocol/variants/` for benchmarking.

## Design Documents

Protocol specification, architecture, and design decisions are in `specs/`:

- **`specs/protocol.md`** — Wire format, message types, tree model, data records, patching
- **`specs/architecture.md`** — System architecture, tiers, remote access, proxy pattern
- **`specs/transport.md`** — VIEWPORT URI, transport interfaces, registry, viewer config
- **`specs/design-decisions.md`** — What's settled, what's open, rationale

The original monolithic design document is preserved as `viewport-design.md`.

## Test Applications

| App | Pattern | Key Protocol Features Exercised |
|-----|---------|--------------------------------|
| counter | Simple interactive | TREE, PATCH(set), INPUT(click, key) |
| file-browser | Scrollable list + data | SCHEMA, DATA, scroll, sorting |
| dashboard | Multi-panel monitor | Complex flexbox, PATCH(multi), canvas |
| table-view | Sortable/filterable table | INPUT(value_change), large TREE, sort |
| form-wizard | Multi-step form | INPUT, conditional rendering, steps |
| chat | Message list + input | PATCH(childrenInsert), scroll append |

## Interfaces

### Key Types (src/core/types.ts)

- `VNode` — Virtual node in the app's tree
- `RenderNode` / `RenderTree` — Materialized tree in the viewer
- `PatchOp` — Incremental tree update operation
- `ProtocolMessage` — Union of all message types
- `ViewerMetrics` — Performance counters
- `EmbeddableViewer` — Direct-call viewer interface

### State Model Types

- `SourceState` — Pending + published state for source side
- `ViewerState` — Render tree + dirty tracking for viewer side
- `DirtySet` — What changed since last consumeDirty()

### Backend Interfaces

- **`ProtocolBackend`** — Encode/decode protocol messages to/from wire bytes
- **`ViewerBackend`** — Process messages, maintain tree, produce text projection
- **`AppConnection`** — Standard API that apps code against

## Instrumentation

The harness measures:

- **Wire efficiency**: bytes per message, total wire bytes, by message type
- **Parse performance**: encode time, decode time per message
- **Viewer performance**: frame processing time (avg, p50, p95, p99, peak)
- **State metrics**: node count, tree depth, slot count, data row count
- **Memory estimation**: rough heap usage
- **Quality checks**: tree integrity, ID uniqueness, text projection, accessibility

## Automation API

Playwright-style `ViewportPage` for programmatic testing:

```typescript
import { createPage } from './src/automation/index.js';

const page = createPage(counterApp, protocol, viewer);
page.expectText('Count: 0');
await page.click(page.getByText('+'));
page.expectText('Count: 1');
page.close();
```

## MCP Server

Start the MCP server for AI agent interaction:

```bash
npx tsx src/mcp-server/index.ts
```

Available tools: `viewport_list_apps`, `viewport_load_app`, `viewport_get_tree`,
`viewport_get_text`, `viewport_click`, `viewport_type`, `viewport_press`,
`viewport_find`, `viewport_screenshot`, `viewport_metrics`, `viewport_quality_check`,
`viewport_resize`, `viewport_close`.

## Developing

### Adding a new viewer (TypeScript)

1. Create a directory under `src/viewer/`
2. Implement `ViewerBackend` interface
3. Register in `src/harness/cli.ts`
4. Run `npm test`

### Adding a native implementation

Each language directory (`zig/`, `go/`) has its own `CLAUDE.md` with
language-specific instructions. All implementations share:

- Same wire format (24-byte header + CBOR payload)
- Same tree operations (set tree, apply patches, walk, find)
- Same text projection rules
- Same local state model (source + viewer)
- Own build systems and test suites

Build and test:
```bash
# Zig
cd zig && zig build test

# Go
cd go && go test ./...
```

## Design Documents

See `specs/` for organized protocol and architecture specifications.
The original monolithic draft is preserved as `viewport-design.md`.

**Important:** All confirmed design decisions must be recorded in the appropriate
spec file under `specs/`. Each decision should include the choice made, the
rationale, and any rejected alternatives. This ensures the specs remain the
authoritative source of truth for the project's design.

- Protocol/wire format decisions → `specs/protocol.md`
- Architecture/system structure decisions → `specs/architecture.md`
- Transport/connection/config decisions → `specs/transport.md`
- Cross-cutting or general decisions → `specs/design-decisions.md`
