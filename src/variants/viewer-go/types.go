// Package viewer implements the Viewport protocol embeddable viewer in Go.
//
// It decodes the binary wire format (8-byte frame header + CBOR payload),
// maintains a render tree in memory, supports the embeddable viewer pattern
// (direct function calls, no serialization needed), produces text projection
// output, and targets headless mode for testing.
package viewer

// ── Node types ───────────────────────────────────────────────────────

// NodeType identifies the kind of a UI node.
type NodeType string

const (
	NodeBox       NodeType = "box"
	NodeText      NodeType = "text"
	NodeScroll    NodeType = "scroll"
	NodeInput     NodeType = "input"
	NodeImage     NodeType = "image"
	NodeCanvas    NodeType = "canvas"
	NodeSeparator NodeType = "separator"
)

// ── Message types (wire protocol) ────────────────────────────────────

// MessageType identifies the kind of a protocol message.
type MessageType uint8

const (
	MsgDefine MessageType = 0x01
	MsgTree   MessageType = 0x02
	MsgPatch  MessageType = 0x03
	MsgData   MessageType = 0x04
	MsgInput  MessageType = 0x05
	MsgEnv    MessageType = 0x06
	MsgRegion MessageType = 0x07
	MsgAudio  MessageType = 0x08
	MsgCanvas MessageType = 0x09
	MsgSchema MessageType = 0x0a
)

// ── Node properties ──────────────────────────────────────────────────

// BorderStyle describes border appearance.
type BorderStyle struct {
	Width int    `json:"width,omitempty" cbor:"width,omitempty"`
	Color string `json:"color,omitempty" cbor:"color,omitempty"`
	Style string `json:"style,omitempty" cbor:"style,omitempty"` // solid, dashed, dotted, none
}

// ShadowStyle describes a drop shadow.
type ShadowStyle struct {
	X    int    `json:"x" cbor:"x"`
	Y    int    `json:"y" cbor:"y"`
	Blur int    `json:"blur" cbor:"blur"`
	Color string `json:"color" cbor:"color"`
}

// NodeProps holds all possible node properties. Which fields are relevant
// depends on the node type.
type NodeProps struct {
	// Box layout
	Direction string `json:"direction,omitempty" cbor:"direction,omitempty"` // "row" or "column"
	Wrap      *bool  `json:"wrap,omitempty" cbor:"wrap,omitempty"`
	Justify   string `json:"justify,omitempty" cbor:"justify,omitempty"`
	Align     string `json:"align,omitempty" cbor:"align,omitempty"`
	Gap       *int   `json:"gap,omitempty" cbor:"gap,omitempty"`

	// Spacing (simplified to single int for now; arrays handled via interface{})
	Padding interface{} `json:"padding,omitempty" cbor:"padding,omitempty"`
	Margin  interface{} `json:"margin,omitempty" cbor:"margin,omitempty"`

	// Visual
	Border       *BorderStyle `json:"border,omitempty" cbor:"border,omitempty"`
	BorderRadius *int         `json:"borderRadius,omitempty" cbor:"borderRadius,omitempty"`
	Background   interface{}  `json:"background,omitempty" cbor:"background,omitempty"` // string or int (slot ref)
	Opacity      *float64     `json:"opacity,omitempty" cbor:"opacity,omitempty"`
	Shadow       *ShadowStyle `json:"shadow,omitempty" cbor:"shadow,omitempty"`

	// Sizing
	Width    interface{} `json:"width,omitempty" cbor:"width,omitempty"`  // number or string
	Height   interface{} `json:"height,omitempty" cbor:"height,omitempty"` // number or string
	Flex     *float64    `json:"flex,omitempty" cbor:"flex,omitempty"`
	MinWidth *int        `json:"minWidth,omitempty" cbor:"minWidth,omitempty"`
	MinHeight *int       `json:"minHeight,omitempty" cbor:"minHeight,omitempty"`
	MaxWidth *int        `json:"maxWidth,omitempty" cbor:"maxWidth,omitempty"`
	MaxHeight *int       `json:"maxHeight,omitempty" cbor:"maxHeight,omitempty"`

	// Text
	Content    *string `json:"content,omitempty" cbor:"content,omitempty"`
	FontFamily string  `json:"fontFamily,omitempty" cbor:"fontFamily,omitempty"`
	Size       *int    `json:"size,omitempty" cbor:"size,omitempty"`
	Weight     string  `json:"weight,omitempty" cbor:"weight,omitempty"`
	Color      interface{} `json:"color,omitempty" cbor:"color,omitempty"` // string or int (slot ref)
	Decoration string  `json:"decoration,omitempty" cbor:"decoration,omitempty"`
	TextAlign  string  `json:"textAlign,omitempty" cbor:"textAlign,omitempty"`
	Italic     *bool   `json:"italic,omitempty" cbor:"italic,omitempty"`

	// Scroll
	VirtualHeight *int `json:"virtualHeight,omitempty" cbor:"virtualHeight,omitempty"`
	VirtualWidth  *int `json:"virtualWidth,omitempty" cbor:"virtualWidth,omitempty"`
	ScrollTop     *int `json:"scrollTop,omitempty" cbor:"scrollTop,omitempty"`
	ScrollLeft    *int `json:"scrollLeft,omitempty" cbor:"scrollLeft,omitempty"`
	Template      *int `json:"template,omitempty" cbor:"template,omitempty"` // slot ref

	// Input
	Value       *string `json:"value,omitempty" cbor:"value,omitempty"`
	Placeholder *string `json:"placeholder,omitempty" cbor:"placeholder,omitempty"`
	Multiline   *bool   `json:"multiline,omitempty" cbor:"multiline,omitempty"`
	Disabled    *bool   `json:"disabled,omitempty" cbor:"disabled,omitempty"`

	// Image
	Data    []byte `json:"data,omitempty" cbor:"data,omitempty"`
	Format  string `json:"format,omitempty" cbor:"format,omitempty"` // png, jpeg, svg
	AltText *string `json:"altText,omitempty" cbor:"altText,omitempty"`

	// Canvas
	Mode string `json:"mode,omitempty" cbor:"mode,omitempty"` // vector2d, webgpu, remote_stream

	// Interactive
	Interactive string `json:"interactive,omitempty" cbor:"interactive,omitempty"` // clickable, focusable
	TabIndex    *int   `json:"tabIndex,omitempty" cbor:"tabIndex,omitempty"`

	// Style/transition slot references
	Style      *int `json:"style,omitempty" cbor:"style,omitempty"`
	Transition *int `json:"transition,omitempty" cbor:"transition,omitempty"`

	// TextAlt overrides text projection output for a node.
	TextAlt *string `json:"textAlt,omitempty" cbor:"textAlt,omitempty"`

	// Extra catches any additional properties not explicitly defined.
	Extra map[string]interface{} `json:"-" cbor:"-"`
}

// ── VNode: the virtual node tree apps produce ────────────────────────

// VNode is a virtual node in the app's tree.
type VNode struct {
	ID       int      `json:"id" cbor:"id"`
	Type     NodeType `json:"type" cbor:"type"`
	Props    NodeProps `json:"props" cbor:"props"`
	Children []*VNode `json:"children,omitempty" cbor:"children,omitempty"`
	TextAlt  *string  `json:"textAlt,omitempty" cbor:"textAlt,omitempty"`
}

// ── Render tree (materialized state in viewer) ───────────────────────

// ComputedLayout holds the computed position and dimensions for a node.
type ComputedLayout struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

// RenderNode is a materialized node in the render tree.
type RenderNode struct {
	ID             int             `json:"id"`
	Type           NodeType        `json:"type"`
	Props          NodeProps       `json:"props"`
	Children       []*RenderNode   `json:"children"`
	ComputedLayout *ComputedLayout `json:"computedLayout,omitempty"`
}

// RenderTree holds the complete materialized state of the viewer.
type RenderTree struct {
	Root      *RenderNode                  `json:"root"`
	Slots     map[int]SlotValue            `json:"slots"`
	Schemas   map[int][]SchemaColumn       `json:"schemas"`
	DataRows  map[int][][]interface{}       `json:"dataRows"` // schema slot -> rows
	NodeIndex map[int]*RenderNode          `json:"-"`
}

// ── Schema ───────────────────────────────────────────────────────────

// SchemaColumn describes a single column in a data schema.
type SchemaColumn struct {
	ID     int    `json:"id" cbor:"id"`
	Name   string `json:"name" cbor:"name"`
	Type   string `json:"type" cbor:"type"` // string, uint64, int64, float64, bool, timestamp
	Unit   string `json:"unit,omitempty" cbor:"unit,omitempty"`
	Format string `json:"format,omitempty" cbor:"format,omitempty"` // human_bytes, relative_time
}

// ── Slot values ──────────────────────────────────────────────────────

// SlotValue is the interface for all slot definition values.
type SlotValue interface {
	SlotKind() string
}

// StyleSlot holds style definition properties.
type StyleSlot struct {
	Kind  string                 `json:"kind" cbor:"kind"`
	Props map[string]interface{} `json:"props,omitempty" cbor:"props,omitempty"`
}

func (s StyleSlot) SlotKind() string { return "style" }

// ColorSlot defines a named color.
type ColorSlot struct {
	Kind  string `json:"kind" cbor:"kind"`
	Role  string `json:"role" cbor:"role"`
	Value string `json:"value" cbor:"value"`
}

func (s ColorSlot) SlotKind() string { return "color" }

// KeybindSlot defines a keyboard shortcut.
type KeybindSlot struct {
	Kind   string `json:"kind" cbor:"kind"`
	Action string `json:"action" cbor:"action"`
	Key    string `json:"key" cbor:"key"`
}

func (s KeybindSlot) SlotKind() string { return "keybind" }

// TransitionSlot defines an animation transition.
type TransitionSlot struct {
	Kind       string `json:"kind" cbor:"kind"`
	Role       string `json:"role" cbor:"role"`
	DurationMs int    `json:"durationMs" cbor:"durationMs"`
	Easing     string `json:"easing" cbor:"easing"`
}

func (s TransitionSlot) SlotKind() string { return "transition" }

// TextSizeSlot defines a named text size.
type TextSizeSlot struct {
	Kind  string  `json:"kind" cbor:"kind"`
	Role  string  `json:"role" cbor:"role"`
	Value float64 `json:"value" cbor:"value"`
}

func (s TextSizeSlot) SlotKind() string { return "text_size" }

// SchemaSlot defines a data schema.
type SchemaSlot struct {
	Kind    string         `json:"kind" cbor:"kind"`
	Columns []SchemaColumn `json:"columns" cbor:"columns"`
}

func (s SchemaSlot) SlotKind() string { return "schema" }

// RowTemplateSlot defines a template for rendering data rows.
type RowTemplateSlot struct {
	Kind   string `json:"kind" cbor:"kind"`
	Schema int    `json:"schema" cbor:"schema"` // slot ref
	Layout *VNode `json:"layout" cbor:"layout"`
}

func (s RowTemplateSlot) SlotKind() string { return "row_template" }

// GenericSlot is a catch-all for slot types not explicitly modeled.
type GenericSlot struct {
	Kind  string                 `json:"kind" cbor:"kind"`
	Props map[string]interface{} `json:"props,omitempty" cbor:"props,omitempty"`
}

func (s GenericSlot) SlotKind() string { return s.Kind }

// ── Patch operations ─────────────────────────────────────────────────

// PatchOp describes an incremental tree update operation.
type PatchOp struct {
	Target         int               `json:"target" cbor:"target"`
	Set            map[string]interface{} `json:"set,omitempty" cbor:"set,omitempty"`
	ChildrenInsert *ChildrenInsert   `json:"childrenInsert,omitempty" cbor:"childrenInsert,omitempty"`
	ChildrenRemove *ChildrenRemove   `json:"childrenRemove,omitempty" cbor:"childrenRemove,omitempty"`
	ChildrenMove   *ChildrenMove     `json:"childrenMove,omitempty" cbor:"childrenMove,omitempty"`
	Remove         bool              `json:"remove,omitempty" cbor:"remove,omitempty"`
	Replace        *VNode            `json:"replace,omitempty" cbor:"replace,omitempty"`
	Transition     *int              `json:"transition,omitempty" cbor:"transition,omitempty"`
}

// ChildrenInsert describes inserting a child at an index.
type ChildrenInsert struct {
	Index int    `json:"index" cbor:"index"`
	Node  *VNode `json:"node" cbor:"node"`
}

// ChildrenRemove describes removing a child at an index.
type ChildrenRemove struct {
	Index int `json:"index" cbor:"index"`
}

// ChildrenMove describes moving a child from one index to another.
type ChildrenMove struct {
	From int `json:"from" cbor:"from"`
	To   int `json:"to" cbor:"to"`
}

// ── Input events ─────────────────────────────────────────────────────

// InputEvent describes user input directed at a node.
type InputEvent struct {
	Target    *int    `json:"target,omitempty" cbor:"target,omitempty"`
	Kind      string  `json:"kind" cbor:"kind"` // click, hover, focus, blur, key, value_change, etc.
	Key       string  `json:"key,omitempty" cbor:"key,omitempty"`
	Value     string  `json:"value,omitempty" cbor:"value,omitempty"`
	X         *int    `json:"x,omitempty" cbor:"x,omitempty"`
	Y         *int    `json:"y,omitempty" cbor:"y,omitempty"`
	Button    *int    `json:"button,omitempty" cbor:"button,omitempty"`
	Action    string  `json:"action,omitempty" cbor:"action,omitempty"`
	ScrollTop *int    `json:"scrollTop,omitempty" cbor:"scrollTop,omitempty"`
	ScrollLeft *int   `json:"scrollLeft,omitempty" cbor:"scrollLeft,omitempty"`
}

// ── Protocol messages ────────────────────────────────────────────────

// ProtocolMessage is a union type for all message kinds.
type ProtocolMessage struct {
	Type MessageType `json:"type" cbor:"type"`

	// DEFINE
	Slot      *int      `json:"slot,omitempty" cbor:"slot,omitempty"`
	SlotValue SlotValue `json:"value,omitempty" cbor:"value,omitempty"`

	// TREE
	Root *VNode `json:"root,omitempty" cbor:"root,omitempty"`

	// PATCH
	Ops []PatchOp `json:"ops,omitempty" cbor:"ops,omitempty"`

	// DATA
	Schema   *int          `json:"schema,omitempty" cbor:"schema,omitempty"`
	Row      []interface{} `json:"row,omitempty" cbor:"row,omitempty"`

	// INPUT
	Event *InputEvent `json:"event,omitempty" cbor:"event,omitempty"`

	// ENV
	Env *EnvInfo `json:"env,omitempty" cbor:"env,omitempty"`

	// SCHEMA
	Columns []SchemaColumn `json:"columns,omitempty" cbor:"columns,omitempty"`
}

// ── Environment info ─────────────────────────────────────────────────

// EnvInfo describes the display environment.
type EnvInfo struct {
	ViewportVersion int      `json:"viewportVersion" cbor:"viewportVersion"`
	DisplayWidth    int      `json:"displayWidth" cbor:"displayWidth"`
	DisplayHeight   int      `json:"displayHeight" cbor:"displayHeight"`
	PixelDensity    float64  `json:"pixelDensity" cbor:"pixelDensity"`
	GPU             bool     `json:"gpu" cbor:"gpu"`
	GPUApi          string   `json:"gpuApi,omitempty" cbor:"gpuApi,omitempty"`
	ColorDepth      int      `json:"colorDepth" cbor:"colorDepth"`
	VideoDecode     []string `json:"videoDecode,omitempty" cbor:"videoDecode,omitempty"`
	Remote          bool     `json:"remote" cbor:"remote"`
	LatencyMs       float64  `json:"latencyMs" cbor:"latencyMs"`
}

// ── Wire format ──────────────────────────────────────────────────────

// FrameHeader is the 8-byte binary frame header.
type FrameHeader struct {
	Magic   uint16      `json:"magic"`
	Version uint8       `json:"version"`
	Type    MessageType `json:"type"`
	Length  uint32      `json:"length"` // payload size in bytes (LE u32)
}

// ── Viewer metrics ───────────────────────────────────────────────────

// ViewerMetrics contains performance and state counters.
type ViewerMetrics struct {
	MessagesProcessed int       `json:"messagesProcessed"`
	BytesReceived     int       `json:"bytesReceived"`
	LastFrameTimeMs   float64   `json:"lastFrameTimeMs"`
	PeakFrameTimeMs   float64   `json:"peakFrameTimeMs"`
	AvgFrameTimeMs    float64   `json:"avgFrameTimeMs"`
	MemoryUsageBytes  int       `json:"memoryUsageBytes"`
	TreeNodeCount     int       `json:"treeNodeCount"`
	TreeDepth         int       `json:"treeDepth"`
	SlotCount         int       `json:"slotCount"`
	DataRowCount      int       `json:"dataRowCount"`
	FrameTimesMs      []float64 `json:"frameTimesMs"`
}

// ── Screenshot result ────────────────────────────────────────────────

// ScreenshotResult holds the output of a screenshot capture.
type ScreenshotResult struct {
	Format string `json:"format"` // ansi, html, png, text
	Data   string `json:"data"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

// ── Render targets ───────────────────────────────────────────────────

// RenderTarget describes where viewer output is sent.
type RenderTarget interface {
	TargetType() string
}

// AnsiTarget sends output to an ANSI terminal file descriptor.
type AnsiTarget struct {
	FD int `json:"fd"`
}

func (t AnsiTarget) TargetType() string { return "ansi" }

// FramebufferTarget sends output to a raw framebuffer pointer.
type FramebufferTarget struct {
	Ptr uintptr `json:"ptr"`
}

func (t FramebufferTarget) TargetType() string { return "framebuffer" }

// TextureTarget sends output to a GPU texture (wgpu surface).
type TextureTarget struct{}

func (t TextureTarget) TargetType() string { return "texture" }

// HeadlessTarget produces no visual output (for testing).
type HeadlessTarget struct{}

func (t HeadlessTarget) TargetType() string { return "headless" }

// HtmlTarget renders to a DOM element by ID.
type HtmlTarget struct {
	Container string `json:"container"`
}

func (t HtmlTarget) TargetType() string { return "html" }
