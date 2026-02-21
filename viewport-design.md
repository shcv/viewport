# Viewport Protocol

## Design Document — Draft v0.1

**Status:** Early design / pre-prototype  
**Date:** February 2026

---

## 1. Executive Summary

Viewport is a new application display protocol and viewer designed to replace the terminal emulator. It addresses a fundamental gap in the current computing stack: the terminal's text-based protocol (VT100/ANSI escape codes over a character grid) is too primitive for modern application UIs, while browsers and GUI toolkits are too heavy, too complex, and carry too much historical baggage for the kinds of tools developers actually build.

Viewport is an **application protocol**, not a document format. Programs are the authoring tool. The viewer is a thin rendering server that receives structured layout descriptions and renders them — it never executes application code.

### Core design principles

1. **Text compatibility.** The output of any Viewport application can always be captured as plain text. A virtual file provides a live text projection. Copy-paste works correctly across layout boundaries.

2. **Layered adoption.** Legacy terminal programs work unchanged (Tier 0). Programs can opt into structured data output with minimal effort (Tier 1). Full rich rendering is available for programs that want it (Tier 2).

3. **Application, not document.** There is no markup language, no page concept, no navigation. The viewer renders what applications tell it to render. A document is just an application that sends one frame and exits.

4. **Thin viewer.** No scripting runtime, no network stack, no security sandbox, no backward compatibility baggage. The viewer is a layout engine + GPU renderer + input dispatcher, targeting ~50-100k lines of code.

5. **Unix philosophy preserved.** Pipes still work. Text flows through fd 0/1/2. Structured data flows alongside it through the Viewport protocol. Small tools compose — including tools that transform the Viewport stream itself.

---

## 2. Motivation

### 2.1 What's wrong with terminals

The terminal protocol (VT100 and descendants) conflates three things into one character grid: the data model, the text representation, and the visual rendering. This creates well-known problems:

- **Layout is approximate.** Flexbox-style layout on a character grid means rounding everything to integer character widths. Borders are Unicode box-drawing hacks that break copy-paste.
- **Text styling is coarse.** Bold, italic, 256 colors. No font size variation, no proportional text, no typographic control. Everything is monospace, same size.
- **Images are bolted on.** Sixel and Kitty graphics protocol paint over character cells and interact badly with scrolling, selection, and layout.
- **Selection is grid-based.** Click-drag selects a rectangle of characters. Multi-column layouts produce garbled clipboard content.
- **Scrolling is fake.** TUI apps implement their own scrolling by redrawing the entire viewport. There's no native scroll, no inertia, no scroll position the terminal understands.
- **Full-screen redraws are wasteful.** Every frame re-emits the entire screen as ANSI escape codes, even if one character changed.

### 2.2 Why people use TUI frameworks anyway

Despite these limitations, TUI frameworks are thriving (Ink, Textual, Bubbletea, Blessed). Developers choose TUIs because:

- **Speed.** A TUI launches instantly, doesn't need a window manager context, stays in the terminal session. No mental context switch.
- **Keyboard-first.** TUI users want keybindings, command palettes, vim motions — not mouse-driven dialogs.
- **Composability.** TUIs live in an environment where everything else pipes. You can script around them, launch them from scripts, capture output.
- **Remote-friendliness.** They work over SSH.

The common thread: developers reach for Ink/Textual/Bubbletea because they want a **declarative component model with reasonable layout** (flexbox, state-driven re-renders, borders that just work) — not because they want a browser. They want `display: flex` and `onChange` handlers, not `mvaddstr(y, x, str)` and `getch()`.

### 2.3 What TUI developers actually build

Based on a survey of popular Ink, Textual, Bubbletea, and Blessed projects:

**The overwhelming majority are:**

- CLI tools with progress bars, spinners, and status lines
- Log/event viewers with scrolling and filtering
- File browsers and fuzzy finders (fzf-style)
- Git interfaces (lazygit, gitui)
- System monitors (htop-style dashboards)
- REPL/chat interfaces
- Form-style wizards
- Table/list views with selection and sorting

**Almost nobody builds:**

- 3D anything
- Complex drag-and-drop
- Rich text editing (beyond single-line input)
- Animation-heavy interfaces

This validates a design that prioritizes boxes, text, scrollable regions, tables, input fields, and clickable regions — with an escape hatch (canvas/WebGPU) for the rare case that needs pixel-level control.

### 2.4 What's wrong with the browser

The web's problem isn't its expressiveness — the expressiveness is why it won. The problems are:

- **The engine is enormous.** Chromium is ~35M lines of code. Most of that isn't layout and rendering — it's backward compatibility, security sandboxing for an adversarial execution model, a JS runtime, multiple GCs, process-per-tab architecture, and the accumulated weight of features that can never be removed.
- **CSS is a mess.** 25 years of accretion. The cascade, specificity, inheritance, and the interaction between flexbox/grid/float/position/display/table layout form an insanely complex state machine.
- **The DOM is a bad protocol.** Designed as an in-process mutable object graph, not a serializable protocol. React exists because the imperative DOM API is terrible. The virtual DOM exists to diff against a real DOM. If the protocol were designed for declarative patches, none of this would be needed.
- **JavaScript is mandatory.** You can't build an interactive web app without shipping a runtime. This is the source of most performance problems, security vulnerabilities, and complexity.
- **The trust model is adversarial.** Same-origin policy, CSP, CORS, sandboxed iframes, site isolation — massive engineering to contain untrusted code. A terminal protocol where applications run locally or on authenticated remote hosts doesn't need any of this.
- **It couldn't decide what it was.** HTML is a document markup language conscripted into being an application UI description language. The consequences are everywhere: `<div>` soup, CSS fighting between document flow and app layout, SPAs hacking a document viewer into an app runtime.

### 2.5 The opportunity

Take the web's expressive layout model. Strip out backward compatibility, the adversarial trust model, the DOM's imperative API, and the in-viewer scripting runtime. Replace it with a patch-based binary protocol. The result: a protocol with web-level expressiveness that a viewer can implement in ~50-100k lines instead of 35 million.

| Aspect | Browser | Viewport |
|---|---|---|
| Application code | Runs in the viewer | Runs in a separate process |
| Trust model | Adversarial (sandbox everything) | Trusted (local or authenticated remote) |
| Resource loading | Viewer fetches from network | Application provides via protocol |
| Styling | Cascading selectors (CSS) | Flat, per-node |
| Mutation model | Imperative DOM + virtual DOM libs | Patch-based protocol, native |
| Implementation size | ~35M lines | Target ~50-100k lines |
| Startup | 500ms, 500MB RAM | Instant, tens of MB |
| Compatibility | One web, backward compatible forever | Versioned protocol, can evolve |

---

## 3. Architecture

### 3.1 High-level overview

```
┌──────────────────────────────────────────────────────────┐
│                     Viewport Viewer                       │
│                                                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │ App A    │  │ App B    │  │ App C    │  │ Shell  │  │
│  │ region   │  │ region   │  │ region   │  │ region │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───┬────┘  │
│       │              │              │             │       │
│  ┌────┴──────────────┴──────────────┴─────────────┴──┐   │
│  │              Connection Manager                    │   │
│  │  - Unix domain socket per application              │   │
│  │  - Data routing between pipeline stages            │   │
│  │  - Text projection for legacy pipe consumers       │   │
│  └────────────────────────────────────────────────────┘   │
│                                                           │
│  ┌─────────────┐  ┌───────────────┐  ┌────────────────┐  │
│  │ Layout      │  │ GPU Renderer  │  │ Text           │  │
│  │ Engine      │  │ (wgpu/Skia)   │  │ Projection     │  │
│  │ (flex/grid) │  │               │  │ Engine         │  │
│  └─────────────┘  └───────────────┘  └────────────────┘  │
│                                                           │
│  ┌──────────────┐  ┌───────────┐  ┌───────────────────┐  │
│  │ Input &      │  │ Audio     │  │ Session / Region  │  │
│  │ Focus Mgr    │  │ Passthru  │  │ Manager (tmux)    │  │
│  └──────────────┘  └───────────┘  └───────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### 3.2 Connection model: Unix domain socket

Each application connects to the Viewport viewer via a Unix domain socket. The viewer creates the socket and advertises it via environment variable:

```
VIEWPORT=1
VIEWPORT_VERSION=1
VIEWPORT_SOCKET=/run/user/1000/viewport/sess-a3f2.sock
```

**Why sockets over file descriptors:**

File descriptors (e.g., fd 3/4) were considered but rejected for several reasons:

- **Multiple connections.** A multiplexed viewer (tmux-style) needs N applications each with their own protocol channel. With fds, you'd need to pre-allocate pairs for every possible pane. With a socket, each new application simply connects.
- **Dynamic connection.** Child processes that want their own Viewport context can connect independently — they don't need to inherit a specific fd from their parent.
- **Reconnection.** If the viewer restarts, fds are gone. Sockets can reconnect.
- **Discoverability.** An env var with a socket path is self-documenting (`env | grep VIEWPORT`).

Each socket connection is a bidirectional binary protocol stream. The connection handshake includes an application identifier and requested viewport region.

### 3.3 Tiered adoption

#### Tier 0: Classic PTY (zero changes required)

The Viewport viewer creates a PTY, just like any terminal emulator. Programs that don't know about Viewport get stdin/stdout/stderr connected to the PTY slave. `isatty()` returns true. ANSI escape codes work. Everything behaves exactly like running in iTerm2 or Alacritty.

The viewer's built-in ANSI shim parses escape codes and translates them into its internal render tree. Legacy programs get better rendering (GPU-accelerated, proper text projection for copy-paste) without knowing anything changed.

**Detection chain programs already use:**

1. `isatty(stdout)` — am I interactive?
2. `$TERM` — what kind of terminal?
3. `$COLORTERM` — truecolor support?
4. Terminal query escape sequences (DA1/DA2)
5. `$TERM_PROGRAM` — specific emulator?

Viewport adds step 0: check `$VIEWPORT` env var for the richer protocol.

#### Tier 1: Structured stdio (msgpack on stdout)

A program that wants structured data output but doesn't need rich rendering can write msgpack-framed messages directly to stdout. If `$VIEWPORT=1` is set and `isatty(stdout)` is true, the program writes structured frames. The viewer detects magic bytes on the PTY output and switches from ANSI parsing to protocol parsing.

This works through the existing PTY with no new socket connection. If `isatty(stdout)` is false (piped), the program falls back to text. A program can mix plain text and structured frames — the magic bytes are the delimiter.

For pipelines between two Tier 1 programs, the shell can set `VIEWPORT_PIPE=1` to tell the downstream program its stdin carries structured data, or the program can auto-detect via magic bytes.

#### Tier 2: Full Viewport socket (rich rendering)

Programs that want rich UI — layout, interactive controls, canvas — connect to `$VIEWPORT_SOCKET`. This gives them a dedicated bidirectional channel to the viewer, independent of stdio.

At this level, stdout becomes purely the text projection (or unused). The viewer generates the text projection from the render tree.

```
Tier 0:  stdout ──[ANSI bytes]──→ Viewer ANSI parser ──→ render tree
Tier 1:  stdout ──[msgpack frames]──→ Viewer protocol parser ──→ render + data
Tier 2:  stdout ──[text projection]──→ (available for pipes/capture)
         socket ──[full protocol]──→ Viewer (render tree, data, interaction)
```

### 3.4 Pipeline integration

#### Text pipelines (classic)

Classic `prog_a | prog_b` works unchanged. Kernel pipe, text bytes, zero Viewport involvement.

#### Structured data pipelines

When a Viewport-aware shell manages a pipeline, it can route structured data between programs:

```
prog_a ──fd1──→ prog_b ──fd1──→ prog_c   (text, classic pipe)
prog_a ═══════→ prog_b ═══════→ prog_c   (structured data, viewer-mediated)
```

Each program independently connects to the Viewport socket for visual output. The shell tells the viewer about the pipeline topology ("prog_a's data output feeds prog_b's data input"), and the viewer routes data messages between connections.

**Optimization:** The viewer doesn't have to be in the data path for every pipeline. If neither program renders anything, the shell can use a direct kernel pipe. The viewer only mediates when observation is needed (visualization, backpressure display, tap-in debugging).

#### Legacy interop

When a non-Viewport program is the next pipeline stage, the viewer produces the text projection of the upstream program's structured data and pipes it as classic bytes. This is what nushell does internally (render through the `table` command), but as a protocol-level feature.

#### Viewport stream chaining

Programs can act as Viewport protocol proxies — read protocol messages from their input, modify them, pass them through. This enables composable stream transformers:

```
data-source | vp-header "Status" | vp-filter "active" | vp-theme dark
```

Each stage transforms the Viewport message stream. Unknown message types are forwarded verbatim for forward-compatibility. Slot number namespacing prevents collisions between stages (each stage gets a `VIEWPORT_SLOT_BASE` offset from the shell).

### 3.5 Session management (tmux model)

The viewer manages regions like tmux manages panes. Each Viewport connection is assigned to a region. From the application's perspective, it has a viewport with dimensions — it doesn't know or care about the surrounding layout.

Standard operations:

- Split horizontal/vertical (creates new region, spawns shell)
- Resize, move, close regions
- Tab groups
- Detach/reattach (server-side daemon keeps running, client reconnects and gets current render tree state)

Protocol messages:

```
REGION_REQUEST {split: "horizontal", command: "/bin/sh"}
REGION_RESIZE  {width: 1200, height: 400}
FOCUS_CHANGE   {focused: true}
```

Applications can request new regions (file manager opening an editor in a split), but the viewer decides placement. Region management keybindings are configured in the standard definition table.

---

## 4. The Protocol

### 4.1 Wire format

#### Framing

Every message uses a fixed 8-byte binary header followed by a msgpack payload:

```
┌─────────┬─────────┬────────┬─────────────┬──────────────────┐
│ magic   │ version │ type   │ length      │ msgpack payload  │
│ 2 bytes │ 1 byte  │ 1 byte │ 4 bytes LE  │ variable         │
└─────────┴─────────┴────────┴─────────────┴──────────────────┘
```

- **Magic bytes:** Detect accidental raw text on the protocol channel. Also serve as the delimiter when Tier 1 programs embed structured frames in PTY output.
- **Version:** Protocol version for forward compatibility.
- **Type byte:** Fast dispatch without deserializing the payload.
- **Length:** Payload size in bytes (little-endian u32, max ~4GB per message).

#### Why msgpack

MessagePack was chosen over Cap'n Proto, FlatBuffers, and other serialization formats because:

- **Compact and self-describing.** Smaller than JSON, no schema compilation step required.
- **Trivial to implement.** Libraries in every language. A minimal encoder/decoder is ~200 lines.
- **Sufficient performance.** Protocol messages are typically hundreds of bytes to low kilobytes (render patches, data records). Deserialization cost is noise at this scale — the bottleneck is GPU rendering, not parsing.
- **Zero-copy formats (Cap'n Proto, FlatBuffers) rejected** because the data crosses a trust boundary (the application is a separate process). A verification pass is required anyway, negating the zero-copy benefit for small messages. Their ecosystem reach is also narrower.

### 4.2 Message types

The protocol uses a tree-and-patch model. The primary message flow is: define reusable values in slots, construct a tree of nodes, then patch the tree incrementally.

**Preferred design direction:** Tree + patch structure for the protocol, with the slot/definition table used for parameters, styles, data values, and component definitions rather than for the tree structure itself. Node IDs in the tree serve a similar role to slot references but are conceptually distinct — they address positions in a live render tree rather than entries in a definition table.

#### Core message types

| Type byte | Name | Direction | Purpose |
|---|---|---|---|
| 0x01 | DEFINE | app → viewer | Create or update a slot in the definition table |
| 0x02 | TREE | app → viewer | Send a full render tree (initial or replacement) |
| 0x03 | PATCH | app → viewer | Incremental update to the render tree |
| 0x04 | DATA | app → viewer | Structured data record(s) |
| 0x05 | INPUT | viewer → app | User input events |
| 0x06 | ENV | viewer → app | Environment info (dimensions, capabilities, etc.) |
| 0x07 | REGION | bidirectional | Session/region management |
| 0x08 | AUDIO | app → viewer | Audio data or playback commands |
| 0x09 | CANVAS | bidirectional | WebGPU/vector drawing commands and input |
| 0x0A | SCHEMA | app → viewer | Declare a data record schema |

#### Design alternatives under evaluation

Multiple protocol structures are being considered and will be evaluated through prototyping. The primary candidates:

**Candidate A: Tree + Patch with separate slot table (preferred direction)**

Separate concepts for the definition table (reusable styles, data bindings, component templates) and the render tree (a live node hierarchy addressed by node IDs). Updates are explicit patch operations.

```
DEFINE slot=5 {kind: "style", color: "#e0e0e0", weight: "bold"}
TREE {root: {id: 1, type: "box", children: [
  {id: 2, type: "text", style: @5, content: "hello"}
]}}
PATCH {target: 2, set: {content: "goodbye"}}
```

Pros: Clear mental model (tree is a tree, slots are parameters). Explicit patches are easy to debug and replay. Frameworks (React-like) already think in tree + diff terms.

Cons: Two namespaces (slots and node IDs). Slightly more protocol surface.

**Candidate B: Unified reactive slot graph**

Everything — nodes, styles, data, configuration — lives in the slot table. The viewer walks references from a root slot to discover the tree. Updates are slot SET/DEL operations. Anything referencing a changed slot re-renders.

```
SET 5 {kind: "style", color: "#e0e0e0", weight: "bold"}
SET 2 {kind: "text", style: @5, content: "hello"}
SET 1 {kind: "box", children: [@2]}
SET 0 {kind: "root", child: @1}  // slot 0 is always the root

SET 2 {kind: "text", style: @5, content: "goodbye"}  // update
```

Pros: Maximum uniformity. One concept, one namespace. Reactive updates fall out naturally. Simpler protocol (just SET/DEL).

Cons: Viewer must do dependency tracking. Resending full children arrays for insertions (mitigated by virtualized scrolling). Harder to distinguish "update a parameter" from "restructure the tree."

**Candidate C: Integer opcode tuples (minimal)**

Each message is a small positional array. Op code is an integer. Maximally compact.

```
[0, 5, {k: "style", c: "#e0e0e0", w: "bold"}]   // SET slot
[0, 2, {k: "text", s: 5, c: "hello"}]              // SET node
[1, 2]                                               // DEL
[2, {t: 2, c: "goodbye"}]                            // PATCH
```

Pros: Minimal wire overhead. Easy to implement.

Cons: Hard to debug. Less self-documenting. Schema validation is difficult.

**Evaluation criteria:**

- Efficiency (wire size, parse cost)
- Performance (viewer rendering overhead, update granularity)
- Ease of use (library complexity for app developers and viewer implementers)
- Neither side should have to do extra work to model the other's concerns

### 4.3 The definition table

The definition table is a flat array of slots, indexed by integer. Slots hold reusable values: styles, component templates, data values, configuration, keybindings, theme colors, transition settings.

```
DEFINE slot=12 {kind: "style", color: "#e0e0e0", weight: "bold"}
DEFINE slot=13 {kind: "box_template", direction: "row", gap: 8, border: {...}}
DEFINE slot=20 {kind: "data", value: 48231}
```

Nodes in the render tree reference slots: `{style: @12}` means "use the style in slot 12." When a slot is updated, everything referencing it re-renders.

#### Standard slots (viewer-populated)

The viewer pre-populates reserved slots (0–127) with standard values on connection. These form the shared configuration namespace for theming, keybindings, accessibility, and animation:

```
// Colors
slot 0:  {kind: "color", role: "background",  value: "#1e1e2e"}
slot 1:  {kind: "color", role: "foreground",  value: "#cdd6f4"}
slot 2:  {kind: "color", role: "accent",      value: "#89b4fa"}
slot 3:  {kind: "color", role: "error",       value: "#f38ba8"}
slot 4:  {kind: "color", role: "border",      value: "#45475a"}
slot 5:  {kind: "color", role: "dim",         value: "#6c7086"}
...

// Keybindings
slot 32: {kind: "keybind", action: "copy",      key: "ctrl+c"}
slot 33: {kind: "keybind", action: "paste",     key: "ctrl+v"}
slot 34: {kind: "keybind", action: "interrupt",  key: "ctrl+shift+c"}
...

// Transitions and animation
slot 64: {kind: "transition", role: "default", duration_ms: 150, easing: "ease-out"}
slot 65: {kind: "transition", role: "motion",  duration_ms: 300, easing: "ease-in-out"}
...

// Text sizing
slot 80: {kind: "text_size", role: "body",    value: 14}
slot 81: {kind: "text_size", role: "small",   value: 12}
slot 82: {kind: "text_size", role: "heading", value: 20}
```

Applications read these and use them via references (`{background: @0, color: @1}`). Applications can override them. The viewer can re-override at any time (e.g., user changes system theme mid-session → viewer sends `DEFINE slot=0 value="#ffffff"` → everything referencing @0 re-renders). Dark mode is just the viewer updating color slots.

If the viewer has "reduce motion" enabled, it sets slot 65's duration to 0. Applications that reference @65 for their transitions automatically get no-animation, without knowing or caring about the accessibility setting.

Both the application and viewer can write to the definition table. The viewer's writes take precedence for standard slots if there's a conflict.

### 4.4 Render tree

#### Node types

The render tree is composed of a small set of primitives:

**Layout:**

- **box** — Flex/grid container. The universal layout building block. Properties: direction (row/column), wrap, justify, align, gap. Plus border, padding, margin, background, border-radius, shadow, opacity. Supports both flexbox and grid layout modes.
- **scroll** — A box that clips its content and is natively scrollable. The viewer handles scroll input, inertia, scroll bars. Supports virtualization: the application declares total content size and renders on demand for the visible range.

**Content:**

- **text** — Rich inline text with styled spans. Font family (proportional/monospace), size (via standard slots or explicit), weight, color, decoration, alignment. The viewer handles text shaping (HarfBuzz), wrapping, and selection. This is the atomic content unit.
- **image** — Raster or vector image data with alt-text. Participates in layout with intrinsic sizing.
- **canvas** — Programmer-controlled rendering surface. Supports vector 2D drawing commands and WebGPU shaders. Has alt-text for the text projection. Receives raw input events when focused.

**Interactive behaviors (attached to any box):**

- **clickable** — Reports click/hover/focus events. Viewer handles focus ring, keyboard activation (Enter/Space), pointer cursor changes. The application controls all visual appearance.
- **focusable** — Participates in tab order for keyboard navigation.
- **input** — Text input field. The viewer manages text editing, cursor, selection, IME composition, clipboard. The application gets value-change events. Supports single-line and multi-line modes.

**Structural:**

- **separator** — Visual divider line.

Interactive behaviors are capabilities attached to boxes, not separate node types. A "button" is a clickable box styled by the application. A "toggle" is a clickable box where the application swaps visual state on click. This avoids the widget toolkit trap (200 widgets × 50 config options each) while giving applications full visual control and the viewer enough semantic understanding for accessibility.

The only true built-in *rendered* interactive widget is `input`, because text editing (especially IME composition) is genuinely impractical for every application to reimplement correctly.

#### Tree serialization and patching

**Initial render** sends a complete nested tree:

```
TREE {root: {
  id: 1, type: "box", dir: "column", style: @12, children: [
    {id: 2, type: "box", dir: "row", gap: 8, children: [
      {id: 3, type: "text", content: "hello", style: @5},
      {id: 4, type: "text", content: "world"}
    ]},
    {id: 5, type: "text", content: "footer"}
  ]
}}
```

**Incremental updates** use flat patches referencing node IDs:

```
// Update a property
PATCH {target: 3, set: {content: "goodbye"}}

// Insert a child
PATCH {target: 2, children_insert: {index: 2, node: {id: 6, type: "text", content: "!"}}}

// Remove a node
PATCH {target: 5, remove: true}

// Move a child
PATCH {target: 2, children_move: {from: 0, to: 2}}

// Replace a subtree
PATCH {target: 2, replace: {id: 2, type: "box", dir: "column", children: [...]}}
```

Patches are applied atomically. Multiple patches can be batched in a single protocol message for frame coherence.

**Design note:** Node IDs are integers assigned by the application. The application is responsible for ID uniqueness within its connection. The viewer maintains an ID→node index for O(1) patch dispatch.

#### Declarative transitions

Style property changes can be animated declaratively:

```
PATCH {target: 3, set: {opacity: 0.0}, transition: @64}
```

The viewer interpolates the property over the duration and easing specified in slot 64. This keeps animation efficient over remote connections (one message instead of 60) and allows the viewer to disable motion for accessibility by zeroing the transition duration.

### 4.5 Structured data

#### Record format

The protocol supports streaming structured data records for pipeline interoperability. Multiple record formats are under evaluation:

**Schema + positional arrays (compact, preferred for tabular data):**

```
SCHEMA slot=100 {columns: [
  {id: 0, name: "filename", type: "string"},
  {id: 1, name: "size",     type: "uint64",    unit: "bytes"},
  {id: 2, name: "modified", type: "timestamp"}
]}

DATA {schema: @100, row: ["server.log", 48231, 1738764180]}
DATA {schema: @100, row: ["config.yml", 892, 1738750000]}
```

**Dict records (self-describing, preferred for heterogeneous data):**

```
DATA {row: {filename: "server.log", size: 48231, modified: 1738764180}}
```

**Design alternatives under evaluation:**

- Schema + arrays: Compact on the wire, natural for tables, but fragile if schema changes mid-stream.
- Dict records: Self-describing, flexible, but repeat keys in every row.
- Columnar batches (Arrow-style): Maximum analytics performance, but terrible for streaming and overkill for terminal-scale data.
- Self-describing tagged values: Maximum flexibility, maximum redundancy.

The protocol will likely support both schema+arrays (for structured streams) and dicts (for ad-hoc data), with the schema's presence or absence indicating the mode.

#### Data-view binding

A **row template** associates a schema with a visual representation:

```
DEFINE slot=201 {kind: "row_template", schema: @100, layout: {
  type: "row", children: [
    {type: "text", col: 0, style: @2},
    {type: "text", col: 1, format: "human_bytes"},
    {type: "text", col: 2, format: "relative_time", style: @5}
  ]
}}
```

All records matching schema @100 are rendered via template @201. The template binds to column indices. Format strings (`human_bytes`, `relative_time`) are applied by the viewer, keeping the data machine-typed through the pipeline while the display is human-friendly.

This is distinct from the render tree — row templates are for streaming data, while the tree is for the application's UI structure. An application might have a tree with a scrollable region whose content is populated by a stream of records rendered via a template.

### 4.6 Layout engine

The viewer provides real layout computation, not character-grid approximation:

- **Flexbox and grid.** The two layout modes that handle essentially every real UI. No float, no `position: absolute/relative/fixed/sticky` as separate concepts. Implemented via a standard layout library (Taffy is ~5k lines of Rust).
- **Flat, per-node styling.** No cascade, no inheritance, no selectors, no specificity. Every node carries its own style (or references a slot). This eliminates the entire CSS resolution engine. ~40-50 style properties total, compared to CSS's 500+.
- **Proportional text.** Font families resolved from system fonts. The viewer handles text shaping via HarfBuzz. Proportional text for content, monospace for code. Font size variation for headers.
- **Native scrolling.** Viewer-managed scroll regions with inertia, scroll bars, and virtualization. The application declares scrollable regions and optionally provides content on demand for visible ranges.
- **Pixel-precise rendering.** Layout computed at subpixel precision. Borders, padding, and backgrounds are style properties rendered by the viewer — not characters. Copy-paste ignores them because they're visual, not content.

### 4.7 Text projection

Every node type has a well-defined text projection rule:

- **text** nodes concatenate their content.
- **box** nodes contribute newlines or tabs at boundaries (configurable).
- **scroll** nodes project their visible or full content (configurable).
- **input** nodes project their current value.
- **image** and **canvas** nodes project their alt-text.
- **separator** nodes project a line of dashes.

The viewer maintains the text projection as a live parallel representation. This serves triple duty:

1. **Copy-paste.** Selection follows content boundaries (select text in one panel, get just that panel's content; copy a table, get TSV). The terminal's character-grid selection problems are eliminated.
2. **Accessibility.** Screen readers consume the text projection. Since it's built into the protocol from day one (not bolted on like ARIA), every application is accessible by default.
3. **Virtual file.** A path (from env var) provides a live read of the text projection: `cat $VIEWPORT_TEXT > snapshot.txt` captures what you'd see if you stripped all formatting.

Applications can override the text projection per-node via an explicit `text_alt` field when the derived projection isn't appropriate.

### 4.8 Input model

#### Keyboard and focus

The viewer manages a focus system:

- Tab order follows document order (or explicit `tab_index` attributes).
- Focus trapping within modal regions.
- Standard keybindings (configured in standard definition slots) handled by the viewer: copy, paste, interrupt, quit, region management.
- Application-declared keybindings: sent as part of the connection handshake or via DEFINE messages. The viewer routes keyboard events to the focused application, with viewer-level bindings taking precedence.

#### Interactive behaviors

- **Clickable regions:** The viewer sends click, hover, focus events with the target node ID. It handles visual feedback (cursor changes, focus rings) automatically.
- **Input fields:** The viewer handles text editing, cursor movement, selection, IME, clipboard. The application receives value-change events.
- **Canvas regions:** Raw pointer and keyboard events with coordinates relative to the canvas. The viewer's only role is routing events to the focused canvas and managing focus transitions.

#### Input events

```
INPUT {target: 3, kind: "click", x: 42, y: 8, button: 0}
INPUT {target: 3, kind: "hover", x: 50, y: 8}
INPUT {target: 7, kind: "value_change", value: "new text"}
INPUT {kind: "key", key: "ctrl+s"}
INPUT {target: 20, kind: "canvas_pointer", x: 342, y: 187, action: "move"}
```

### 4.9 Canvas and WebGPU

The canvas node is the escape hatch for the 5% of applications that need pixel-level control.

#### Rendering modes

**Vector 2D (simple cases):**

A small command set — path, fill, stroke, text, image blit — sent as protocol messages. The viewer rasterizes locally. Covers charts, sparklines, simple diagrams without requiring GPU shaders.

**WebGPU (full GPU control):**

The application sends WGSL shaders and draw commands. The viewer executes them on the local GPU and composites the result into the layout. Since the viewer is likely built on wgpu, exposing a WebGPU surface to canvas nodes is nearly free — the application gets a texture it draws into.

WebGPU was chosen over raw Vulkan (too low-level, platform-specific) and WebGL (legacy). WGSL shaders are constrained enough that the security implications are manageable for Viewport's trust model.

**Remote rendering fallback:**

For remote connections where the client has no GPU or the application requires server-side rendering, the application renders frames server-side and sends compressed video (H.264/AV1 encoded via hardware encoder). The viewer decodes and composites. The protocol negotiates per canvas node.

```
Canvas modes (per node, app decides based on ENV query):

LOCAL VECTOR:  App ──[draw commands]──→ Viewer rasterizer ──→ composite
LOCAL GPU:     App ──[WGSL + commands]──→ Viewer GPU ──→ composite
REMOTE STREAM: App GPU ──→ encode ──[H.264/AV1]──→ Viewer decode ──→ composite
```

#### Canvas input

Canvas receives raw input events when focused. No hit testing, no hover states — the application handles everything within its rectangle, just like a game engine:

```
INPUT {target: canvas_id, kind: "canvas_pointer", x: 342, y: 187, action: "move"}
INPUT {target: canvas_id, kind: "canvas_key", key: "w"}
CANVAS_CURSOR {target: canvas_id, cursor: "crosshair"}
```

### 4.10 Audio

Minimal audio support, routed through the system audio stack:

```
AUDIO {action: "play", builtin: "notification"}
AUDIO {action: "stream", format: "opus", data: [...]}
```

The viewer decodes if needed and hands audio to PipeWire/CoreAudio/WASAPI. For complex audio (games, music production), applications talk to the system audio API directly. The protocol covers the common case of "play a sound" or "stream audio alongside visual content."

For remote connections, audio frames are an additional channel in the transport, compressed with Opus.

### 4.11 Environment query

The application can query the viewer's capabilities on connection. This is not negotiation — the protocol has a standard; all viewers implement it. But the application needs to know its environment to make decisions:

```
ENV (viewer → app on connection) {
  viewport_version: 1,
  display_width: 2560,
  display_height: 1440,
  pixel_density: 2.0,
  gpu: true,
  gpu_api: "webgpu",
  color_depth: 10,
  video_decode: ["h264", "av1"],
  remote: false,
  latency_ms: 0
}
```

The application reads this and decides what to do. No GPU? Use vector 2D for canvas. High latency? Pre-push more scroll content. Small display? Adjust layout. This is how games query GPU capabilities — not negotiation, just reading the room.

---

## 5. Remote Access

### 5.1 The mosh-like transport

SSH tunnels a single byte stream over a pty. Viewport has multiple channels (protocol stream, audio, video for canvas). A mosh-style replacement is the natural approach:

- **Multiple logical channels** over one connection: text stream, rich protocol stream, audio, video.
- **State synchronization** on the render tree. Mosh's core insight is: don't replay the byte stream, sync the current state. This is even more powerful with a structured render tree — mosh diffs a 2D cell grid; Viewport diffs a document tree, which compresses far better.
- **Reconnection.** The server-side viewer daemon holds the render tree. The client reconnects and gets current state, not a replay.
- **Selective quality degradation.** On a bad connection, drop canvas/image updates but keep text flowing.

### 5.2 Latency management

For the structured protocol (most applications): latency is just the round-trip for input events, same as SSH. But better, because the viewer handles many interactions locally with optimistic updates:

- **Text input:** Viewer handles editing locally, sends value-change events. No round-trip per keystroke (mosh's key insight, applied systematically).
- **Scrolling:** Viewer scrolls locally cached content, pre-fetches from the application. Smooth even at 100ms latency.
- **Button/toggle/select:** Viewer shows visual state change immediately (optimistic), sends the event, application confirms or corrects.
- **Hover states:** Viewer handles entirely locally.

For canvas in remote-stream mode: 20-50ms added latency from encode/decode pipeline. Acceptable for visualization and dashboards, marginal for twitch gaming.

### 5.3 Performance advantage

Viewport should be faster than the current terminal model, not slower:

- Programs send compact render tree patches instead of full-screen ANSI redraws (less data over the wire).
- The viewer diffs and batches GPU draw calls against a retained render tree.
- Native scrolling means the viewer composites on scroll without asking the program for anything.
- State sync on a structured tree compresses far better than character grid diffs.

---

## 6. Ecosystem

### 6.1 The shell

A Viewport-aware shell is the keystone piece. It needs to:

1. Route structured data channels between pipeline stages.
2. Manage Viewport socket connections for child processes.
3. Use the rich protocol for its own UI (completions, error display, prompt, pipeline visualization).
4. Fall back gracefully in a dumb terminal.

Nushell is the closest existing shell philosophically (structured data pipelines, typed values). A fork or clean-room shell inspired by nushell, with native Viewport protocol support, is the recommended path.

The shell's own prompt and UI rendered via Viewport protocol would be powerful dogfooding — demonstrating the benefit every time you open a terminal.

### 6.2 Compatibility layers

**ANSI shim (built into viewer).** The viewer interprets ANSI escape codes from legacy programs and translates them into render tree nodes. An ncurses app just works. This is table stakes for adoption.

**Library adapters.** Drop-in replacements or thin wrappers for existing TUI frameworks:

- **Ink** (React for CLIs) — highest leverage adapter. Ink's model is already a virtual DOM with reconciliation. Swap the "serialize to ANSI" backend with "emit Viewport patches." Minimal conceptual mismatch.
- **Textual** (Python TUI) — same approach. Replace the output driver.
- **Bubbletea** (Go TUI) — replace the renderer.

**Rich coreutils.** Showcase applications: `rich-ls` emitting typed records and rich rendering while writing classic text to stdout. Same for `rich-ps`, `rich-df`, `rich-top`, etc.

### 6.3 Viewer implementations

Because Viewport is a protocol, multiple viewer implementations can exist:

- **Native GPU-accelerated viewer** — the primary implementation. wgpu + Taffy + HarfBuzz. For daily use.
- **Lightweight framebuffer viewer** — for embedded/remote. Reduced feature set.
- **Headless viewer** — consumes the protocol, produces text projection. For testing and CI.
- **Web-based viewer** — runs in a browser tab. Ironic but practical for environments where native installation isn't possible. The browser is one viewer implementation, not the platform.

### 6.4 Long-term: compositor

Viewport could eventually become a compositor/windowing system. If every application speaks the protocol, the viewer manages all application regions (tiling, tabs, etc.) and you get unified text projection, consistent accessibility, shared styling, and a single GPU rendering pipeline.

This is the Plan 9 rio model with modern layout and rendering. But it's a v5 ambition — for v1, Viewport is an application that runs in a window.

Incremental path: terminal → multiplexer → compositor.

---

## 7. Design Evaluation Plan

### 7.1 Prototyping approach

Several design elements have multiple reasonable options. Rather than choosing prematurely, we plan to implement minimal prototypes of the most promising combinations and evaluate them against concrete criteria.

### 7.2 Open design questions

#### Protocol structure

| Question | Candidates | Key tradeoff |
|---|---|---|
| Message architecture | Tree+patch (A) vs unified slot graph (B) vs opcode tuples (C) | Explicitness vs uniformity vs compactness |
| Record format | Schema+arrays vs dicts vs columnar | Compactness vs flexibility vs streaming |
| Tree serialization | Nested initial + flat patch vs all-flat-slots vs hybrid | Developer ergonomics vs protocol simplicity |
| Data-view binding | Column in record vs separate slot reference vs row template | Coupling vs separation of concerns |

#### Evaluation criteria

1. **Wire efficiency.** Total bytes for common operations: initial render of a 50-row table, update one cell, insert a row, stream 10k records.
2. **Parse performance.** Time to decode and apply a batch of 100 patches. Time to parse a full initial tree of 500 nodes.
3. **Library complexity.** Lines of code for a minimal client library (emit a table with a template). Lines of code for the viewer's protocol handler.
4. **Impedance mismatch.** Does the app have to model viewer concepts it doesn't care about? Does the viewer have to infer structure the app didn't express?
5. **Pipeline friendliness.** Can a stream proxy forward/transform messages without understanding all of them? How cleanly do data-only and view-only messages separate?
6. **Debuggability.** Can you inspect the protocol stream and understand what's happening? What's the learning curve?

#### Interactive primitives

A survey of TUI framework usage should inform the set of interactive behaviors built into the viewer vs. left to applications/frameworks. The current proposal (clickable, focusable, input) is minimal. Areas to investigate:

- Do enough applications need dropdown/select behavior to justify a built-in?
- Is drag-and-drop needed? (Probably not for v1 based on the usage survey.)
- Should the viewer handle tooltips/popovers, or are these application-rendered?

### 7.3 What's settled

The following design decisions are considered stable:

- **Unix domain socket** as the connection mechanism (not file descriptors)
- **Msgpack** as the payload serialization format
- **Fixed 8-byte binary frame header** for fast dispatch
- **Standard definition slots** (0–127) for theme, keybindings, transitions, accessibility
- **Flat per-node styling** (no cascade/inheritance)
- **Flexbox + grid layout** (no other layout modes)
- **Text projection built into the protocol** (not bolted on)
- **Tiered adoption** (Tier 0 PTY / Tier 1 structured stdio / Tier 2 full socket)
- **Application protocol identity** (not a document viewer)
- **No scripting in the viewer**
- **WebGPU for canvas** GPU escape hatch, with vector 2D for simple cases
- **Mosh-style remote transport** with state synchronization

---

## 8. Comparison to Existing Systems

| System | Relationship to Viewport |
|---|---|
| **VT100/ANSI terminals** | Viewport's Tier 0 compatibility target. The ANSI shim translates legacy programs. |
| **Nushell** | Philosophical predecessor for structured data pipelines. Viewport extends the idea to structured rendering. |
| **X11** | X11 tried to be a remote rendering protocol but had primitives that were simultaneously too low-level and too high-level. Viewport has a modern layout model. |
| **Wayland** | A compositor protocol, not an application protocol. Viewport could sit above Wayland (as an app in a Wayland window) or eventually replace it. |
| **Plan 9 rio** | Closest ancestor: both window manager and terminal, programs draw into rectangles via a shared protocol. Viewport is rio with modern layout and GPU rendering. |
| **Web/Chromium** | Viewport targets similar expressiveness with 1/100th the implementation. No JS runtime, no adversarial trust model, no backward compat. |
| **Electron** | The problem Viewport solves. Electron ships a whole browser to get web layout. Viewport provides the layout without the browser. |
| **WinForms/XAML/Qt** | Widget toolkits linked into applications. Viewport is a protocol, not a library — the viewer renders, not the app. |
| **NeWS** | Sun's PostScript-based windowing system. Ran display code in the viewer (opposite of Viewport's approach). |

---

## 9. Appendix: Wire Format Examples

### A. Minimal "hello world" (Tier 1, msgpack on stdout)

A program that checks for Viewport and emits a styled text record:

```
// Check environment
if VIEWPORT=1 and isatty(stdout):
    // Write magic bytes + framed msgpack to stdout
    write(stdout, [0xVP, 0x01, 0x02, ...])  // TREE message
    // Payload (msgpack):
    {root: {id: 1, type: "text", content: "Hello, Viewport!", style: {color: "#89b4fa"}}}
else:
    // Fallback
    print("Hello, Viewport!")
```

### B. Table with structured data (Tier 2)

```
// Connect to socket
sock = connect($VIEWPORT_SOCKET)

// Define schema
send(sock, SCHEMA, {slot: 100, columns: [
  {id: 0, name: "name", type: "string"},
  {id: 1, name: "size", type: "uint64", unit: "bytes"},
  {id: 2, name: "mod",  type: "timestamp"}
]})

// Define row template
send(sock, DEFINE, {slot: 201, kind: "row_template", schema: @100, layout: {
  type: "row", gap: 16, children: [
    {type: "text", col: 0, style: @2},
    {type: "text", col: 1, format: "human_bytes", style: @5},
    {type: "text", col: 2, format: "relative_time", style: @5}
  ]
}})

// Send tree with scroll region
send(sock, TREE, {root: {
  id: 1, type: "box", dir: "column", children: [
    {id: 2, type: "text", content: "Files", style: @82},
    {id: 3, type: "scroll", template: @201, virtual_height: 10000}
  ]
}})

// Stream records
send(sock, DATA, {schema: @100, row: ["server.log", 48231, 1738764180]})
send(sock, DATA, {schema: @100, row: ["config.yml", 892, 1738750000]})
// ...
```

### C. Interactive application with patches

```
// Initial UI
send(sock, TREE, {root: {
  id: 1, type: "box", dir: "column", padding: 16, children: [
    {id: 2, type: "text", content: "Counter: 0", style: {size: @82}},
    {id: 3, type: "box", interactive: "clickable", 
     style: {background: @2, padding: [8, 16], border_radius: 6},
     children: [
       {id: 4, type: "text", content: "Increment", style: {color: "#fff"}}
     ]}
  ]
}})

// Event loop
loop:
  msg = recv(sock)
  if msg.kind == "click" and msg.target == 3:
    counter += 1
    send(sock, PATCH, {target: 2, set: {content: f"Counter: {counter}"}})
```

---

## 10. Project Roadmap

### Phase 1: Protocol specification

- Finalize wire format and message types
- Prototype candidate designs (tree+patch vs unified slots vs opcodes)
- Evaluate against criteria (wire size, parse speed, library complexity)
- Write formal specification

### Phase 2: Minimal viewer

- PTY + ANSI shim (Tier 0)
- Viewport socket + basic protocol handling
- Flex layout (Taffy integration)
- Text rendering (HarfBuzz)
- GPU rendering (wgpu)
- Text projection engine

### Phase 3: Shell and ecosystem

- Viewport-aware shell (nushell-inspired)
- Tier 1 structured stdout support
- Client libraries (Rust, Python, Go, TypeScript, C)
- Ink/Textual adapter prototypes

### Phase 4: Rich features

- Canvas (vector 2D + WebGPU)
- Audio passthrough
- Session management (tmux operations)
- Remote transport (mosh-style)

### Phase 5: Polish and extend

- Widget framework libraries (built on Viewport primitives)
- Rich coreutils
- Multiple viewer implementations (native, web, headless)
- Compositor mode exploration

---

*This document captures the design as of February 2026. It is a working draft intended to guide prototyping and solicit feedback. Specific protocol details (message schemas, slot numbering, node type properties) will be refined through implementation experience.*
