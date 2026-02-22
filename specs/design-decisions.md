# Viewport Design Decisions

**Status:** Living document
**Date:** February 2026

This document records design decisions, their rationale, and current status.

---

## Settled Decisions

These decisions are considered stable.

### Wire format: CBOR with 8-byte binary frame header

**Decision:** CBOR (RFC 8949) as the payload encoding, with a fixed 8-byte binary
frame header for fast dispatch.

**Rationale:** CBOR is compact, self-describing, has libraries in every language, and
handles integer-keyed maps naturally (useful for compact wire representation). The frame
header enables dispatch without deserializing the payload. Zero-copy formats (Cap'n Proto,
FlatBuffers) were rejected because data crosses trust boundaries and messages are small
enough that verification cost dominates anyway.

**Note:** The original design document referenced msgpack. CBOR was chosen during
implementation for its RFC standardization and better integer-key support. All
implementations use CBOR.

### Protocol structure: Tree + Patch with definition table

**Decision:** Separate tree structure and slot table. Explicit patch operations.

**Rationale:** Clear mental model (tree is a tree, slots are parameters). Explicit patches
are debuggable and replayable. Three protocol encodings were prototyped and evaluated:

| Encoding | Wire size | Debuggability | Verdict |
|----------|-----------|---------------|---------|
| **A: Tree + Patch (named keys)** | Baseline | Excellent | Reference implementation |
| **B: Unified Slot Graph** | Similar to A | Good | Equivalent correctness, different tradeoffs |
| **C: Integer Opcode Tuples** | ~60% of A | Poor | Most compact, hardest to debug |

All three are implemented and tested in the harness. The tree + patch model is the
canonical structure; the encoding (named keys vs integer keys vs opcodes) is an
optimization dimension.

### Connection model: Unix domain socket

**Rationale:** Multiple concurrent connections, dynamic child process connections,
reconnection on viewer restart, discoverability via env var. File descriptors were
rejected (can't handle N panes without pre-allocating fd pairs).

### Styling: Flat, per-node

**Decision:** No cascade, no inheritance, no selectors, no specificity. Every node
carries its own style or references a slot.

**Rationale:** Eliminates the entire CSS resolution engine. ~40-50 properties vs CSS's
500+. The cost is verbosity for large trees, which is mitigated by slot references.

### Layout: Flexbox + Grid only

**Decision:** No float, no position: absolute/relative/fixed/sticky as separate concepts.

**Rationale:** Flexbox + grid handle essentially every real UI layout. Implemented via
Taffy (~5k lines of Rust). Adding more layout modes increases viewer complexity for
marginal benefit.

### Text projection: Built into the protocol

**Decision:** Every node type has well-defined text projection rules. The viewer
maintains text projection as a live parallel representation.

**Rationale:** Serves three purposes (copy-paste, accessibility, virtual file) without
bolting on accessibility after the fact. Since it's protocol-level, it's guaranteed to
work for every application.

### Tiered adoption: Tier 0 / Tier 1 / Tier 2

**Decision:** Legacy PTY compatibility (Tier 0), structured stdout (Tier 1), full
socket (Tier 2).

**Rationale:** Critical for adoption. Legacy programs work unchanged. Programs can
opt in gradually.

### Viewer identity: No scripting runtime

**Decision:** The viewer never executes application code. No JavaScript, no sandbox,
no scripting runtime.

**Rationale:** This is the fundamental difference from browsers. The viewer is a
rendering server. Latency compensation that requires app-specific logic is handled by
the proxy pattern at the application layer (see below).

### Canvas: WebGPU with vector 2D fallback

**Decision:** WebGPU (WGSL shaders) for full GPU control, vector 2D command set for
simple cases, remote video stream as fallback.

**Rationale:** WebGPU is the modern portable GPU API. WGSL shaders are constrained
enough for the trust model. Vector 2D covers charts and diagrams without requiring
GPU shaders.

### Remote transport: Mosh-style state sync

**Decision:** State synchronization on the render tree, not byte stream replay.

**Rationale:** Mosh's insight applied to a structured tree. Tree diffs compress better
than character grid diffs. Reconnection gives current state, not replay.

---

## Resolved Decisions (from design evaluation)

These were open questions that have been resolved through prototyping and discussion.

### Data record format: Support both schema+arrays and dicts

**Decision:** The protocol supports two interchangeable record shapes:
- Schema + positional arrays for tabular streaming data
- Dict records for ad-hoc/heterogeneous data

The viewer treats both identically after unpacking. The app chooses based on data shape.

**Rationale:** Schema+arrays is compact (column names appear once). Dicts are
self-describing. Both are natural in different contexts. Columnar batches (Arrow-style)
were dropped — overkill for terminal-scale data and poor for streaming.

### Data-view binding: Display hints on schema columns, not row templates

**Decision:** Display hints (format, unit, style) live on `SchemaColumn` definitions.
The separate `RowTemplateSlot` concept (a VNode layout paired with a schema) has been
removed.

**Previous design:** A `row_template` slot paired a schema reference with a VNode layout
tree that described how each data row should be rendered. In practice, the layout VNode
was never used by any viewer — text projection ignored it and just rendered rows as
TSV using schema column info.

**New design:** Schema columns carry `format` and `unit` hints directly. Scroll regions
reference a schema slot via a `schema` prop (instead of a `template` prop). The viewer
uses schema column definitions for formatting in text projection.

**Rationale:** The row template was dead code — no viewer instantiated the template
layout per row. The display hints that matter (human_bytes, relative_time, etc.) were
already on the schema columns. Collapsing the two concepts removes a layer of
indirection without losing functionality.

### Latency compensation: Application-layer proxy, not protocol/viewer concern

**Decision:** Latency compensation beyond what the viewer handles natively (text editing,
scrolling, hover) is handled by an application-layer proxy pattern.

**What the viewer handles natively (all implementations):**
- Text input: edited locally, value_change sent to app
- Scrolling: scrolled locally, pre-fetch from app
- Hover states: entirely local

**What the proxy handles (app-specific, optional):**
- Filter-as-you-type: proxy filters cached data locally
- Optimistic state changes: proxy predicts tree updates
- Validation: proxy checks constraints locally

**Rejected alternatives:**
- **Declarative bindings in the viewer** (CSS-like filter/toggle/conditional expressions):
  Declarative approaches are inherently limited — almost by definition, you're selecting
  from predefined options instead of something constructive and composable. Filtering
  would be hard to model well. Binding expressions start looking like scripting quickly.
- **Scripting in the viewer:** The browser's trajectory is the cautionary tale. JavaScript
  started as `onclick="validate()"` and became a full application runtime. You need
  sandboxing, process isolation, memory limits — the exact complexity the design avoids.
  Also forces every viewer implementation to embed the same scripting runtime.

**Trust model:** How the proxy reaches the user depends on trust context:
- SSH-like (trusted): transport fetches proxy offered by app
- IDE-like (curated): user installs proxy as extension
- Browser-like (untrusted): explicit approval required

**Key insight:** The "browser" that manages trust and proxy delivery is itself an app
built using the Viewport protocol, not a feature of the viewer.

---

## Open Questions

### Interactive primitives

Which interactive behaviors should be viewer-built-ins vs app-level?

Current built-ins: clickable, focusable, input (text editing).

Open questions:
- Dropdown/select behavior: enough demand for a built-in?
- Drag-and-drop: probably not for v1.
- Tooltips/popovers: viewer-rendered or app-rendered?

### Layout engine selection

Current candidates: Taffy (Rust, flexbox + grid), Yoga (C++, flexbox only),
Pure TypeScript (for testing).

Taffy is the leading candidate for the production viewer. The test harness uses a
pure TypeScript subset.

---

## Comparison to Existing Systems

| System | Relationship |
|--------|-------------|
| **VT100/ANSI** | Tier 0 compatibility target. ANSI shim translates legacy programs. |
| **Nushell** | Philosophical predecessor for structured data pipelines. |
| **X11** | Remote rendering protocol, but primitives too low-level and too high-level. |
| **Wayland** | Compositor protocol, not application protocol. Viewport sits above or replaces. |
| **Plan 9 rio** | Closest ancestor: window manager + terminal, shared protocol. Viewport is rio with modern layout. |
| **Chromium** | Similar expressiveness target, 1/100th implementation size. No JS, no adversarial trust. |
| **Electron** | The problem Viewport solves. Ships a whole browser for web layout. |
| **mosh** | Key insight (state sync, local prediction) applied systematically to a richer protocol. |
