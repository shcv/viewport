# Viewport Design Review: Gaps and Proposed Experiments

**Date:** February 2026
**Status:** Review document

---

## 1. Summary of What's Built

### 1.1 Core Protocol (Solid)

The wire format, message types, and encoding are fully implemented and tested:

- **24-byte frame header** with magic, version, type, length, session ID, seq
- **CBOR payload encoding** with integer property keys (canonical encoding)
- **All 10 message types** implemented: DEFINE, TREE, PATCH, DATA, INPUT, ENV, REGION, AUDIO, CANVAS, SCHEMA
- **Session framing**: 48-bit epoch + 16-bit random session IDs, per-node/per-slot version tracking with staleness discard
- **Three comparison variants** (A: Tree+Patch, B: Slot Graph, C: Opcodes) plus the canonical encoding — all passing 207 tests

### 1.2 Measured Wire Efficiency

The benchmark harness produces concrete numbers:

| Scenario | A: Tree+Patch | B: Slot Graph | C: Opcodes | C/A Ratio |
|----------|--------------|---------------|------------|-----------|
| Small tree (10 nodes) | 513 B | 785 B | 301 B | 0.59 |
| Medium tree (100 nodes) | 5,212 B | 7,568 B | 3,089 B | 0.59 |
| Large tree (500 nodes) | 25,977 B | 38,035 B | 16,158 B | 0.62 |
| Single patch | 37 B | 51 B | 23 B | 0.62 |
| Batch patch (100 ops) | 2,673 B | 4,592 B | 1,570 B | 0.59 |
| DEFINE slot | 51 B | 59 B | 31 B | 0.61 |
| DATA record | 34 B | 65 B | 24 B | 0.71 |

All three variants and canonical encoding produce equivalent trees and text projections across all 6 test apps (verified in cross-variant integration tests).

### 1.3 Implementation Coverage

**Fully implemented and tested:**
- Core types, wire format encode/decode, tree operations (set/patch/walk/find)
- Text projection engine (all node types, schema-aware data formatting)
- Canonical encoding with integer property keys
- Source state (pending/published, coalescing, flush)
- Viewer state (dirty tracking, consumeDirty)
- AppConnection backed by SourceState
- Flush helpers (auto, idle, immediate)
- 4 viewer backends (headless, DOM, ANSI, GPU)
- 6 test apps (counter, file-browser, dashboard, table-view, form-wizard, chat)
- Transport layer: in-process (working), net-socket/stdio/fd/websocket (stubs with interfaces)
- ViewportPage automation API (Playwright-style)
- MCP server (all 16 tools)
- App SDK (defineApp, component helpers)
- Layout engine (pure-TS for testing)

**Native implementations:**
- **Zig**: Wire format, types, tree ops, text projection, embeddable viewer — all working with tests
- **Go**: Wire format, types, tree ops, text projection, embeddable viewer — all working with tests

---

## 2. Protocol Variants: Tree+Patch vs Opcodes vs Canonical

### 2.1 The Three Encodings Explained

All three variants encode the **same conceptual model** — a tree of nodes, a definition table of slots, and patch operations. They differ in *how* that model is serialized to bytes.

**Protocol A: Tree+Patch (named string keys)**

The human-readable reference. CBOR maps with string keys like `"target"`, `"children"`, `"content"`:

```
TREE: {root: {id: 1, type: "box", direction: "column", children: [{id: 2, type: "text", content: "hello"}]}}
PATCH: {ops: [{target: 2, set: {content: "goodbye"}}]}
```

- Baseline wire size (100%)
- Excellent debuggability — you can read the CBOR with any inspector
- The mental model: tree is a tree, patches target nodes by ID, slots hold parameters

**Protocol B: Unified Slot Graph (SET/DEL only)**

Everything flattened to slot writes. Nodes become slots (nodeId + 128 offset). Children are `{ref: slotId}` references:

```
SET 130 {kind: "box", children: [{ref: 131}]}
SET 131 {kind: "text", content: "hello"}
SET 0   {kind: "root", child: {ref: 130}}
```

- Wire size ~140% of A (larger because children arrays re-include all refs on update)
- Uniform model — only two operations (SET, DEL)
- More complex decode: must heuristically reconstruct high-level messages
- Natural for reactive systems but poor for child list mutations

**Protocol C: Integer Opcode Tuples (abbreviated keys)**

Maximally compact positional arrays with abbreviated property names:

```
[3, {i: 1, t: "box", d: "column", ch: [{i: 2, t: "text", c: "hello"}]}]
[2, [{tg: 2, st: {c: "goodbye"}}]]
```

- Wire size ~60% of A (most compact)
- Very poor debuggability — abbreviated keys are cryptic
- Fragile abbreviation management as protocol evolves

**Canonical Encoding (production choice)**

CBOR arrays with integer property keys from enumerated constants:

```
[3, {0: 1, 1: "box", 10: "column", 2: [{0: 2, 1: "text", 45: "hello"}]}]
[2, [{0: 2, 1: {45: "goodbye"}}]]
```

Where `0=ID`, `1=TYPE`, `2=CHILDREN`, `10=DIRECTION`, `45=CONTENT`.

- Wire size comparable to C (CBOR encodes 0-23 as single bytes)
- Language-portable: same integer enums shared across TS, Zig, Go
- More debuggable than C: keys are stable integers, not fragile abbreviations
- Extensible: append to enum, never reuse IDs

### 2.2 What the Canonical Encoding Settles

The canonical encoding essentially resolves the "A vs C" debate by getting C's wire compactness with A's structural clarity:

- **Tree+Patch model** (not unified slot graph) — TREE/PATCH/DEFINE are distinct
- **Integer keys** (not string keys or abbreviations) — compact, stable, cross-language
- **CBOR tuples** for opcodes — `[opcode, ...args]`

### 2.3 Remaining Encoding Questions

**Slot value encoding:** The canonical encoding uses integer keys for node properties but string keys for slot values (since slots are open-ended/user-defined). Should there be a `SlotKey` enum for the common slot kinds? Probably not — slot values are diverse and user-extensible, so string keys are appropriate there.

**Batch framing:** Multiple operations can share a single frame (same seq). The current encoding wraps PATCH ops in an array (`[2, [op1, op2, ...]]`). Should DEFINE/DATA also support batching in a single frame? Currently each is a separate frame. For high-throughput data streaming, batching multiple DATA records per frame would reduce header overhead.

---

## 3. Areas Not Yet Developed or Settled

### 3.1 Transport Layer (Stubs Only)

The transport interfaces are well-designed (TransportConnection, TransportConnector, TransportListener, SelfRenderDriver), and the in-process transport works for testing. But all network transports are stubs:

- **net-socket.ts**: Declares schemes (unix, unix-abstract, tcp, tls) but connect/listen return stub errors
- **stdio.ts**: Stub — connect returns "not yet implemented"
- **websocket.ts**: Stub
- **fd.ts**: Stub

**Gap**: No actual IPC or network communication has been tested. The entire protocol has only been exercised via in-process direct calls.

### 3.2 ANSI Shim / Tier 0 Compatibility

The design calls for the viewer to include an ANSI escape code parser that translates legacy terminal output into the render tree. This is completely unimplemented. No:
- VT100/ANSI escape code parser
- PTY creation or management
- Translation from escape codes to RenderNode tree
- Mixed mode (detecting VP magic bytes interleaved with ANSI)

### 3.3 Tier 1: Structured stdio

The Tier 1 mode (CBOR frames on stdout, detected by magic bytes, interleaved with text) has no implementation. This is the key adoption bridge — programs that want structured output without a full socket connection.

### 3.4 Self-Rendering Modes (text:, ansi:)

The SelfRenderDriver interface exists but no implementation. When `VIEWPORT=text:` or `VIEWPORT=ansi:`, the app should embed its own renderer. The ANSI viewer backend renders to a string but doesn't manage raw mode, alternate screen, resize signals, or keyboard input — it's just a test renderer.

### 3.5 REGION Message / Session Management

The REGION message type (0x07) is defined but entirely unimplemented:
- No split/resize/close/focus operations
- No tab groups
- No detach/reattach
- No region allocation to connections

### 3.6 AUDIO Message

Type 0x08 is defined but no implementation: no builtin sounds, no audio streaming, no codec handling.

### 3.7 CANVAS Message / Drawing Commands

Type 0x09 is defined but no implementation:
- No vector 2D command set (path, fill, stroke, text, blit)
- No WebGPU/WGSL shader pipeline
- No remote video stream mode
- The GPU viewer generates GPU command lists from the render tree (rect, text, clip, image) but these are for the viewer's own rendering of boxes/text, not app-driven canvas drawing

### 3.8 Declarative Transitions

The protocol spec describes transitions (`PATCH {target: 3, set: {opacity: 0.0}, transition: @64}`) and slots 64-65 are reserved for transition definitions. The PatchOp type includes a `transition` field. But no viewer interpolates properties over time — transitions are silently ignored.

### 3.9 Focus System and Keyboard Navigation

The design specifies:
- Tab order following document order (or explicit tabIndex)
- Focus trapping within modal regions
- Standard keybindings from definition slots (copy, paste, interrupt)
- Focus ring rendering

None of this is implemented. The headless/DOM/ANSI/GPU viewers don't track focus state. Interactive behaviors (clickable, focusable) are stored as node properties but not processed.

### 3.10 Scroll Virtualization

Scroll nodes exist and the protocol supports `virtualHeight`/`virtualWidth`. But no viewer implements:
- Inertial scrolling
- Scroll position management
- Content-on-demand (requesting visible range from app)
- Scroll bar rendering

### 3.11 Standard Slot Population

The spec defines reserved slots 0-127 (colors, keybindings, transitions, text sizes). No viewer populates these on connection. Apps that reference @0 (background) or @82 (heading size) get undefined.

### 3.12 Remote Transport (Mosh-Style)

The entire mosh-style remote layer is unimplemented:
- No state synchronization on the render tree
- No tree diffing
- No reconnection with state recovery
- No selective quality degradation
- No multi-channel transport (protocol + audio + video)

### 3.13 Proxy Pattern for Latency Compensation

The design decision is clear (app-layer proxy, not viewer scripting) but there's no:
- Reference proxy implementation
- Proxy advertisement in ENV handshake
- Framework for writing proxies

### 3.14 Layout Engine Integration

The pure-TS layout engine (`src/core/layout.ts`) handles basic flexbox for testing. The production plan calls for Taffy (Rust). Grid layout is specified but not implemented even in the TS layout engine.

### 3.15 Real Input Processing

The automation API can simulate clicks and key presses, and apps respond. But:
- No actual keyboard event processing from a real terminal/window
- No mouse event processing
- No IME composition handling
- No clipboard integration

---

## 4. Proposed Experiments

### Experiment 1: Round-Trip Transport Test

**Goal:** Validate the protocol works over actual IPC, not just in-process.

**What to build:**
- Implement the Unix domain socket transport (connect + listen)
- Run a test app in one process, viewer in another, connected by socket
- Verify tree arrives, patches apply, input events flow back
- Measure latency and throughput vs in-process

**Why this matters:** The entire protocol has only been tested via synchronous in-process delivery. Any framing bugs, buffering issues, or partial-read problems are invisible. This is the most basic validation gap.

**Estimated scope:** ~200 lines to implement the net-socket transport's connect/listen.

### Experiment 2: Tier 1 Magic-Byte Interleaving

**Goal:** Prove that structured frames can coexist with plain text on a PTY.

**What to build:**
- A Tier 1 writer: program that writes VP-framed CBOR to stdout when `VIEWPORT=stdio:`
- A Tier 1 reader: parser that scans for magic bytes, extracts frames, passes remainder as text
- Test interleaving: text, then frame, then text, then frame
- Test edge cases: magic bytes split across read boundaries, partial frames

**Why this matters:** This is the adoption bridge. If Tier 1 doesn't work cleanly, the entire "gradual opt-in" story falls apart.

**Estimated scope:** ~300 lines. The FrameReader already handles frame alignment for streams; the stdio transport just needs to be completed.

### Experiment 3: Standard Slot Population + Theme Switching

**Goal:** Validate the slot-based theming system works end-to-end.

**What to build:**
- Viewer populates slots 0-127 on init (colors, keybinds, transitions, text sizes)
- One test app that references standard slots for all its styling (@0 bg, @1 fg, @2 accent, @82 heading)
- Theme switch: viewer updates color slots mid-session, verify everything re-renders
- Accessibility: set transition slot 65 duration to 0, verify animations are suppressed

**Why this matters:** The slot system is the design's answer to theming, accessibility, and user customization. If it doesn't work seamlessly, apps will inline their styles and the whole system loses its value.

**Estimated scope:** ~150 lines. Mostly wiring — the slot machinery already exists.

### Experiment 4: Batch DATA Framing

**Goal:** Measure the overhead of per-record framing for high-throughput data streaming.

**What to build:**
- Extend the canonical encoding to support batched DATA: `[4, [row1, row2, ...row100]]`
- Benchmark: 10,000 records at 1-per-frame vs 100-per-frame
- Measure: total wire bytes, encode/decode time, viewer processing time

**Why this matters:** A `rich-ls` on a large directory might emit 50,000 data records. At 24 bytes header overhead per record, that's 1.2 MB of headers alone. Batching could cut this significantly.

**Estimated scope:** ~100 lines to add batch DATA support to canonical encoding + benchmark.

### Experiment 5: Focus System + Tab Navigation

**Goal:** Implement the minimum viable focus system and test keyboard-driven interaction.

**What to build:**
- ViewerState tracks focus: which node ID is focused
- Tab key cycles through focusable/clickable nodes in document order
- Enter/Space on focused clickable triggers click event
- Focus ring: viewers add visual indicator for focused node
- Test with counter app (tab to button, press Enter to increment)

**Why this matters:** Keyboard navigation is fundamental to the "keyboard-first" principle. Without it, every interaction requires the automation API to target nodes by ID, which isn't how real users work.

**Estimated scope:** ~200 lines across ViewerState + one viewer backend.

### Experiment 6: ANSI Self-Rendering Mode

**Goal:** Prove that a Viewport app can render itself to a terminal without an external viewer.

**What to build:**
- Complete the ANSI SelfRenderDriver: raw mode, alternate screen, resize handling, keyboard input
- When `VIEWPORT=ansi:`, the app uses its own embedded ANSI renderer
- The counter app should work interactively in a plain terminal with no viewer process
- Text mode too: `VIEWPORT=text: counter-app` should print the text projection and exit

**Why this matters:** This is how most developers will first encounter Viewport — running an app directly. If `my-app` can't render a TUI when there's no viewer, the adoption story requires installing a viewer first, which is a non-starter.

**Estimated scope:** ~400 lines. The ANSI viewer backend has the rendering logic; this wraps it with terminal I/O.

### Experiment 7: Scroll Virtualization

**Goal:** Validate that the viewer can efficiently render large scrollable lists.

**What to build:**
- Viewer tracks scrollTop for scroll nodes
- Viewer only requests/renders visible range of children
- App provides content on demand (scroll event → app sends PATCH with new children for visible window)
- Benchmark: 100,000 row file browser, measure memory and render time for visible 50-row window

**Why this matters:** Most real TUI apps are scrollable lists (file browsers, log viewers, tables). If the viewer can't handle virtualization efficiently, performance will be worse than ncurses.

**Estimated scope:** ~300 lines across viewer + one test app modification.

### Experiment 8: Canvas Vector 2D Commands

**Goal:** Define and implement the minimal vector drawing command set.

**What to build:**
- Define CANVAS message payload for vector 2D: moveTo, lineTo, arc, fill, stroke, fillText, drawImage
- Encode as CBOR array of draw commands
- GPU viewer rasterizes commands to a texture
- Dashboard app uses canvas for a simple sparkline chart
- Measure wire size for a typical chart (100 data points)

**Why this matters:** Canvas is the escape hatch for everything that doesn't fit boxes and text. Without it, apps that need charts, diagrams, or custom visualizations have no path.

**Estimated scope:** ~400 lines. The GPU viewer already has a command list abstraction; this extends it to app-driven drawing.

### Experiment 9: Cross-Language Wire Compatibility

**Goal:** Verify that TS, Zig, and Go implementations produce bit-identical wire bytes.

**What to build:**
- A corpus of test messages (10+ covering all message types)
- Each implementation encodes the corpus to bytes
- Compare byte-for-byte across all three languages
- Also: each implementation decodes the other two's bytes

**Why this matters:** The whole point of the canonical encoding with integer keys is cross-language portability. If the three implementations don't agree on wire format, the protocol is broken.

**Estimated scope:** ~200 lines of test fixtures + comparison scripts.

### Experiment 10: Proxy Pattern Proof-of-Concept

**Goal:** Demonstrate the proxy pattern for latency compensation.

**What to build:**
- A simple counter app running "remote" (with 200ms artificial delay)
- A local proxy that intercepts click events, optimistically increments the counter display, and forwards to the remote app
- When the real response arrives, proxy reconciles (should match in this case)
- Measure perceived latency with and without proxy

**Why this matters:** The proxy pattern is the design's answer to "how do you handle latency without scripting in the viewer?" If the proxy pattern is too painful to implement, the answer may be insufficient.

**Estimated scope:** ~300 lines. Requires working transport (Experiment 1).

---

## 5. Priority Ordering

Experiments are ordered by how much they validate or unblock:

1. **Transport round-trip** (#1) — validates the most basic assumption
2. **Tier 1 magic bytes** (#2) — validates the adoption bridge
3. **Standard slots + theming** (#3) — validates the configuration model
4. **Focus + keyboard** (#5) — validates the interaction model
5. **ANSI self-render** (#6) — validates the standalone experience
6. **Cross-language wire compat** (#9) — validates multi-language story
7. **Scroll virtualization** (#7) — validates performance for real apps
8. **Canvas vector 2D** (#8) — validates the escape hatch
9. **DATA batching** (#4) — optimization experiment
10. **Proxy PoC** (#10) — validates the latency story (depends on #1)

---

## 6. Protocol Refinements to Consider

### 6.1 Property Deletion in Patches

Currently `PATCH {target: 2, set: {content: "new"}}` sets properties. There's no way to *remove* a property (set it back to undefined/default). Options:
- `set: {content: null}` means delete
- Explicit `unset: ["content"]` field on PatchOp
- Convention: each property type has a "default" value that means unset

This matters for transitions: you want to be able to add and then remove a transition reference.

### 6.2 Tree Replacement Scope

Currently TREE replaces the entire tree. For apps with complex UIs, it might be useful to replace a subtree rooted at a specific node:
- `TREE {target: 5, root: {...}}` — replace the subtree under node 5

This is equivalent to `PATCH {target: 5, replace: {...}}` but semantically clearer for large replacements.

### 6.3 Data Stream Management

DATA records currently append forever. There's no way to:
- Clear a data stream
- Remove specific rows
- Update a row in-place
- Set a row limit / ring buffer behavior

For streaming log viewers and real-time dashboards, the viewer needs to know when to discard old data. Options:
- `DATA {schema: @100, clear: true}` — clear before appending
- `DATA {schema: @100, maxRows: 1000}` — ring buffer hint
- `DATA {schema: @100, rowId: 42, row: [...]}` — upsert by row ID

### 6.4 Slot Deletion

`OP_DEL = 1` is reserved for slot deletion but never used. Should slots be deletable? If an app defines slot 200 for a temporary style, can it free slot 200 later? The viewer would need to handle dangling references (nodes still referencing a deleted slot).

### 6.5 ENV Handshake Direction

Currently ENV flows viewer→app. Should the app also send capabilities back? E.g.:
- "I support proxy mode, here's the proxy URL"
- "I need GPU canvas"
- "My preferred viewport dimensions"

This could be a separate HELLO or CAPS message, or the app could write to specific standard slots.

### 6.6 Error / Diagnostic Message

There's no error message type. If the viewer receives a malformed frame, or a PATCH targets a non-existent node, there's no way to report this back. A diagnostic channel (even just logging) would help development.

### 6.7 Compression

For remote transports, should the protocol support frame-level compression (zstd, lz4)? Or is this a transport-layer concern? The tree model should compress well (lots of repeated property names in string-key mode; integer keys are already compact). Worth measuring.
