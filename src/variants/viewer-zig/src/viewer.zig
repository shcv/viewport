// viewer.zig — Embeddable viewer implementation.
//
// This is the main viewer struct implementing the EmbeddableViewer pattern.
// It maintains an in-memory render tree, produces text projections, and
// collects performance/state metrics.
//
// In headless mode (RenderTarget.headless), no actual rendering occurs.
// The viewer is designed for testing, CI, and MCP server usage.
//
// Architecture:
//   Socket viewer:    app -> serialize -> IPC -> deserialize -> viewer
//   Embeddable viewer: app -> viewer (direct function calls)

const std = @import("std");
const types = @import("types.zig");
const tree_mod = @import("tree.zig");
const text_proj = @import("text_projection.zig");
const wire = @import("wire.zig");
const Allocator = std.mem.Allocator;

const RenderTree = types.RenderTree;
const RenderNode = types.RenderNode;
const VNode = types.VNode;
const PatchOp = types.PatchOp;
const SlotValue = types.SlotValue;
const ComputedLayout = types.ComputedLayout;
const ViewerMetrics = types.ViewerMetrics;
const EnvInfo = types.EnvInfo;
const InputEvent = types.InputEvent;
const ProtocolMessage = types.ProtocolMessage;
const MessageType = types.MessageType;
const RenderTarget = types.RenderTarget;
const ScreenshotResult = types.ScreenshotResult;
const SchemaColumn = types.SchemaColumn;
const DataRow = types.DataRow;

// ── Internal metrics ───────────────────────────────────────────────

const InternalMetrics = struct {
    messages_processed: u64 = 0,
    bytes_received: u64 = 0,
    last_frame_time_ns: u64 = 0,
    peak_frame_time_ns: u64 = 0,
    tree_node_count: u32 = 0,
    tree_depth: u32 = 0,
    slot_count: u32 = 0,
    data_row_count: u32 = 0,
    patches_applied: u32 = 0,
    patches_failed: u32 = 0,
    frame_times_ns: std.ArrayList(u64),
    dirty: bool = false,

    fn init(allocator: Allocator) InternalMetrics {
        return .{
            .frame_times_ns = std.ArrayList(u64).init(allocator),
        };
    }

    fn deinit(self: *InternalMetrics) void {
        self.frame_times_ns.deinit();
    }

    fn reset(self: *InternalMetrics) void {
        self.messages_processed = 0;
        self.bytes_received = 0;
        self.last_frame_time_ns = 0;
        self.peak_frame_time_ns = 0;
        self.tree_node_count = 0;
        self.tree_depth = 0;
        self.slot_count = 0;
        self.data_row_count = 0;
        self.patches_applied = 0;
        self.patches_failed = 0;
        self.frame_times_ns.clearRetainingCapacity();
        self.dirty = false;
    }

    fn recordFrameTime(self: *InternalMetrics, elapsed_ns: u64) !void {
        try self.frame_times_ns.append(elapsed_ns);
        // Keep only the last 1000 frame times
        if (self.frame_times_ns.items.len > 1000) {
            const keep = 500;
            const discard = self.frame_times_ns.items.len - keep;
            std.mem.copyForwards(
                u64,
                self.frame_times_ns.items[0..keep],
                self.frame_times_ns.items[discard..],
            );
            self.frame_times_ns.shrinkRetainingCapacity(keep);
        }
        self.last_frame_time_ns = elapsed_ns;
        if (elapsed_ns > self.peak_frame_time_ns) {
            self.peak_frame_time_ns = elapsed_ns;
        }
    }
};

// ── Message handler callback ───────────────────────────────────────

pub const MessageHandler = *const fn (ctx: ?*anyopaque, msg: ProtocolMessage) void;

const HandlerEntry = struct {
    handler: MessageHandler,
    ctx: ?*anyopaque,
};

// ── Viewer ─────────────────────────────────────────────────────────

pub const Viewer = struct {
    allocator: Allocator,
    tree: RenderTree,
    metrics: InternalMetrics,
    env: ?EnvInfo,
    render_target: RenderTarget,
    message_handlers: std.ArrayList(HandlerEntry),

    /// Create a new viewer in headless mode.
    pub fn init(allocator: Allocator) Viewer {
        return initWithTarget(allocator, .{ .headless = {} });
    }

    /// Create a new viewer with a specific render target.
    pub fn initWithTarget(allocator: Allocator, target: RenderTarget) Viewer {
        return .{
            .allocator = allocator,
            .tree = RenderTree.init(allocator),
            .metrics = InternalMetrics.init(allocator),
            .env = null,
            .render_target = target,
            .message_handlers = std.ArrayList(HandlerEntry).init(allocator),
        };
    }

    /// Tear down the viewer, releasing all resources.
    pub fn deinit(self: *Viewer) void {
        self.tree.deinit();
        self.metrics.deinit();
        self.message_handlers.deinit();
    }

    // ── EmbeddableViewer: direct call methods ──────────────────────

    /// Initialize with environment info.
    pub fn initEnv(self: *Viewer, env: EnvInfo) void {
        self.env = env;
        self.tree.deinit();
        self.tree = RenderTree.init(self.allocator);
        self.metrics.reset();
    }

    /// Set the root tree directly (no serialization).
    pub fn setTree(self: *Viewer, root: VNode) !void {
        const timer = std.time.Timer.start() catch null;

        try tree_mod.setTreeRoot(&self.tree, root);

        self.metrics.messages_processed += 1;
        self.metrics.tree_node_count = tree_mod.countNodes(self.tree.root);
        self.metrics.tree_depth = tree_mod.treeDepth(self.tree.root);
        self.metrics.dirty = true;

        if (timer) |t| {
            const elapsed = t.read();
            self.metrics.recordFrameTime(elapsed) catch {};
        }
    }

    /// Apply patches directly.
    pub fn applyPatches(self: *Viewer, ops: []const PatchOp) !void {
        const timer = std.time.Timer.start() catch null;

        const result = try tree_mod.applyPatches(&self.tree, ops);
        self.metrics.patches_applied += result.applied;
        self.metrics.patches_failed += result.failed;
        self.metrics.messages_processed += 1;
        self.metrics.tree_node_count = tree_mod.countNodes(self.tree.root);
        self.metrics.tree_depth = tree_mod.treeDepth(self.tree.root);
        self.metrics.dirty = true;

        if (timer) |t| {
            const elapsed = t.read();
            self.metrics.recordFrameTime(elapsed) catch {};
        }
    }

    /// Define a slot directly.
    pub fn defineSlot(self: *Viewer, slot: u32, value: SlotValue) !void {
        try self.tree.slots.put(slot, value);
        self.metrics.slot_count = @intCast(self.tree.slots.count());
        self.metrics.messages_processed += 1;
    }

    /// Define a schema for structured data.
    pub fn defineSchema(self: *Viewer, slot: u32, columns: []const SchemaColumn) !void {
        const owned = try self.allocator.dupe(SchemaColumn, columns);
        // Free old if replacing
        if (self.tree.schemas.get(slot)) |old| {
            self.allocator.free(old);
        }
        try self.tree.schemas.put(slot, owned);
        self.metrics.messages_processed += 1;
    }

    /// Emit a data record.
    pub fn emitData(self: *Viewer, schema_slot: u32, row: DataRow) !void {
        const result = try self.tree.data_rows.getOrPut(schema_slot);
        if (!result.found_existing) {
            result.value_ptr.* = types.DataRowList.init(self.allocator);
        }
        try result.value_ptr.append(row);
        self.metrics.data_row_count += 1;
        self.metrics.messages_processed += 1;
    }

    /// Query a computed layout rectangle for a node.
    pub fn getLayout(self: *const Viewer, node_id: u32) ?ComputedLayout {
        const node = self.tree.node_index.get(node_id) orelse return null;
        return node.computed_layout;
    }

    /// Render to the target output. Returns whether anything changed.
    pub fn render(self: *Viewer) bool {
        const was_dirty = self.metrics.dirty;
        self.metrics.dirty = false;

        // In headless mode, rendering is a no-op
        switch (self.render_target) {
            .headless => {},
            .ansi => |_| {
                // TODO: ANSI terminal rendering
            },
            .framebuffer => |_| {
                // TODO: framebuffer rendering
            },
            .texture => {
                // TODO: GPU texture rendering
            },
            .html => |_| {
                // TODO: HTML rendering
            },
        }

        return was_dirty;
    }

    // ── ViewerBackend: protocol message interface ──────────────────

    /// Process a decoded protocol message, updating internal state.
    pub fn processMessage(self: *Viewer, msg: ProtocolMessage) !void {
        const timer = std.time.Timer.start() catch null;

        switch (msg) {
            .define => |m| {
                try self.tree.slots.put(m.slot, m.value);
                self.metrics.slot_count = @intCast(self.tree.slots.count());
            },
            .tree => |m| {
                try tree_mod.setTreeRoot(&self.tree, m.root);
                self.metrics.tree_node_count = tree_mod.countNodes(self.tree.root);
                self.metrics.tree_depth = tree_mod.treeDepth(self.tree.root);
            },
            .patch => |m| {
                const result = try tree_mod.applyPatches(&self.tree, m.ops);
                self.metrics.patches_applied += result.applied;
                self.metrics.patches_failed += result.failed;
                self.metrics.tree_node_count = tree_mod.countNodes(self.tree.root);
                self.metrics.tree_depth = tree_mod.treeDepth(self.tree.root);
            },
            .schema => |m| {
                const owned = try self.allocator.dupe(SchemaColumn, m.columns);
                if (self.tree.schemas.get(m.slot)) |old| {
                    self.allocator.free(old);
                }
                try self.tree.schemas.put(m.slot, owned);
            },
            .data => |m| {
                const schema_slot = m.schema_ref orelse 0;
                const result = try self.tree.data_rows.getOrPut(schema_slot);
                if (!result.found_existing) {
                    result.value_ptr.* = types.DataRowList.init(self.allocator);
                }
                try result.value_ptr.append(m.row);
                self.metrics.data_row_count += 1;
            },
            .input_msg => |m| {
                // Forward input to registered handlers
                for (self.message_handlers.items) |entry| {
                    entry.handler(entry.ctx, .{ .input_msg = m });
                }
            },
            .env => |m| {
                self.env = m.env_info;
            },
        }

        self.metrics.messages_processed += 1;
        self.metrics.dirty = true;

        if (timer) |t| {
            const elapsed = t.read();
            self.metrics.recordFrameTime(elapsed) catch {};
        }
    }

    /// Process a raw wire frame (header + CBOR payload).
    /// In embeddable mode, prefer using setTree/applyPatches directly.
    pub fn processFrame(self: *Viewer, frame_data: []const u8) !void {
        const frame = wire.decodeFrame(frame_data) orelse return error.InvalidFrame;
        self.metrics.bytes_received += frame_data.len;

        // TODO: CBOR decode the payload into a ProtocolMessage
        // For now, use the embeddable API (direct function calls) instead
        _ = frame;
        return error.CborNotImplemented;
    }

    // ── Query methods ──────────────────────────────────────────────

    /// Get the current render tree state.
    pub fn getTree(self: *const Viewer) *const RenderTree {
        return &self.tree;
    }

    /// Get the text projection of the current tree.
    /// Caller owns the returned string.
    pub fn getTextProjection(self: *const Viewer) ![]u8 {
        return try text_proj.textProjection(self.allocator, &self.tree);
    }

    /// Get the text projection with custom options.
    pub fn getTextProjectionWithOptions(
        self: *const Viewer,
        options: text_proj.TextProjectionOptions,
    ) ![]u8 {
        return try text_proj.textProjectionWithOptions(self.allocator, &self.tree, options);
    }

    /// Capture a text representation (headless screenshot).
    pub fn screenshot(self: *const Viewer) !ScreenshotResult {
        const text = try self.renderToAnsi();
        return .{
            .format = .ansi,
            .data = text,
            .width = if (self.env) |e| e.display_width else 800,
            .height = if (self.env) |e| e.display_height else 600,
        };
    }

    /// Get current performance/state metrics.
    pub fn getMetrics(self: *const Viewer) ViewerMetrics {
        const ft = self.metrics.frame_times_ns.items;
        var avg_ns: f64 = 0;
        if (ft.len > 0) {
            var sum: u64 = 0;
            for (ft) |t| sum += t;
            avg_ns = @as(f64, @floatFromInt(sum)) / @as(f64, @floatFromInt(ft.len));
        }

        return .{
            .messages_processed = self.metrics.messages_processed,
            .bytes_received = self.metrics.bytes_received,
            .last_frame_time_ms = @as(f64, @floatFromInt(self.metrics.last_frame_time_ns)) / 1_000_000.0,
            .peak_frame_time_ms = @as(f64, @floatFromInt(self.metrics.peak_frame_time_ns)) / 1_000_000.0,
            .avg_frame_time_ms = avg_ns / 1_000_000.0,
            .memory_usage_bytes = self.estimateMemory(),
            .tree_node_count = self.metrics.tree_node_count,
            .tree_depth = self.metrics.tree_depth,
            .slot_count = self.metrics.slot_count,
            .data_row_count = self.metrics.data_row_count,
        };
    }

    // ── Input injection ────────────────────────────────────────────

    /// Inject an input event (for automation).
    pub fn sendInput(self: *Viewer, event: InputEvent) void {
        const msg = ProtocolMessage{ .input_msg = .{ .event = event } };
        for (self.message_handlers.items) |entry| {
            entry.handler(entry.ctx, msg);
        }
    }

    /// Register a callback for outbound messages.
    pub fn onMessage(self: *Viewer, handler: MessageHandler, ctx: ?*anyopaque) !void {
        try self.message_handlers.append(.{ .handler = handler, .ctx = ctx });
    }

    // ── Byte tracking ──────────────────────────────────────────────

    /// Track bytes for metrics (called by harness).
    pub fn trackBytes(self: *Viewer, n: u64) void {
        self.metrics.bytes_received += n;
    }

    // ── Internal helpers ───────────────────────────────────────────

    /// Render the tree to a simple ANSI text representation.
    fn renderToAnsi(self: *const Viewer) ![]u8 {
        if (self.tree.root == null) {
            return try self.allocator.dupe(u8, "(empty tree)");
        }

        var lines = std.ArrayList([]u8).init(self.allocator);
        defer {
            for (lines.items) |line| self.allocator.free(line);
            lines.deinit();
        }

        try renderNodeAnsi(self.allocator, self.tree.root.?, &lines, 0);

        // Join lines with newline
        return try joinOwned(self.allocator, lines.items, "\n");
    }

    /// Rough memory estimate for the tree.
    fn estimateMemory(self: *const Viewer) u64 {
        var bytes: u64 = 0;
        // Rough per-node estimate: 200 bytes for props + overhead
        bytes += @as(u64, self.metrics.tree_node_count) * 200;
        // Slots
        bytes += @as(u64, self.metrics.slot_count) * 100;
        // Data rows
        bytes += @as(u64, self.metrics.data_row_count) * 50;
        // Index map overhead
        bytes += @as(u64, @intCast(self.tree.node_index.count())) * 32;
        return bytes;
    }
};

/// Render a single node to ANSI lines.
fn renderNodeAnsi(
    allocator: Allocator,
    node: *const RenderNode,
    lines: *std.ArrayList([]u8),
    depth: u32,
) !void {
    const indent = try allocator.alloc(u8, depth * 2);
    defer allocator.free(indent);
    @memset(indent, ' ');

    const line = switch (node.node_type) {
        .text => try std.fmt.allocPrint(allocator, "{s}{s}", .{
            indent,
            node.props.content orelse "",
        }),
        .box => try std.fmt.allocPrint(allocator, "{s}[box#{d} {s}]", .{
            indent,
            node.id,
            if (node.props.direction) |d|
                (if (d == .row) "row" else "col")
            else
                "col",
        }),
        .scroll => try std.fmt.allocPrint(allocator, "{s}[scroll#{d}]", .{
            indent,
            node.id,
        }),
        .input => try std.fmt.allocPrint(allocator, "{s}[input#{d}: {s}]", .{
            indent,
            node.id,
            node.props.value orelse (node.props.placeholder orelse ""),
        }),
        .separator => try std.fmt.allocPrint(allocator, "{s}" ++ text_proj.SEPARATOR_LINE, .{indent}),
        .canvas => try std.fmt.allocPrint(allocator, "{s}[canvas#{d}: {s}]", .{
            indent,
            node.id,
            node.props.alt_text orelse "",
        }),
        .image => try std.fmt.allocPrint(allocator, "{s}[image#{d}: {s}]", .{
            indent,
            node.id,
            node.props.alt_text orelse "",
        }),
    };
    try lines.append(line);

    for (node.children.items) |child| {
        try renderNodeAnsi(allocator, child, lines, depth + 1);
    }
}

/// Join owned slices with a separator, returning a new owned slice.
fn joinOwned(allocator: Allocator, slices: []const []u8, sep: []const u8) ![]u8 {
    if (slices.len == 0) return try allocator.alloc(u8, 0);

    var total: usize = 0;
    for (slices, 0..) |s, i| {
        total += s.len;
        if (i > 0) total += sep.len;
    }

    const result = try allocator.alloc(u8, total);
    var pos: usize = 0;

    for (slices, 0..) |s, i| {
        if (i > 0) {
            @memcpy(result[pos .. pos + sep.len], sep);
            pos += sep.len;
        }
        @memcpy(result[pos .. pos + s.len], s);
        pos += s.len;
    }

    return result;
}

// ── Viewer errors ──────────────────────────────────────────────────

pub const ViewerError = error{
    InvalidFrame,
    CborNotImplemented,
    OutOfMemory,
};

// ── Tests ──────────────────────────────────────────────────────────

test "Viewer init and deinit" {
    const allocator = std.testing.allocator;
    var viewer = Viewer.init(allocator);
    defer viewer.deinit();

    try std.testing.expect(viewer.tree.root == null);
    try std.testing.expect(viewer.env == null);
}

test "Viewer setTree and getTextProjection" {
    const allocator = std.testing.allocator;
    var viewer = Viewer.init(allocator);
    defer viewer.deinit();

    var children = [_]VNode{
        .{ .id = 2, .node_type = .text, .props = .{ .content = "Count: 0" }, .children = &.{} },
        .{ .id = 3, .node_type = .text, .props = .{ .content = "+" }, .children = &.{} },
    };
    const root = VNode{
        .id = 1,
        .node_type = .box,
        .props = .{ .direction = .column },
        .children = &children,
    };

    try viewer.setTree(root);

    const text = try viewer.getTextProjection();
    defer allocator.free(text);

    try std.testing.expectEqualStrings("Count: 0\n+", text);
}

test "Viewer applyPatches" {
    const allocator = std.testing.allocator;
    var viewer = Viewer.init(allocator);
    defer viewer.deinit();

    var children = [_]VNode{
        .{ .id = 2, .node_type = .text, .props = .{ .content = "Count: 0" }, .children = &.{} },
    };
    const root = VNode{
        .id = 1,
        .node_type = .box,
        .props = .{},
        .children = &children,
    };
    try viewer.setTree(root);

    const ops = [_]PatchOp{
        .{ .target = 2, .set = .{ .content = "Count: 1" } },
    };
    try viewer.applyPatches(&ops);

    const text = try viewer.getTextProjection();
    defer allocator.free(text);

    try std.testing.expectEqualStrings("Count: 1", text);
}

test "Viewer defineSlot" {
    const allocator = std.testing.allocator;
    var viewer = Viewer.init(allocator);
    defer viewer.deinit();

    try viewer.defineSlot(1, .{ .color = .{ .role = "primary", .value = "#ff0000" } });

    const m = viewer.getMetrics();
    try std.testing.expectEqual(@as(u32, 1), m.slot_count);
}

test "Viewer render returns dirty state" {
    const allocator = std.testing.allocator;
    var viewer = Viewer.init(allocator);
    defer viewer.deinit();

    // Initially not dirty
    try std.testing.expect(!viewer.render());

    // Set tree makes it dirty
    const root = VNode{
        .id = 1,
        .node_type = .text,
        .props = .{ .content = "hello" },
        .children = &.{},
    };
    try viewer.setTree(root);
    try std.testing.expect(viewer.render());

    // After render, no longer dirty
    try std.testing.expect(!viewer.render());
}

test "Viewer metrics" {
    const allocator = std.testing.allocator;
    var viewer = Viewer.init(allocator);
    defer viewer.deinit();

    var children = [_]VNode{
        .{ .id = 2, .node_type = .text, .props = .{ .content = "a" }, .children = &.{} },
        .{ .id = 3, .node_type = .text, .props = .{ .content = "b" }, .children = &.{} },
    };
    const root = VNode{
        .id = 1,
        .node_type = .box,
        .props = .{},
        .children = &children,
    };
    try viewer.setTree(root);

    const m = viewer.getMetrics();
    try std.testing.expectEqual(@as(u64, 1), m.messages_processed);
    try std.testing.expectEqual(@as(u32, 3), m.tree_node_count);
    try std.testing.expectEqual(@as(u32, 2), m.tree_depth);
}

test "Viewer screenshot" {
    const allocator = std.testing.allocator;
    var viewer = Viewer.init(allocator);
    defer viewer.deinit();

    const root = VNode{
        .id = 1,
        .node_type = .text,
        .props = .{ .content = "Hello" },
        .children = &.{},
    };
    try viewer.setTree(root);

    const ss = try viewer.screenshot();
    defer allocator.free(ss.data);

    try std.testing.expectEqualStrings("Hello", ss.data);
    try std.testing.expectEqual(types.ScreenshotFormat.ansi, ss.format);
}

test "Viewer initEnv resets state" {
    const allocator = std.testing.allocator;
    var viewer = Viewer.init(allocator);
    defer viewer.deinit();

    // Set up some state
    const root = VNode{
        .id = 1,
        .node_type = .text,
        .props = .{ .content = "hello" },
        .children = &.{},
    };
    try viewer.setTree(root);

    // Re-initialize with env
    viewer.initEnv(.{
        .display_width = 1920,
        .display_height = 1080,
    });

    try std.testing.expect(viewer.tree.root == null);
    try std.testing.expect(viewer.env != null);
    try std.testing.expectEqual(@as(u32, 1920), viewer.env.?.display_width);
}

test "Viewer processMessage tree" {
    const allocator = std.testing.allocator;
    var viewer = Viewer.init(allocator);
    defer viewer.deinit();

    const msg = ProtocolMessage{
        .tree = .{
            .root = .{
                .id = 1,
                .node_type = .text,
                .props = .{ .content = "via message" },
                .children = &.{},
            },
        },
    };

    try viewer.processMessage(msg);

    const text = try viewer.getTextProjection();
    defer allocator.free(text);

    try std.testing.expectEqualStrings("via message", text);
}

test "Viewer sendInput dispatches to handlers" {
    const allocator = std.testing.allocator;
    var viewer = Viewer.init(allocator);
    defer viewer.deinit();

    const Context = struct {
        received: bool = false,
        fn handler(ctx_ptr: ?*anyopaque, _: ProtocolMessage) void {
            const self: *@This() = @ptrCast(@alignCast(ctx_ptr));
            self.received = true;
        }
    };

    var ctx = Context{};
    try viewer.onMessage(Context.handler, &ctx);

    viewer.sendInput(.{ .kind = .click, .target = 1 });

    try std.testing.expect(ctx.received);
}

test "Viewer trackBytes" {
    const allocator = std.testing.allocator;
    var viewer = Viewer.init(allocator);
    defer viewer.deinit();

    viewer.trackBytes(100);
    viewer.trackBytes(50);

    const m = viewer.getMetrics();
    try std.testing.expectEqual(@as(u64, 150), m.bytes_received);
}

test "Viewer getLayout returns null for unknown node" {
    const allocator = std.testing.allocator;
    var viewer = Viewer.init(allocator);
    defer viewer.deinit();

    try std.testing.expect(viewer.getLayout(999) == null);
}
