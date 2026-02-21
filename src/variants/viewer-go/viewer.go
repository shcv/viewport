package viewer

import (
	"fmt"
	"strings"
	"sync"
	"time"
)

// Viewer is the main EmbeddableViewer implementation. It maintains an
// in-memory render tree, processes protocol messages, produces text
// projections, and collects performance metrics.
//
// It is safe for concurrent use; all public methods acquire a mutex.
type Viewer struct {
	mu sync.Mutex

	// Configuration
	renderTarget RenderTarget

	// State
	tree             *RenderTree
	env              *EnvInfo
	messageHandlers  []func(ProtocolMessage)
	dirty            bool

	// Metrics
	messagesProcessed int
	bytesReceived     int
	lastFrameTimeMs   float64
	peakFrameTimeMs   float64
	slotCount         int
	dataRowCount      int
	patchesApplied    int
	patchesFailed     int
	frameTimes        []float64
}

// NewViewer creates a new Viewer with the specified render target.
// Use HeadlessTarget{} for testing.
func NewViewer(target RenderTarget) *Viewer {
	return &Viewer{
		renderTarget:    target,
		tree:            NewRenderTree(),
		messageHandlers: nil,
		frameTimes:      make([]float64, 0, 128),
	}
}

// Init initializes the viewer with environment information.
func (v *Viewer) Init(env EnvInfo) {
	v.mu.Lock()
	defer v.mu.Unlock()

	v.env = &env
	v.tree = NewRenderTree()
	v.resetMetrics()
}

// SetTree sets the root tree directly (no serialization).
// This is the embeddable viewer's direct-call method.
func (v *Viewer) SetTree(root *VNode) {
	v.mu.Lock()
	defer v.mu.Unlock()

	start := time.Now()
	v.messagesProcessed++

	SetTreeRoot(v.tree, root)
	v.dirty = true

	v.trackFrameTime(start)
}

// ApplyPatches applies patches directly (no serialization).
func (v *Viewer) ApplyPatches(ops []PatchOp) {
	v.mu.Lock()
	defer v.mu.Unlock()

	start := time.Now()
	v.messagesProcessed++

	applied, failed := ApplyPatches(v.tree, ops)
	v.patchesApplied += applied
	v.patchesFailed += failed
	v.dirty = true

	v.trackFrameTime(start)
}

// DefineSlot defines a slot directly (no serialization).
func (v *Viewer) DefineSlot(slot int, value SlotValue) {
	v.mu.Lock()
	defer v.mu.Unlock()

	start := time.Now()
	v.messagesProcessed++

	v.tree.Slots[slot] = value
	v.slotCount = len(v.tree.Slots)
	v.dirty = true

	v.trackFrameTime(start)
}

// ProcessMessage processes a decoded protocol message, updating internal
// state. This is the wire-protocol path.
func (v *Viewer) ProcessMessage(msg ProtocolMessage) {
	v.mu.Lock()
	defer v.mu.Unlock()

	start := time.Now()
	v.messagesProcessed++

	switch msg.Type {
	case MsgDefine:
		if msg.Slot != nil && msg.SlotValue != nil {
			v.tree.Slots[*msg.Slot] = msg.SlotValue
			v.slotCount = len(v.tree.Slots)
		}

	case MsgTree:
		if msg.Root != nil {
			SetTreeRoot(v.tree, msg.Root)
		}

	case MsgPatch:
		applied, failed := ApplyPatches(v.tree, msg.Ops)
		v.patchesApplied += applied
		v.patchesFailed += failed

	case MsgSchema:
		if msg.Slot != nil {
			v.tree.Schemas[*msg.Slot] = msg.Columns
		}

	case MsgData:
		schemaSlot := 0
		if msg.Schema != nil {
			schemaSlot = *msg.Schema
		}
		if _, ok := v.tree.DataRows[schemaSlot]; !ok {
			v.tree.DataRows[schemaSlot] = make([][]interface{}, 0)
		}
		if msg.Row != nil {
			v.tree.DataRows[schemaSlot] = append(v.tree.DataRows[schemaSlot], msg.Row)
			v.dataRowCount++
		}

	case MsgInput:
		if msg.Event != nil {
			// Forward input to registered handlers
			inputMsg := ProtocolMessage{Type: MsgInput, Event: msg.Event}
			for _, handler := range v.messageHandlers {
				handler(inputMsg)
			}
		}

	case MsgEnv:
		if msg.Env != nil {
			v.env = msg.Env
		}
	}

	v.dirty = true
	v.trackFrameTime(start)
}

// GetTree returns the current render tree state.
func (v *Viewer) GetTree() *RenderTree {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.tree
}

// GetTextProjection returns the text projection of the current tree.
func (v *Viewer) GetTextProjection() string {
	v.mu.Lock()
	defer v.mu.Unlock()
	return TextProjection(v.tree)
}

// GetLayout returns the computed layout for a node, or nil if not found.
func (v *Viewer) GetLayout(nodeID int) *ComputedLayout {
	v.mu.Lock()
	defer v.mu.Unlock()

	node, ok := v.tree.NodeIndex[nodeID]
	if !ok {
		return nil
	}
	return node.ComputedLayout
}

// Render renders to the target output. Returns whether anything changed.
func (v *Viewer) Render() bool {
	v.mu.Lock()
	defer v.mu.Unlock()

	if !v.dirty {
		return false
	}

	switch v.renderTarget.TargetType() {
	case "ansi":
		// Would write ANSI to fd; for now produce the text
		_ = v.renderToAnsi()
	case "headless":
		// No output needed
	}

	v.dirty = false
	return true
}

// GetMetrics returns current performance/state metrics.
func (v *Viewer) GetMetrics() ViewerMetrics {
	v.mu.Lock()
	defer v.mu.Unlock()

	avg := 0.0
	if len(v.frameTimes) > 0 {
		sum := 0.0
		for _, t := range v.frameTimes {
			sum += t
		}
		avg = sum / float64(len(v.frameTimes))
	}

	frameTimesCopy := make([]float64, len(v.frameTimes))
	copy(frameTimesCopy, v.frameTimes)

	return ViewerMetrics{
		MessagesProcessed: v.messagesProcessed,
		BytesReceived:     v.bytesReceived,
		LastFrameTimeMs:   v.lastFrameTimeMs,
		PeakFrameTimeMs:   v.peakFrameTimeMs,
		AvgFrameTimeMs:    avg,
		MemoryUsageBytes:  v.estimateMemory(),
		TreeNodeCount:     CountNodes(v.tree.Root),
		TreeDepth:         TreeDepth(v.tree.Root),
		SlotCount:         v.slotCount,
		DataRowCount:      v.dataRowCount,
		FrameTimesMs:      frameTimesCopy,
	}
}

// Screenshot captures a visual representation of the current state.
func (v *Viewer) Screenshot() ScreenshotResult {
	v.mu.Lock()
	defer v.mu.Unlock()

	text := v.renderToAnsi()
	width := 800
	height := 600
	if v.env != nil {
		width = v.env.DisplayWidth
		height = v.env.DisplayHeight
	}

	return ScreenshotResult{
		Format: "ansi",
		Data:   text,
		Width:  width,
		Height: height,
	}
}

// SendInput injects an input event (for automation).
func (v *Viewer) SendInput(event InputEvent) {
	v.mu.Lock()
	defer v.mu.Unlock()

	msg := ProtocolMessage{Type: MsgInput, Event: &event}
	for _, handler := range v.messageHandlers {
		handler(msg)
	}
}

// OnMessage registers a callback for outbound messages (e.g. input events).
func (v *Viewer) OnMessage(handler func(ProtocolMessage)) {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.messageHandlers = append(v.messageHandlers, handler)
}

// TrackBytes records received byte count for metrics (called by harness).
func (v *Viewer) TrackBytes(n int) {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.bytesReceived += n
}

// Destroy tears down the viewer and releases resources.
func (v *Viewer) Destroy() {
	v.mu.Lock()
	defer v.mu.Unlock()

	v.messageHandlers = nil
	v.tree = NewRenderTree()
	v.resetMetrics()
}

// RenderTarget returns the viewer's render target.
func (v *Viewer) RenderTargetValue() RenderTarget {
	return v.renderTarget
}

// ── Internal helpers ─────────────────────────────────────────────────

// trackFrameTime records the elapsed time for a frame processing operation.
// Must be called with the mutex held.
func (v *Viewer) trackFrameTime(start time.Time) {
	elapsed := float64(time.Since(start).Microseconds()) / 1000.0 // ms
	v.frameTimes = append(v.frameTimes, elapsed)
	if len(v.frameTimes) > 1000 {
		// Keep last 500 entries
		v.frameTimes = v.frameTimes[len(v.frameTimes)-500:]
	}
	v.lastFrameTimeMs = elapsed
	if elapsed > v.peakFrameTimeMs {
		v.peakFrameTimeMs = elapsed
	}
}

// estimateMemory returns a rough estimate of memory usage in bytes.
// Must be called with the mutex held.
func (v *Viewer) estimateMemory() int {
	bytes := 0
	// Rough per-node estimate: 200 bytes for props + overhead
	bytes += CountNodes(v.tree.Root) * 200
	// Slots
	bytes += v.slotCount * 100
	// Data rows
	bytes += v.dataRowCount * 50
	// Index map overhead
	bytes += len(v.tree.NodeIndex) * 32
	return bytes
}

// renderToAnsi produces a simple ANSI text representation of the tree.
// Must be called with the mutex held.
func (v *Viewer) renderToAnsi() string {
	if v.tree.Root == nil {
		return "(empty tree)"
	}

	var lines []string
	WalkTree(v.tree.Root, func(node *RenderNode, depth int) {
		indent := strings.Repeat("  ", depth)
		idStr := fmt.Sprintf("#%d", node.ID)

		switch node.Type {
		case NodeText:
			content := ""
			if node.Props.Content != nil {
				content = *node.Props.Content
			}
			lines = append(lines, fmt.Sprintf("%s%s", indent, content))
		case NodeBox:
			dir := node.Props.Direction
			if dir == "" {
				dir = "col"
			}
			lines = append(lines, fmt.Sprintf("%s[box%s %s]", indent, idStr, dir))
		case NodeScroll:
			lines = append(lines, fmt.Sprintf("%s[scroll%s]", indent, idStr))
		case NodeInput:
			val := ""
			if node.Props.Value != nil {
				val = *node.Props.Value
			} else if node.Props.Placeholder != nil {
				val = *node.Props.Placeholder
			}
			lines = append(lines, fmt.Sprintf("%s[input%s: %s]", indent, idStr, val))
		case NodeSeparator:
			lines = append(lines, fmt.Sprintf("%s\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500", indent))
		case NodeCanvas:
			alt := ""
			if node.Props.AltText != nil {
				alt = *node.Props.AltText
			}
			lines = append(lines, fmt.Sprintf("%s[canvas%s: %s]", indent, idStr, alt))
		case NodeImage:
			alt := ""
			if node.Props.AltText != nil {
				alt = *node.Props.AltText
			}
			lines = append(lines, fmt.Sprintf("%s[image%s: %s]", indent, idStr, alt))
		}
	}, 0)

	return strings.Join(lines, "\n")
}

// resetMetrics clears all metrics to initial values.
// Must be called with the mutex held.
func (v *Viewer) resetMetrics() {
	v.messagesProcessed = 0
	v.bytesReceived = 0
	v.lastFrameTimeMs = 0
	v.peakFrameTimeMs = 0
	v.slotCount = 0
	v.dataRowCount = 0
	v.patchesApplied = 0
	v.patchesFailed = 0
	v.frameTimes = make([]float64, 0, 128)
}
