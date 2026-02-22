// types.zig — Core Viewport protocol types.
//
// These types mirror the TypeScript definitions in src/core/types.ts
// and form the shared language between apps, protocol backends, viewers,
// and the test harness.

const std = @import("std");
const Allocator = std.mem.Allocator;

// ── Wire format constants ──────────────────────────────────────────

pub const MAGIC: u16 = 0x5650; // ASCII 'VP'
pub const PROTOCOL_VERSION: u8 = 1;

// ── Message types ──────────────────────────────────────────────────

pub const MessageType = enum(u8) {
    define = 0x01,
    tree = 0x02,
    patch = 0x03,
    data = 0x04,
    input = 0x05,
    env = 0x06,
    region = 0x07,
    audio = 0x08,
    canvas = 0x09,
    schema = 0x0a,
};

// ── Frame header ───────────────────────────────────────────────────

pub const FrameHeader = struct {
    magic: u16,
    version: u8,
    msg_type: MessageType,
    length: u32, // payload size in bytes (LE)
};

// ── Node types ─────────────────────────────────────────────────────

pub const NodeType = enum {
    box,
    text,
    scroll,
    input,
    image,
    canvas,
    separator,

    pub fn toString(self: NodeType) []const u8 {
        return switch (self) {
            .box => "box",
            .text => "text",
            .scroll => "scroll",
            .input => "input",
            .image => "image",
            .canvas => "canvas",
            .separator => "separator",
        };
    }

    pub fn fromString(s: []const u8) ?NodeType {
        const map = std.StaticStringMap(NodeType).initComptime(.{
            .{ "box", .box },
            .{ "text", .text },
            .{ "scroll", .scroll },
            .{ "input", .input },
            .{ "image", .image },
            .{ "canvas", .canvas },
            .{ "separator", .separator },
        });
        return map.get(s);
    }
};

// ── Enums for node properties ──────────────────────────────────────

pub const Direction = enum {
    row,
    column,
};

pub const Justify = enum {
    start,
    end,
    center,
    between,
    around,
    evenly,
};

pub const Align = enum {
    start,
    end,
    center,
    stretch,
    baseline,
};

pub const FontFamily = enum {
    proportional,
    monospace,
};

pub const FontWeight = enum {
    normal,
    bold,
    light,
};

pub const TextDecoration = enum {
    none,
    underline,
    strikethrough,
};

pub const TextAlign = enum {
    left,
    center,
    right,
};

pub const BorderStyleType = enum {
    solid,
    dashed,
    dotted,
    none,
};

pub const ImageFormat = enum {
    png,
    jpeg,
    svg,
};

pub const CanvasMode = enum {
    vector2d,
    webgpu,
    remote_stream,
};

pub const Interactive = enum {
    clickable,
    focusable,
};

// ── Spacing: uniform, 2-axis, or 4-sided ──────────────────────────

pub const Spacing = union(enum) {
    uniform: f32,
    axis: [2]f32, // [vertical, horizontal]
    sides: [4]f32, // [top, right, bottom, left]
};

// ── Dimension: number or string (e.g. "50%", "auto") ──────────────

pub const Dimension = union(enum) {
    number: f32,
    string: []const u8,
};

// ── Border style ───────────────────────────────────────────────────

pub const BorderStyle = struct {
    width: ?f32 = null,
    color: ?[]const u8 = null,
    style: ?BorderStyleType = null,
};

// ── Shadow style ───────────────────────────────────────────────────

pub const ShadowStyle = struct {
    x: f32 = 0,
    y: f32 = 0,
    blur: f32 = 0,
    color: []const u8 = "",
};

// ── NodeProps: union of all possible node properties ───────────────
//
// Which fields are relevant depends on the node type. Nullable fields
// use optionals so the wire format can omit them.

pub const NodeProps = struct {
    // Box layout
    direction: ?Direction = null,
    wrap: ?bool = null,
    justify: ?Justify = null,
    @"align": ?Align = null,
    gap: ?f32 = null,

    // Spacing
    padding: ?Spacing = null,
    margin: ?Spacing = null,

    // Visual
    border: ?BorderStyle = null,
    border_radius: ?f32 = null,
    background: ?[]const u8 = null,
    opacity: ?f32 = null,
    shadow: ?ShadowStyle = null,

    // Sizing
    width: ?Dimension = null,
    height: ?Dimension = null,
    flex: ?f32 = null,
    min_width: ?f32 = null,
    min_height: ?f32 = null,
    max_width: ?f32 = null,
    max_height: ?f32 = null,

    // Text
    content: ?[]const u8 = null,
    font_family: ?FontFamily = null,
    size: ?f32 = null,
    weight: ?FontWeight = null,
    color: ?[]const u8 = null,
    decoration: ?TextDecoration = null,
    text_align: ?TextAlign = null,
    italic: ?bool = null,

    // Scroll
    virtual_height: ?f32 = null,
    virtual_width: ?f32 = null,
    scroll_top: ?f32 = null,
    scroll_left: ?f32 = null,
    template: ?u32 = null, // slot ref for row template

    // Input
    value: ?[]const u8 = null,
    placeholder: ?[]const u8 = null,
    multiline: ?bool = null,
    disabled: ?bool = null,

    // Image
    data: ?[]const u8 = null,
    format: ?ImageFormat = null,
    alt_text: ?[]const u8 = null,

    // Canvas
    mode: ?CanvasMode = null,

    // Interactive behaviors
    interactive: ?Interactive = null,
    tab_index: ?i32 = null,

    // Style slot reference
    style: ?u32 = null,

    // Transition reference
    transition: ?u32 = null,

    // Text projection override
    text_alt: ?[]const u8 = null,
};

// ── VNode: the virtual node tree apps produce ──────────────────────

pub const VNode = struct {
    id: u32,
    node_type: NodeType,
    props: NodeProps,
    children: []VNode,
    text_alt: ?[]const u8 = null,
};

// ── Computed layout ────────────────────────────────────────────────

pub const ComputedLayout = struct {
    x: f32 = 0,
    y: f32 = 0,
    width: f32 = 0,
    height: f32 = 0,
};

// ── RenderNode: materialized node in the viewer ────────────────────

pub const RenderNode = struct {
    id: u32,
    node_type: NodeType,
    props: NodeProps,
    children: std.ArrayList(*RenderNode),
    computed_layout: ?ComputedLayout,
    allocator: Allocator,

    pub fn init(allocator: Allocator, id: u32, node_type: NodeType, props: NodeProps) RenderNode {
        return .{
            .id = id,
            .node_type = node_type,
            .props = props,
            .children = std.ArrayList(*RenderNode).init(allocator),
            .computed_layout = null,
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *RenderNode) void {
        for (self.children.items) |child| {
            child.deinit();
            self.allocator.destroy(child);
        }
        self.children.deinit();
    }

    pub fn addChild(self: *RenderNode, child: *RenderNode) !void {
        try self.children.append(child);
    }

    pub fn removeChildAt(self: *RenderNode, index: usize) ?*RenderNode {
        if (index >= self.children.items.len) return null;
        return self.children.orderedRemove(index);
    }

    pub fn insertChildAt(self: *RenderNode, index: usize, child: *RenderNode) !void {
        const clamped = @min(index, self.children.items.len);
        try self.children.insert(clamped, child);
    }
};

// ── RenderTree: the complete viewer state ──────────────────────────

pub const RenderTree = struct {
    root: ?*RenderNode,
    slots: std.AutoHashMap(u32, SlotValue),
    schemas: std.AutoHashMap(u32, SchemaColumns),
    data_rows: std.AutoHashMap(u32, DataRowList),
    node_index: std.AutoHashMap(u32, *RenderNode),
    allocator: Allocator,

    pub fn init(allocator: Allocator) RenderTree {
        return .{
            .root = null,
            .slots = std.AutoHashMap(u32, SlotValue).init(allocator),
            .schemas = std.AutoHashMap(u32, SchemaColumns).init(allocator),
            .data_rows = std.AutoHashMap(u32, DataRowList).init(allocator),
            .node_index = std.AutoHashMap(u32, *RenderNode).init(allocator),
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *RenderTree) void {
        if (self.root) |root| {
            root.deinit();
            self.allocator.destroy(root);
        }
        self.slots.deinit();

        // Free schema column slices
        var schema_iter = self.schemas.valueIterator();
        while (schema_iter.next()) |cols| {
            self.allocator.free(cols.*);
        }
        self.schemas.deinit();

        // Free data row lists
        var data_iter = self.data_rows.valueIterator();
        while (data_iter.next()) |rows| {
            rows.deinit();
        }
        self.data_rows.deinit();

        self.node_index.deinit();
    }
};

// ── Schema ─────────────────────────────────────────────────────────

pub const ColumnType = enum {
    string,
    uint64,
    int64,
    float64,
    bool,
    timestamp,

    pub fn toString(self: ColumnType) []const u8 {
        return switch (self) {
            .string => "string",
            .uint64 => "uint64",
            .int64 => "int64",
            .float64 => "float64",
            .bool => "bool",
            .timestamp => "timestamp",
        };
    }
};

pub const SchemaColumn = struct {
    id: u32,
    name: []const u8,
    col_type: ColumnType,
    unit: ?[]const u8 = null,
    format: ?[]const u8 = null,
};

pub const SchemaColumns = []SchemaColumn;

// ── Data value: dynamically typed cell value ───────────────────────

pub const DataValue = union(enum) {
    string: []const u8,
    int: i64,
    uint: u64,
    float: f64,
    boolean: bool,
    null_val: void,
};

pub const DataRow = []DataValue;
pub const DataRowList = std.ArrayList(DataRow);

// ── Slot values ────────────────────────────────────────────────────

pub const SlotKind = enum {
    style,
    color,
    keybind,
    transition,
    text_size,
    schema,
    row_template,
    other,
};

pub const SlotValue = union(enum) {
    style: StyleSlot,
    color: ColorSlot,
    keybind: KeybindSlot,
    transition: TransitionSlot,
    text_size: TextSizeSlot,
    schema: SchemaSlotValue,
    row_template: RowTemplateSlot,
    other: OtherSlot,
};

pub const StyleSlot = struct {
    // Style slots contain arbitrary key/value pairs; for now store raw bytes
    raw: ?[]const u8 = null,
};

pub const ColorSlot = struct {
    role: []const u8,
    value: []const u8,
};

pub const KeybindSlot = struct {
    action: []const u8,
    key: []const u8,
};

pub const TransitionSlot = struct {
    role: []const u8,
    duration_ms: u32,
    easing: []const u8,
};

pub const TextSizeSlot = struct {
    role: []const u8,
    value: f32,
};

pub const SchemaSlotValue = struct {
    columns: []SchemaColumn,
};

pub const RowTemplateSlot = struct {
    schema_ref: u32, // slot ref
    // layout is a VNode tree but we store it opaquely for now
    layout_raw: ?[]const u8 = null,
};

pub const OtherSlot = struct {
    kind_name: []const u8,
    raw: ?[]const u8 = null,
};

// ── Patch operations ───────────────────────────────────────────────

pub const ChildInsert = struct {
    index: u32,
    node: VNode,
};

pub const ChildRemove = struct {
    index: u32,
};

pub const ChildMove = struct {
    from: u32,
    to: u32,
};

pub const PatchOp = struct {
    target: u32,
    set: ?NodeProps = null,
    children_insert: ?ChildInsert = null,
    children_remove: ?ChildRemove = null,
    children_move: ?ChildMove = null,
    remove: bool = false,
    replace: ?VNode = null,
    transition_ref: ?u32 = null,
};

// ── Input events ───────────────────────────────────────────────────

pub const InputKind = enum {
    click,
    hover,
    focus,
    blur,
    key,
    value_change,
    canvas_pointer,
    canvas_key,
    scroll,

    pub fn toString(self: InputKind) []const u8 {
        return switch (self) {
            .click => "click",
            .hover => "hover",
            .focus => "focus",
            .blur => "blur",
            .key => "key",
            .value_change => "value_change",
            .canvas_pointer => "canvas_pointer",
            .canvas_key => "canvas_key",
            .scroll => "scroll",
        };
    }
};

pub const InputEvent = struct {
    target: ?u32 = null,
    kind: InputKind,
    key_name: ?[]const u8 = null,
    value: ?[]const u8 = null,
    x: ?f32 = null,
    y: ?f32 = null,
    button: ?u32 = null,
    action: ?[]const u8 = null,
    scroll_top: ?f32 = null,
    scroll_left: ?f32 = null,
};

// ── Environment info ───────────────────────────────────────────────

pub const EnvInfo = struct {
    viewport_version: u32 = 1,
    display_width: u32 = 800,
    display_height: u32 = 600,
    pixel_density: f32 = 1.0,
    gpu: bool = false,
    gpu_api: ?[]const u8 = null,
    color_depth: u32 = 24,
    video_decode: ?[]const []const u8 = null,
    remote: bool = false,
    latency_ms: f32 = 0,
};

// ── Protocol messages ──────────────────────────────────────────────

pub const ProtocolMessage = union(enum) {
    define: DefineMessage,
    tree: TreeMessage,
    patch: PatchMessage,
    data: DataMessage,
    input_msg: InputMessage,
    env: EnvMessage,
    schema: SchemaMessage,

    pub fn messageType(self: ProtocolMessage) MessageType {
        return switch (self) {
            .define => .define,
            .tree => .tree,
            .patch => .patch,
            .data => .data,
            .input_msg => .input,
            .env => .env,
            .schema => .schema,
        };
    }
};

pub const DefineMessage = struct {
    slot: u32,
    value: SlotValue,
};

pub const TreeMessage = struct {
    root: VNode,
};

pub const PatchMessage = struct {
    ops: []PatchOp,
};

pub const DataMessage = struct {
    schema_ref: ?u32 = null,
    row: DataRow,
};

pub const InputMessage = struct {
    event: InputEvent,
};

pub const EnvMessage = struct {
    env_info: EnvInfo,
};

pub const SchemaMessage = struct {
    slot: u32,
    columns: []SchemaColumn,
};

// ── Viewer metrics ─────────────────────────────────────────────────

pub const ViewerMetrics = struct {
    messages_processed: u64 = 0,
    bytes_received: u64 = 0,
    last_frame_time_ms: f64 = 0,
    peak_frame_time_ms: f64 = 0,
    avg_frame_time_ms: f64 = 0,
    memory_usage_bytes: u64 = 0,
    tree_node_count: u32 = 0,
    tree_depth: u32 = 0,
    slot_count: u32 = 0,
    data_row_count: u32 = 0,
};

// ── Render target ──────────────────────────────────────────────────

pub const RenderTarget = union(enum) {
    ansi: AnsiTarget,
    framebuffer: FramebufferTarget,
    texture: void,
    headless: void,
    html: HtmlTarget,
};

pub const AnsiTarget = struct {
    fd: i32,
};

pub const FramebufferTarget = struct {
    ptr: usize,
};

pub const HtmlTarget = struct {
    container: []const u8,
};

// ── Screenshot result ──────────────────────────────────────────────

pub const ScreenshotFormat = enum {
    ansi,
    html,
    png,
    text,
};

pub const ScreenshotResult = struct {
    format: ScreenshotFormat,
    data: []const u8,
    width: u32,
    height: u32,
};

// ── Tests ──────────────────────────────────────────────────────────

test "NodeType roundtrip" {
    const types_to_test = [_]NodeType{ .box, .text, .scroll, .input, .image, .canvas, .separator };
    for (types_to_test) |nt| {
        const s = nt.toString();
        const parsed = NodeType.fromString(s);
        try std.testing.expectEqual(nt, parsed.?);
    }
}

test "FrameHeader size" {
    // The wire header is 8 bytes: 2 magic + 1 version + 1 type + 4 length
    try std.testing.expectEqual(@as(u16, 0x5650), MAGIC);
    try std.testing.expectEqual(@as(u8, 1), PROTOCOL_VERSION);
}

test "default NodeProps" {
    const props = NodeProps{};
    try std.testing.expect(props.direction == null);
    try std.testing.expect(props.content == null);
    try std.testing.expect(props.value == null);
}

test "MessageType values" {
    try std.testing.expectEqual(@as(u8, 0x01), @intFromEnum(MessageType.define));
    try std.testing.expectEqual(@as(u8, 0x02), @intFromEnum(MessageType.tree));
    try std.testing.expectEqual(@as(u8, 0x03), @intFromEnum(MessageType.patch));
    try std.testing.expectEqual(@as(u8, 0x04), @intFromEnum(MessageType.data));
    try std.testing.expectEqual(@as(u8, 0x05), @intFromEnum(MessageType.input));
    try std.testing.expectEqual(@as(u8, 0x06), @intFromEnum(MessageType.env));
    try std.testing.expectEqual(@as(u8, 0x0a), @intFromEnum(MessageType.schema));
}

test "RenderNode init and deinit" {
    const allocator = std.testing.allocator;
    var node = RenderNode.init(allocator, 1, .text, .{ .content = "hello" });
    defer node.deinit();

    try std.testing.expectEqual(@as(u32, 1), node.id);
    try std.testing.expectEqual(NodeType.text, node.node_type);
    try std.testing.expectEqualStrings("hello", node.props.content.?);
    try std.testing.expectEqual(@as(usize, 0), node.children.items.len);
}

test "RenderTree init and deinit" {
    const allocator = std.testing.allocator;
    var tree = RenderTree.init(allocator);
    defer tree.deinit();

    try std.testing.expect(tree.root == null);
    try std.testing.expectEqual(@as(u32, 0), tree.node_index.count());
}
