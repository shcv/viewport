# Viewport Protocol — TUI Testing Harness

## Project Overview

This repository contains the design document for the **Viewport Protocol** (a new
application display protocol to replace terminal emulators) and a **test harness** for
experimentally evaluating the design space.

The test harness runs classic TUI applications against multiple protocol and viewer
implementations, collecting performance metrics, wire efficiency data, quality checks,
and enabling programmatic interaction.

## Quick Start

```bash
npm install
npm test                                    # Run all tests
npx tsx src/harness/cli.ts                  # Run all apps with default config
npx tsx src/harness/cli.ts --benchmark      # Run with interaction sequences
npx tsx src/harness/cli.ts --matrix         # Run full protocol×viewer matrix
npx tsx src/harness/cli.ts --app counter    # Run specific app
npx tsx src/harness/cli.ts --json           # JSON output
```

## Architecture

```
src/
├── core/                      Shared types, wire format, tree utilities, text projection
├── app-sdk/                   Standard API that test apps code against
├── test-apps/                 6 classic TUI test applications
├── harness/                   Test orchestrator, metrics, quality checks, CLI
├── automation/                Playwright-style ViewportPage API
├── mcp-server/                MCP interface for AI agent interaction
└── variants/                  Swappable implementations
    ├── protocol-a-tree-patch/ Protocol A: Tree + Patch (reference, complete)
    ├── protocol-b-slot-graph/ Protocol B: Unified Slot Graph (complete)
    ├── protocol-c-opcodes/    Protocol C: Integer Opcode Tuples (complete)
    ├── viewer-headless/       Headless viewer (reference, complete)
    ├── viewer-dom/            DOM-based viewer (renders to HTML)
    ├── viewer-zig/            Zig embeddable viewer (native, direct-call)
    └── viewer-go/             Go embeddable viewer (native, direct-call)
```

## Wire Format

All protocol messages use **CBOR** (RFC 8949) as the payload encoding, wrapped in an
8-byte binary frame header:

```
┌─────────┬─────────┬────────┬─────────────┬──────────────────┐
│ magic   │ version │ type   │ length      │ CBOR payload     │
│ 2 bytes │ 1 byte  │ 1 byte │ 4 bytes LE  │ variable         │
└─────────┴─────────┴────────┴─────────────┴──────────────────┘
```

CBOR is used for compatibility with other protocol layers in the stack. The `cborg`
library handles CBOR encoding/decoding in TypeScript; native implementations use
language-appropriate CBOR libraries.

## Design Documents

Protocol specification, architecture, and design decisions are in `specs/`:

- **`specs/protocol.md`** — Wire format, message types, tree model, data records, patching
- **`specs/architecture.md`** — System architecture, tiers, remote access, proxy pattern
- **`specs/design-decisions.md`** — What's settled, what's open, rationale

The original monolithic design document is preserved as `viewport-design.md`.

### Test Matrix

The harness runs: **Apps × Protocols × Viewers**

Current matrix:
- 6 apps × 3 protocols × 4 viewers = 72 combinations (TypeScript)

Native viewers (Zig, Go) are tested independently via their own build/test systems.

### Data Records

The protocol supports two interchangeable record shapes:
- **Schema + positional arrays** — compact, for tabular streaming data
- **Dict records** — self-describing, for ad-hoc data

Display hints (`format`, `unit`) live on `SchemaColumn` definitions. Scroll regions
reference a schema slot via a `schema` prop to bind data for text projection.

## Embeddable Viewer Architecture

The protocol supports two viewer connection modes:

```
Socket viewer:     app → serialize → IPC → deserialize → viewer
Embeddable viewer: app → viewer (direct function calls, no serialization)
```

The `EmbeddableViewer` interface (defined in `src/core/types.ts`) extends `ViewerBackend`
with direct-call methods that bypass protocol encoding:

- `setTree(root)` — Set root tree directly (no serialization)
- `applyPatches(ops)` — Apply patches directly
- `defineSlot(slot, value)` — Define a slot directly
- `getLayout(nodeId)` — Query computed layout rectangle
- `render()` — Render to target output, returns whether anything changed

Render targets:
- `ansi` — ANSI terminal output (fd-based)
- `framebuffer` — Raw framebuffer pointer
- `texture` — GPU texture (wgpu surface)
- `headless` — No output (testing)
- `html` — DOM element (browser)

The Zig and Go viewers implement this embeddable pattern natively.

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

### Shared Across All Implementations

- **`ProtocolBackend`** — Encode/decode protocol messages to/from wire bytes (CBOR)
- **`ViewerBackend`** — Process messages, maintain tree, produce text projection + metrics
- **`EmbeddableViewer`** — Extended viewer for direct function calls (no IPC)
- **`AppFactory`** / **`AppConnection`** — Standard API apps code against
- **`ViewportPage`** — Playwright-style automation (locators, actions, assertions)
- **`MCP Tools`** — AI agent tools for loading apps, inspecting state, performing actions

### Key Types (src/core/types.ts)

- `VNode` — Virtual node in the app's tree
- `RenderNode` / `RenderTree` — Materialized tree in the viewer
- `PatchOp` — Incremental tree update operation
- `ProtocolMessage` — Union of all message types
- `ViewerMetrics` — Performance counters
- `EmbeddableViewer` — Direct-call viewer interface
- `RenderTarget` — Where the viewer renders to

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

## Developing Variants

Each variant directory under `src/variants/` has a `CLAUDE.md` with specific
implementation instructions. To add a new variant:

1. Create a directory under `src/variants/`
2. Implement `ProtocolBackend`, `ViewerBackend`, or `EmbeddableViewer` interface
3. For TypeScript variants: register in the harness CLI (`src/harness/cli.ts`)
4. For native variants (Zig/Go): include own build system and tests
5. Run `npm test` to validate TypeScript variants against the test suite

### Native Viewers (Zig, Go)

Native viewer variants implement the `EmbeddableViewer` pattern in their respective
languages. They include:

- Same wire format (8-byte header + CBOR payload)
- Same tree operations (set tree, apply patches, walk, find)
- Same text projection rules
- Own build systems (`build.zig`, `go.mod`)
- Own test suites
- CLAUDE.md with language-specific implementation instructions

Build and test:
```bash
# Zig
cd src/variants/viewer-zig && zig build test

# Go
cd src/variants/viewer-go && go test ./...
```

### Parallel Development

Variant directories are designed for independent parallel development:
- Each has its own `CLAUDE.md` with complete implementation instructions
- All variants implement the same shared interfaces
- The test harness automatically compares results across TypeScript variants
- Quality checks validate equivalence (same text projection, same tree structure)
- Native variants can be cross-validated by comparing text projection output

## Design Documents

See `specs/` for organized protocol and architecture specifications.
The original monolithic draft is preserved as `viewport-design.md`.
