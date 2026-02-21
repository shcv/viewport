# DOM-Based Viewer

**Status: Stub — needs implementation**

## Overview

A viewer that renders the Viewport render tree as HTML DOM elements. This is useful
for visual testing (screenshot comparison via headless browser), development tooling,
and as a proof that the protocol can drive a web-based viewer.

This is the "ironic but practical" web viewer mentioned in the design doc §6.3.
It implements `ViewerBackend` and processes protocol messages decoded from CBOR
wire format. For native embeddable viewers, see `viewer-zig/` and `viewer-go/`.

## Task: Implement `DomViewer`

Create `viewer.ts` implementing the `ViewerBackend` interface from `../../core/types.ts`.

### Architecture

Since Node.js doesn't have a DOM, this viewer has two modes:

1. **HTML string mode** — Renders the tree to an HTML string. The `screenshot()` method
   returns HTML that can be opened in a browser or compared.

2. **JSDOM mode** (optional, for testing) — Uses jsdom to maintain a live DOM and
   produce screenshots via serialization.

### Requirements

1. **processMessage(msg)** — Update internal render tree (reuse `../../core/tree.ts`).

2. **getTextProjection()** — Reuse `../../core/text-projection.ts`.

3. **screenshot()** — Return `{ format: 'html', data: htmlString, width, height }`.

4. **HTML rendering rules:**
   - `box` → `<div>` with CSS flexbox/grid
   - `text` → `<span>` with text styling
   - `scroll` → `<div>` with `overflow: auto`
   - `input` → `<input>` or `<textarea>`
   - `separator` → `<hr>`
   - `canvas` → `<div class="canvas-placeholder">` with alt text
   - `image` → `<img>` with alt text

5. **CSS generation:**
   - Convert node props to inline CSS
   - `direction: 'row'` → `display: flex; flex-direction: row`
   - `gap`, `padding`, `margin` → CSS equivalents
   - `background`, `color`, `border` → CSS equivalents
   - Generate a `<style>` block for shared styles if slot-based

6. **Interactive element IDs:**
   - Set `data-viewport-id="N"` on each rendered element
   - Clickable elements get `role="button"` and `tabindex="0"`
   - This enables Playwright browser automation to interact with the rendered output

### Visual Snapshot Testing

The harness can compare HTML screenshots between variants:

```typescript
const htmlA = await viewerA.screenshot(); // headless text
const htmlB = await viewerB.screenshot(); // DOM html

// Visual comparison possible by rendering htmlB in a headless browser
// and comparing pixel output
```

### Dependencies

- No required dependencies for HTML string mode
- Optional: `jsdom` for live DOM mode

### Files to Create

- `viewer.ts` — `DomViewer` class
- `index.ts` — Exports
- `styles.ts` — CSS generation utilities (optional, can inline)

### Reference

- Core types: `../../core/types.ts`
- Tree utilities: `../../core/tree.ts`
- Text projection: `../../core/text-projection.ts`
- Headless viewer reference: `../viewer-headless/viewer.ts`
