# Viewport Protocol Specification

**Status:** Draft v0.2
**Date:** February 2026

---

## 1. Wire Format

### 1.1 Framing

Every message uses a fixed 8-byte binary header followed by a CBOR payload:

```
┌─────────┬─────────┬────────┬─────────────┬──────────────────┐
│ magic   │ version │ type   │ length      │ CBOR payload     │
│ 2 bytes │ 1 byte  │ 1 byte │ 4 bytes LE  │ variable         │
└─────────┴─────────┴────────┴─────────────┴──────────────────┘
```

- **Magic bytes:** `0x5650` (ASCII 'VP'). Detects accidental raw text on the protocol
  channel. Also serves as the delimiter when Tier 1 programs embed structured frames
  in PTY output.
- **Version:** Protocol version (currently `1`).
- **Type byte:** Message type for fast dispatch without deserializing the payload.
- **Length:** Payload size in bytes (little-endian u32, max ~4GB per message).

### 1.2 Payload Encoding: CBOR

CBOR (RFC 8949) is used as the payload encoding format.

**Why CBOR:**

- Compact, self-describing binary format. Smaller than JSON, no schema compilation step.
- Trivial to implement. Libraries in every language. A minimal encoder/decoder is ~200 lines.
- Sufficient performance. Protocol messages are typically hundreds of bytes to low
  kilobytes. Deserialization cost is noise at this scale.
- Compatibility with other binary protocol layers in the stack.
- Integer-keyed maps are natural in CBOR, enabling compact wire representation without
  sacrificing structure.

**Rejected alternatives:**

- **msgpack:** Similar capabilities but CBOR has better standardization (RFC) and
  integer-key support is more natural.
- **Cap'n Proto / FlatBuffers:** Zero-copy formats require a verification pass at
  trust boundaries anyway, negating the benefit for small messages. Narrower ecosystem.
- **JSON:** Too verbose for a binary protocol. No binary data support without base64.

---

## 2. Message Types

The protocol uses a tree-and-patch model. The primary message flow is: define reusable
values in slots, construct a tree of nodes, then patch the tree incrementally.

| Type byte | Name   | Direction      | Purpose                                    |
|-----------|--------|----------------|--------------------------------------------|
| 0x01      | DEFINE | app → viewer   | Create or update a slot in the definition table |
| 0x02      | TREE   | app → viewer   | Send a full render tree (initial or replacement) |
| 0x03      | PATCH  | app → viewer   | Incremental update to the render tree      |
| 0x04      | DATA   | app → viewer   | Structured data record(s)                  |
| 0x05      | INPUT  | viewer → app   | User input events                          |
| 0x06      | ENV    | viewer → app   | Environment info (dimensions, capabilities) |
| 0x07      | REGION | bidirectional  | Session/region management                  |
| 0x08      | AUDIO  | app → viewer   | Audio data or playback commands             |
| 0x09      | CANVAS | bidirectional  | WebGPU/vector drawing commands and input    |
| 0x0A      | SCHEMA | app → viewer   | Declare a data record schema                |

---

## 3. Definition Table (Slots)

The definition table is a flat array of slots, indexed by integer. Slots hold reusable
values: styles, data values, configuration, keybindings, theme colors, transition settings.

```
DEFINE slot=12 {kind: "style", color: "#e0e0e0", weight: "bold"}
DEFINE slot=20 {kind: "data", value: 48231}
```

Nodes in the render tree reference slots: `{style: @12}` means "use the style in slot 12."
When a slot is updated, everything referencing it re-renders.

### 3.1 Standard Slots (Viewer-Populated)

The viewer pre-populates reserved slots (0–127) with standard values on connection:

```
// Colors
slot 0:  {kind: "color", role: "background",  value: "#1e1e2e"}
slot 1:  {kind: "color", role: "foreground",  value: "#cdd6f4"}
slot 2:  {kind: "color", role: "accent",      value: "#89b4fa"}
slot 3:  {kind: "color", role: "error",       value: "#f38ba8"}
slot 4:  {kind: "color", role: "border",      value: "#45475a"}
slot 5:  {kind: "color", role: "dim",         value: "#6c7086"}

// Keybindings
slot 32: {kind: "keybind", action: "copy",      key: "ctrl+c"}
slot 33: {kind: "keybind", action: "paste",     key: "ctrl+v"}
slot 34: {kind: "keybind", action: "interrupt",  key: "ctrl+shift+c"}

// Transitions and animation
slot 64: {kind: "transition", role: "default", duration_ms: 150, easing: "ease-out"}
slot 65: {kind: "transition", role: "motion",  duration_ms: 300, easing: "ease-in-out"}

// Text sizing
slot 80: {kind: "text_size", role: "body",    value: 14}
slot 81: {kind: "text_size", role: "small",   value: 12}
slot 82: {kind: "text_size", role: "heading", value: 20}
```

Applications read these and use them via references (`{background: @0, color: @1}`).
The viewer can re-override at any time (e.g., user changes system theme → viewer sends
`DEFINE slot=0 value="#ffffff"` → everything referencing @0 re-renders).

Both the application and viewer can write to the definition table. The viewer's writes
take precedence for standard slots if there's a conflict.

### 3.2 Slot Value Kinds

| Kind         | Purpose                         |
|--------------|----------------------------------|
| `style`      | Reusable visual style properties |
| `color`      | Named color role + value         |
| `keybind`    | Keyboard shortcut definition     |
| `transition` | Animation timing + easing        |
| `text_size`  | Named text size role + value     |
| `schema`     | Data record schema (see §5)      |

---

## 4. Render Tree

### 4.1 Node Types

**Layout:**

- **box** — Flex/grid container. Properties: direction, wrap, justify, align, gap,
  border, padding, margin, background, border-radius, shadow, opacity.
- **scroll** — A box that clips content and is natively scrollable. The viewer handles
  scroll input, inertia, scroll bars. Supports virtualization via `virtualHeight`.

**Content:**

- **text** — Inline text with styled spans. Font family, size, weight, color, decoration,
  alignment.
- **image** — Raster or vector image data with alt-text.
- **canvas** — Programmer-controlled rendering surface (vector 2D or WebGPU).

**Interactive behaviors (attached to any box):**

- **clickable** — Reports click/hover/focus events. Viewer handles focus ring, keyboard
  activation, pointer cursor.
- **focusable** — Participates in tab order.
- **input** — Text input field. Viewer manages editing, cursor, selection, IME, clipboard.
  Application gets value-change events.

**Structural:**

- **separator** — Visual divider line.

Interactive behaviors are capabilities attached to boxes, not separate node types. The
only built-in rendered interactive widget is `input`, because text editing (especially
IME composition) is impractical for every application to reimplement.

### 4.2 Virtual Node (VNode)

The application produces VNodes:

```typescript
interface VNode {
  id: number;
  type: NodeType;
  props: NodeProps;
  children?: VNode[];
  textAlt?: string;    // override text projection
}
```

Node IDs are integers assigned by the application. The application is responsible for
ID uniqueness within its connection. The viewer maintains an ID→node index for O(1)
patch dispatch.

### 4.3 Tree Serialization

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

### 4.4 Patching

**Incremental updates** use flat patches referencing node IDs:

```
PATCH {target: 3, set: {content: "goodbye"}}
PATCH {target: 2, children_insert: {index: 2, node: {id: 6, type: "text", content: "!"}}}
PATCH {target: 5, remove: true}
PATCH {target: 2, children_move: {from: 0, to: 2}}
PATCH {target: 2, replace: {id: 2, type: "box", dir: "column", children: [...]}}
```

Patches are applied atomically. Multiple patches can be batched in a single protocol
message for frame coherence.

### 4.5 Declarative Transitions

Style property changes can be animated declaratively:

```
PATCH {target: 3, set: {opacity: 0.0}, transition: @64}
```

The viewer interpolates the property over the duration and easing specified in slot 64.
This keeps animation efficient over remote connections (one message instead of 60) and
allows the viewer to disable motion for accessibility.

---

## 5. Structured Data

### 5.1 Schema Definition

The protocol supports streaming structured data records for pipeline interoperability.
Schemas are defined as slot values:

```
SCHEMA slot=100 {columns: [
  {id: 0, name: "filename", type: "string"},
  {id: 1, name: "size",     type: "uint64",    unit: "bytes",  format: "human_bytes"},
  {id: 2, name: "modified", type: "timestamp",  format: "relative_time"}
]}
```

Schema columns carry **display hints** directly:

| Column field | Purpose                                              |
|-------------|------------------------------------------------------|
| `id`        | Column index                                         |
| `name`      | Column name (used in dict records and text projection headers) |
| `type`      | Data type for validation and formatting               |
| `unit`      | Optional semantic unit (e.g. `"bytes"`, `"percent"`)  |
| `format`    | Optional display format hint (e.g. `"human_bytes"`, `"relative_time"`) |

Display hints like `format` tell the viewer how to present values in text projection
and visual rendering. The data remains machine-typed through the pipeline while the
display is human-friendly.

### 5.2 Data Records

The protocol supports two interchangeable record shapes. The app chooses based on its
data's structure:

**Schema + positional arrays** (compact, for tabular data):

```
DATA {schema: @100, row: ["server.log", 48231, 1738764180]}
DATA {schema: @100, row: ["config.yml", 892, 1738750000]}
```

**Dict records** (self-describing, for heterogeneous/ad-hoc data):

```
DATA {row: {filename: "server.log", size: 48231, modified: 1738764180}}
```

Both representations are interchangeable from the viewer's perspective. A dict record
with a schema reference is unpacked using column names from the schema. A positional
array without a schema is treated as opaque values.

**When to use which:**

- Schema + arrays: Streaming tabular data (file listings, log entries, table rows).
  Compact — column names appear once in the schema, not per row.
- Dicts: Ad-hoc or heterogeneous data where rows may have different shapes, or when
  self-description is more important than compactness.

### 5.3 Data-View Binding

Scroll regions can reference a schema slot to indicate that their content includes
streamed data. The viewer uses the schema's display hints to format values in text
projection and visual rendering:

```
TREE {root: {
  id: 1, type: "box", dir: "column", children: [
    {id: 2, type: "text", content: "Files", style: @82},
    {id: 3, type: "scroll", schema: @100, virtual_height: 10000}
  ]
}}
```

The `schema` prop on a scroll node tells the viewer: "data records matching this schema
should be projected as content of this scroll region." The schema's column definitions
(including `format` hints) control how values are formatted.

---

## 6. Input Model

### 6.1 Keyboard and Focus

The viewer manages a focus system:

- Tab order follows document order (or explicit `tabIndex` attributes).
- Focus trapping within modal regions.
- Standard keybindings (from standard definition slots) handled by the viewer.
- Application-declared keybindings sent via DEFINE messages.

### 6.2 Input Events

```
INPUT {target: 3, kind: "click", x: 42, y: 8, button: 0}
INPUT {target: 3, kind: "hover", x: 50, y: 8}
INPUT {target: 7, kind: "value_change", value: "new text"}
INPUT {kind: "key", key: "ctrl+s"}
INPUT {target: 20, kind: "canvas_pointer", x: 342, y: 187, action: "move"}
INPUT {target: 3, kind: "scroll", scrollTop: 120}
```

Event kinds: `click`, `hover`, `focus`, `blur`, `key`, `value_change`,
`canvas_pointer`, `canvas_key`, `scroll`.

### 6.3 Text Input

The viewer manages text editing for `input` nodes: cursor movement, selection, IME
composition, clipboard. The application receives `value_change` events with the
complete new value. This means text input works at zero latency — the viewer handles
it locally, even over remote connections.

---

## 7. Text Projection

Every node type has a well-defined text projection rule:

| Node type   | Projection rule                                           |
|-------------|-----------------------------------------------------------|
| `text`      | Content string                                            |
| `box`       | Children joined by newlines (column) or tabs (row)        |
| `scroll`    | Children content, plus data rows formatted via schema     |
| `input`     | Current value (or placeholder)                            |
| `image`     | Alt-text (or `[image]`)                                   |
| `canvas`    | Alt-text (or `[image]`)                                   |
| `separator` | A line of dashes                                          |

For scroll nodes with a schema reference, data rows are projected as a TSV-like table:
column headers from schema names, values formatted using schema display hints.

The viewer maintains text projection as a live parallel representation for:

1. **Copy-paste.** Selection follows content boundaries.
2. **Accessibility.** Screen readers consume the text projection.
3. **Virtual file.** `cat $VIEWPORT_TEXT` captures what you'd see without formatting.

Applications can override per-node via `textAlt`.

---

## 8. Canvas and WebGPU

The canvas node is the escape hatch for applications that need pixel-level control.

**Rendering modes:**

- **Vector 2D:** Path, fill, stroke, text, image blit commands. Viewer rasterizes locally.
- **WebGPU:** WGSL shaders and draw commands. Viewer executes on local GPU.
- **Remote stream:** Server-side rendering, compressed video (H.264/AV1) to viewer.

```
LOCAL VECTOR:  App ──[draw commands]──→ Viewer rasterizer ──→ composite
LOCAL GPU:     App ──[WGSL + commands]──→ Viewer GPU ──→ composite
REMOTE STREAM: App GPU ──→ encode ──[H.264/AV1]──→ Viewer decode ──→ composite
```

Canvas receives raw input events when focused. No hit testing — the application handles
everything within its rectangle.

---

## 9. Audio

Minimal audio support routed through the system audio stack:

```
AUDIO {action: "play", builtin: "notification"}
AUDIO {action: "stream", format: "opus", data: [...]}
```

For complex audio, applications talk to the system audio API directly.

---

## 10. Environment Query

The viewer sends environment information on connection:

```
ENV {
  viewport_version: 1,
  display_width: 2560, display_height: 1440,
  pixel_density: 2.0,
  gpu: true, gpu_api: "webgpu",
  color_depth: 10,
  video_decode: ["h264", "av1"],
  remote: false,
  latency_ms: 0
}
```

The application reads this and decides what to do. No GPU? Use vector 2D for canvas.
Small display? Adjust layout. This is not negotiation — the protocol has a standard;
all viewers implement it.

---

## 11. Wire Format Examples

### A. Minimal "hello world" (Tier 1)

```
if VIEWPORT=1 and isatty(stdout):
    write(stdout, [0x56, 0x50, 0x01, 0x02, ...])  // TREE message
    // CBOR payload:
    {root: {id: 1, type: "text", content: "Hello, Viewport!", style: {color: "#89b4fa"}}}
else:
    print("Hello, Viewport!")
```

### B. Table with structured data (Tier 2)

```
sock = connect($VIEWPORT_SOCKET)

// Define schema with display hints
send(sock, SCHEMA, {slot: 100, columns: [
  {id: 0, name: "name",     type: "string"},
  {id: 1, name: "size",     type: "uint64",  unit: "bytes",  format: "human_bytes"},
  {id: 2, name: "modified", type: "timestamp", format: "relative_time"}
]})

// Send tree — scroll region references schema for data projection
send(sock, TREE, {root: {
  id: 1, type: "box", dir: "column", children: [
    {id: 2, type: "text", content: "Files", style: @82},
    {id: 3, type: "scroll", schema: @100, virtual_height: 10000}
  ]
}})

// Stream records (positional arrays — compact)
send(sock, DATA, {schema: @100, row: ["server.log", 48231, 1738764180]})
send(sock, DATA, {schema: @100, row: ["config.yml", 892, 1738750000]})

// Or stream as dicts (self-describing)
send(sock, DATA, {row: {name: "server.log", size: 48231, modified: 1738764180}})
```

### C. Interactive application with patches

```
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

loop:
  msg = recv(sock)
  if msg.kind == "click" and msg.target == 3:
    counter += 1
    send(sock, PATCH, {target: 2, set: {content: f"Counter: {counter}"}})
```
