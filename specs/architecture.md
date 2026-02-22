# Viewport Architecture

**Status:** Draft v0.2
**Date:** February 2026

---

## 1. Overview

Viewport is an **application display protocol**, not a document format. Programs are
the authoring tool. The viewer is a thin rendering server that receives structured
layout descriptions and renders them — it never executes application code.

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

### Core Design Principles

1. **Text compatibility.** Output of any Viewport application can always be captured as
   plain text. A virtual file provides a live text projection.

2. **Layered adoption.** Legacy terminal programs work unchanged (Tier 0). Programs can
   opt into structured output (Tier 1). Full rich rendering is available (Tier 2).

3. **Application, not document.** No markup language, no page concept. The viewer renders
   what applications tell it to render.

4. **Thin viewer.** No scripting runtime, no network stack in the protocol, no security
   sandbox. The viewer is a layout engine + GPU renderer + input dispatcher, targeting
   ~50-100k lines of code.

5. **Unix philosophy preserved.** Pipes still work. Text flows through fd 0/1/2.
   Structured data flows alongside through the Viewport protocol.

---

## 2. Connection Model

### 2.1 Unix Domain Socket

Each application connects to the viewer via a Unix domain socket:

```
VIEWPORT=1
VIEWPORT_VERSION=1
VIEWPORT_SOCKET=/run/user/1000/viewport/sess-a3f2.sock
```

**Why sockets over file descriptors:**

- **Multiple connections.** A multiplexed viewer needs N applications each with their
  own channel. Sockets handle this naturally.
- **Dynamic connection.** Child processes connect independently.
- **Reconnection.** Sockets survive viewer restarts.
- **Discoverability.** `env | grep VIEWPORT`.

### 2.2 Tiered Adoption

#### Tier 0: Classic PTY (zero changes)

The viewer creates a PTY. Programs that don't know about Viewport get stdin/stdout/stderr
connected to the PTY slave. ANSI escape codes work. The viewer's ANSI shim parses escape
codes and translates them into the internal render tree.

#### Tier 1: Structured stdio (CBOR on stdout)

A program that wants structured output writes CBOR-framed messages to stdout when
`$VIEWPORT=1` and `isatty(stdout)` is true. The viewer detects magic bytes and switches
from ANSI parsing to protocol parsing. No new socket connection needed.

#### Tier 2: Full Viewport socket (rich rendering)

Programs that want rich UI connect to `$VIEWPORT_SOCKET`. This gives a dedicated
bidirectional channel. At this level, stdout is purely the text projection.

```
Tier 0:  stdout ──[ANSI bytes]──→ Viewer ANSI parser ──→ render tree
Tier 1:  stdout ──[CBOR frames]──→ Viewer protocol parser ──→ render + data
Tier 2:  stdout ──[text projection]──→ (available for pipes/capture)
         socket ──[full protocol]──→ Viewer (render tree, data, interaction)
```

---

## 3. Pipeline Integration

### 3.1 Text Pipelines (classic)

`prog_a | prog_b` works unchanged. Kernel pipe, text bytes.

### 3.2 Structured Data Pipelines

When a Viewport-aware shell manages a pipeline, it routes structured data between programs:

```
prog_a ──fd1──→ prog_b ──fd1──→ prog_c   (text, classic pipe)
prog_a ═══════→ prog_b ═══════→ prog_c   (structured data, viewer-mediated)
```

### 3.3 Legacy Interop

When a non-Viewport program is the next pipeline stage, the viewer produces the text
projection of upstream structured data and pipes it as classic bytes.

### 3.4 Viewport Stream Chaining

Programs can act as protocol proxies — read protocol messages, modify them, pass through:

```
data-source | vp-header "Status" | vp-filter "active" | vp-theme dark
```

Each stage transforms the message stream. Unknown message types are forwarded verbatim
for forward-compatibility.

---

## 4. Session Management

The viewer manages regions like tmux manages panes. Each connection is assigned to a
region. Standard operations: split, resize, move, close, tab groups, detach/reattach.

```
REGION_REQUEST {split: "horizontal", command: "/bin/sh"}
REGION_RESIZE  {width: 1200, height: 400}
FOCUS_CHANGE   {focused: true}
```

---

## 5. Layout Engine

The viewer provides real layout computation:

- **Flexbox and grid.** The two layout modes that handle essentially every real UI.
  Implemented via a standard layout library (Taffy, ~5k lines of Rust).
- **Flat, per-node styling.** No cascade, no inheritance, no selectors, no specificity.
  ~40-50 style properties total, vs CSS's 500+.
- **Proportional text.** Font families resolved from system fonts. Text shaping via
  HarfBuzz.
- **Native scrolling.** Viewer-managed scroll regions with inertia, scroll bars,
  virtualization.
- **Pixel-precise rendering.** Layout at subpixel precision. Borders and backgrounds
  are style properties rendered by the viewer, not characters.

---

## 6. Remote Access

### 6.1 Mosh-Style Transport

A mosh-style transport replaces SSH for Viewport connections:

- **Multiple logical channels** over one connection: protocol stream, audio, video.
- **State synchronization** on the render tree. Diffs a document tree, which compresses
  far better than character grid diffs.
- **Reconnection.** Server-side daemon holds render tree state.
- **Selective quality degradation.** Drop canvas/image updates on bad connections,
  keep text flowing.

### 6.2 Viewer-Level Latency Handling

The viewer handles common interactions locally without round-trips:

- **Text input:** Viewer manages editing locally, sends value-change events. No
  round-trip per keystroke.
- **Scrolling:** Viewer scrolls cached content locally, pre-fetches from the app.
- **Hover states:** Entirely local.

These are built into all viewer implementations and work automatically.

### 6.3 Application-Level Latency: The Proxy Pattern

For latency-sensitive interactions beyond what the viewer handles natively (e.g.
filter-as-you-type, optimistic state changes), latency compensation is an
**application-layer concern**, not a protocol concern.

```
Without proxy:   remote app ←→ [network] ←→ viewer
With proxy:      remote app ←→ [network] ←→ local proxy ←→ viewer
```

A **local proxy** is app-provided code that runs on the user's machine. It speaks the
Viewport protocol in both directions — it's a protocol consumer on the remote side and
a protocol producer to the local viewer. For most messages, it's a pass-through. For
latency-sensitive interactions, it:

1. Forwards the input event to the remote app
2. Immediately produces a predicted tree update for the viewer
3. When the real response arrives, reconciles (replaces prediction with truth)

**Why proxy instead of viewer-side scripting:**

- The proxy is real code, not limited by declarative constraints.
- It's app-specific, so it understands the app's semantics.
- The protocol stays simple — no filter/binding/expression primitives.
- The viewer stays simple — it just renders what it receives.
- It's optional — apps work fine without a proxy, just with latency.

**Trust model determines how the proxy reaches the user:**

The proxy pattern maps to existing trust models:

| Trust level | Model | Proxy delivery |
|-------------|-------|----------------|
| **Trusted** | SSH-like: user chose to run the program | App offers proxy, transport fetches and runs it (like mosh) |
| **Curated** | IDE-like: user installs extensions | User installs proxy plugin for specific apps |
| **Untrusted** | Browser-like: user navigates to unknown apps | Proxy requires explicit approval or comes from curated set |

**The "browser" is an app, not the viewer.** Applications that manage connections to
other Viewport apps (with trust UI, proxy approval, etc.) are themselves just apps
rendered by the viewer:

```
Viewer: renders a tree. That's it.

"Terminal" app:  connects to one remote app, runs its proxy if offered.
                 (mosh model — user trusts the remote)

"Browser" app:   manages multiple connections, trust UI, proxy approval.
                 (browser model — untrusted apps)

"IDE" app:       connects to dev tools, runs their proxies, manages layout.
                 (VS Code model — curated extensions)
```

The viewer doesn't know or care about proxies, trust, or networking. The protocol
doesn't need proxy concepts — a proxy is just an application that consumes the protocol
on one side and produces it on the other.

The protocol's only addition is an optional field in the `ENV` handshake for an app to
advertise that a proxy is available (e.g. a URL). The transport layer decides whether
to fetch and run it based on its trust model.

---

## 7. Embeddable Viewer Architecture

The protocol supports two viewer connection modes:

```
Socket viewer:     app → serialize → IPC → deserialize → viewer
Embeddable viewer: app → viewer (direct function calls, no serialization)
```

The `EmbeddableViewer` interface extends `ViewerBackend` with direct-call methods:

- `setTree(root)` — Set root tree directly
- `applyPatches(ops)` — Apply patches directly
- `defineSlot(slot, value)` — Define a slot directly
- `getLayout(nodeId)` — Query computed layout rectangle
- `render()` — Render to target output

Render targets: `ansi` (terminal), `framebuffer`, `texture` (GPU), `headless` (testing),
`html` (DOM).

---

## 8. Viewer Implementations

Because Viewport is a protocol, multiple viewer implementations can exist:

| Viewer | Language | Use Case |
|--------|----------|----------|
| **Headless** | TypeScript | Testing, CI, MCP server |
| **DOM (HTML)** | TypeScript | Visual testing, screenshot comparison |
| **ANSI terminal** | TypeScript | Fallback/compatibility |
| **GPU** | TypeScript (stub) + native | Software fallback + wgpu bridge |
| **Zig Embeddable** | Zig | Native embedding, high performance |
| **Go Embeddable** | Go | Native embedding, Go ecosystem |
| **Native GPU** | Rust (future) | Production use (wgpu + Taffy + HarfBuzz) |

All viewers implement the same view model. Differences are in rendering output, not
behavior. Anything that works in one viewer works in all of them.

---

## 9. Ecosystem

### 9.1 Shell

A Viewport-aware shell (nushell-inspired) needs to:

1. Route structured data channels between pipeline stages.
2. Manage socket connections for child processes.
3. Use the rich protocol for its own UI.
4. Fall back gracefully in a dumb terminal.

### 9.2 Compatibility Layers

- **ANSI shim** (built into viewer): Translates legacy ANSI programs to render tree.
- **Ink adapter**: Swap "serialize to ANSI" with "emit Viewport patches."
- **Textual adapter**: Replace the Python output driver.
- **Bubbletea adapter**: Replace the Go renderer.

### 9.3 Rich Coreutils

Showcase applications: `rich-ls`, `rich-ps`, `rich-df` emitting typed records and
rich rendering while writing classic text to stdout.
