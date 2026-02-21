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
    ├── protocol-b-slot-graph/ Protocol B: Unified Slot Graph
    ├── protocol-c-opcodes/    Protocol C: Integer Opcode Tuples
    ├── viewer-headless/       Headless viewer (reference, complete)
    └── viewer-dom/            DOM-based viewer (renders to HTML)
```

## Design Space Enumeration

### Independent Design Axes

The Viewport protocol has several design dimensions that can be varied independently:

#### 1. Protocol Message Architecture (3 candidates)

| Candidate | Description | Key Tradeoff |
|-----------|-------------|--------------|
| **A: Tree + Patch** | Separate tree structure and slot table. Named fields in msgpack. | Explicit, debuggable, slightly more wire overhead |
| **B: Slot Graph** | Everything is slots. SET/DEL only. Viewer walks references from root. | Uniform, reactive, requires dependency tracking |
| **C: Opcode Tuples** | Positional arrays with abbreviated keys. Maximally compact. | Smallest wire size, hardest to debug |

#### 2. Data Record Format (3 candidates)

| Format | Wire Size | Flexibility | Streaming |
|--------|-----------|-------------|-----------|
| Schema + positional arrays | Compact | Requires pre-defined schema | Good |
| Dict records | Verbose (repeated keys) | Self-describing | Good |
| Columnar batches (Arrow-style) | Very compact for bulk | Rigid | Poor |

#### 3. Viewer Implementation (3+ types)

| Viewer | Use Case | Status |
|--------|----------|--------|
| **Headless** | Testing, CI, MCP server | Complete |
| **DOM (HTML)** | Visual testing, screenshot comparison | Stub |
| **ANSI terminal** | Fallback/compatibility | Not started |
| **Native GPU** | Production use (wgpu + Taffy + HarfBuzz) | Future |

#### 4. Layout Engine

| Engine | Language | Features |
|--------|----------|----------|
| Taffy | Rust (via binding) | Flexbox + Grid, ~5k lines |
| Yoga | C++ (via binding) | Flexbox only |
| Pure TS | TypeScript | For testing; flexbox subset |

### Test Matrix

The harness runs: **Apps × Protocols × Viewers**

Current matrix:
- 6 apps × 3 protocols × 1 viewer = 18 combinations
- With viewer-dom: 6 × 3 × 2 = 36 combinations

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

- **`ProtocolBackend`** — Encode/decode protocol messages to/from wire bytes
- **`ViewerBackend`** — Process messages, maintain tree, produce text projection + metrics
- **`AppFactory`** / **`AppConnection`** — Standard API apps code against
- **`ViewportPage`** — Playwright-style automation (locators, actions, assertions)
- **`MCP Tools`** — AI agent tools for loading apps, inspecting state, performing actions

### Key Types (src/core/types.ts)

- `VNode` — Virtual node in the app's tree
- `RenderNode` / `RenderTree` — Materialized tree in the viewer
- `PatchOp` — Incremental tree update operation
- `ProtocolMessage` — Union of all message types
- `ViewerMetrics` — Performance counters

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
2. Implement `ProtocolBackend` or `ViewerBackend` interface
3. Register in the harness CLI (`src/harness/cli.ts`)
4. Run `npm test` to validate against the existing test suite

### Parallel Development

Variant directories are designed for independent parallel development:
- Each has its own `CLAUDE.md` with complete implementation instructions
- All variants implement the same shared interfaces
- The test harness automatically compares results across variants
- Quality checks validate equivalence (same text projection, same tree structure)

## Design Document

See `viewport-design.md` for the full protocol design specification.
