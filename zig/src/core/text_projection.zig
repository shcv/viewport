// text_projection.zig — Text projection engine.
//
// Every Viewport node has a well-defined text projection rule.
// This module computes the text representation of a render tree,
// matching the rules from viewport-design.md section 4.7 and the
// TypeScript reference in src/core/text-projection.ts.

const std = @import("std");
const types = @import("types.zig");
const tree_mod = @import("tree.zig");
const Allocator = std.mem.Allocator;

const RenderNode = types.RenderNode;
const RenderTree = types.RenderTree;
const NodeType = types.NodeType;
const SchemaColumn = types.SchemaColumn;
const DataRow = types.DataRow;

// ── Public API ─────────────────────────────────────────────────────

pub const TextProjectionOptions = struct {
    /// Separator between row-direction box children.
    row_separator: []const u8 = "\t",
    /// Separator between column-direction box children.
    column_separator: []const u8 = "\n",
    /// Whether to include scroll content beyond visible range.
    full_scroll_content: bool = true,
    /// Maximum width for wrapping (0 = no wrap).
    max_width: u32 = 0,
    /// Indent depth per level for nested boxes.
    indent_size: u32 = 0,
};

const default_options = TextProjectionOptions{};

/// Separator line used for separator nodes (16 horizontal box-drawing chars).
pub const SEPARATOR_LINE = "\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80";

/// Compute the text projection of an entire render tree.
/// Returns an owned string that the caller must free.
pub fn textProjection(allocator: Allocator, render_tree: *const RenderTree) ![]u8 {
    return textProjectionWithOptions(allocator, render_tree, default_options);
}

/// Compute the text projection with custom options.
pub fn textProjectionWithOptions(
    allocator: Allocator,
    render_tree: *const RenderTree,
    options: TextProjectionOptions,
) ![]u8 {
    const root = render_tree.root orelse return try allocator.alloc(u8, 0);
    return try projectNode(allocator, root, render_tree, options, 0);
}

/// Compute the text projection of a single node.
/// Returns an owned string that the caller must free.
pub fn projectNode(
    allocator: Allocator,
    node: *const RenderNode,
    render_tree: *const RenderTree,
    options: TextProjectionOptions,
    depth: u32,
) ![]u8 {
    // Check for explicit text_alt override
    if (node.props.text_alt) |alt| {
        return try allocator.dupe(u8, alt);
    }

    // Compute indent
    const indent = if (options.indent_size > 0)
        try makeIndent(allocator, depth * options.indent_size)
    else
        try allocator.alloc(u8, 0);
    defer allocator.free(indent);

    return switch (node.node_type) {
        .text => try projectText(allocator, node, indent),
        .box => try projectBox(allocator, node, render_tree, options, depth),
        .scroll => try projectScroll(allocator, node, render_tree, options, depth),
        .input => try projectInput(allocator, node, indent),
        .image, .canvas => try projectImage(allocator, node, indent),
        .separator => try projectSeparator(allocator, indent),
    };
}

// ── Per-node-type projection helpers ───────────────────────────────

fn projectText(allocator: Allocator, node: *const RenderNode, indent: []const u8) ![]u8 {
    const content = node.props.content orelse "";
    return try std.fmt.allocPrint(allocator, "{s}{s}", .{ indent, content });
}

fn projectBox(
    allocator: Allocator,
    node: *const RenderNode,
    render_tree: *const RenderTree,
    options: TextProjectionOptions,
    depth: u32,
) ![]u8 {
    const dir = node.props.direction orelse .column;
    const sep = if (dir == .row) options.row_separator else options.column_separator;

    // Collect child text projections
    var parts = std.ArrayList([]u8).init(allocator);
    defer {
        for (parts.items) |part| allocator.free(part);
        parts.deinit();
    }

    for (node.children.items) |child| {
        const child_text = try projectNode(allocator, child, render_tree, options, depth + 1);
        if (child_text.len > 0) {
            try parts.append(child_text);
        } else {
            allocator.free(child_text);
        }
    }

    return try joinSlices(allocator, parts.items, sep);
}

fn projectScroll(
    allocator: Allocator,
    node: *const RenderNode,
    render_tree: *const RenderTree,
    options: TextProjectionOptions,
    depth: u32,
) ![]u8 {
    var parts = std.ArrayList([]u8).init(allocator);
    defer {
        for (parts.items) |part| allocator.free(part);
        parts.deinit();
    }

    // Project child nodes
    for (node.children.items) |child| {
        const child_text = try projectNode(allocator, child, render_tree, options, depth + 1);
        if (child_text.len > 0) {
            try parts.append(child_text);
        } else {
            allocator.free(child_text);
        }
    }

    // If the scroll has a template and data rows, project those too
    if (node.props.template) |template_ref| {
        if (render_tree.slots.get(template_ref)) |slot_val| {
            switch (slot_val) {
                .row_template => |tmpl| {
                    if (render_tree.data_rows.get(tmpl.schema_ref)) |rows| {
                        if (render_tree.schemas.get(tmpl.schema_ref)) |schema| {
                            const data_text = try projectDataRows(allocator, rows.items, schema);
                            if (data_text.len > 0) {
                                try parts.append(data_text);
                            } else {
                                allocator.free(data_text);
                            }
                        }
                    }
                },
                else => {},
            }
        }
    }

    return try joinSlices(allocator, parts.items, "\n");
}

fn projectInput(allocator: Allocator, node: *const RenderNode, indent: []const u8) ![]u8 {
    const display = node.props.value orelse (node.props.placeholder orelse "");
    return try std.fmt.allocPrint(allocator, "{s}{s}", .{ indent, display });
}

fn projectImage(allocator: Allocator, node: *const RenderNode, indent: []const u8) ![]u8 {
    const alt = node.props.alt_text orelse "[image]";
    return try std.fmt.allocPrint(allocator, "{s}{s}", .{ indent, alt });
}

fn projectSeparator(allocator: Allocator, indent: []const u8) ![]u8 {
    return try std.fmt.allocPrint(allocator, "{s}" ++ SEPARATOR_LINE, .{indent});
}

// ── Data row projection ────────────────────────────────────────────

/// Project data rows as a TSV-like table with a header line.
fn projectDataRows(allocator: Allocator, rows: []const DataRow, schema: []const SchemaColumn) ![]u8 {
    if (rows.len == 0) return try allocator.alloc(u8, 0);

    var lines = std.ArrayList([]u8).init(allocator);
    defer {
        for (lines.items) |line| allocator.free(line);
        lines.deinit();
    }

    // Header
    {
        var header_parts = std.ArrayList([]u8).init(allocator);
        defer {
            for (header_parts.items) |p| allocator.free(p);
            header_parts.deinit();
        }
        for (schema) |col| {
            try header_parts.append(try allocator.dupe(u8, col.name));
        }
        try lines.append(try joinSlices(allocator, header_parts.items, "\t"));
    }

    // Data rows
    for (rows) |row| {
        var cells = std.ArrayList([]u8).init(allocator);
        defer {
            for (cells.items) |c| allocator.free(c);
            cells.deinit();
        }
        for (schema, 0..) |col, i| {
            if (i < row.len) {
                try cells.append(try formatValue(allocator, row[i], col));
            } else {
                try cells.append(try allocator.dupe(u8, ""));
            }
        }
        try lines.append(try joinSlices(allocator, cells.items, "\t"));
    }

    return try joinSlices(allocator, lines.items, "\n");
}

/// Format a data value for text projection.
fn formatValue(allocator: Allocator, value: types.DataValue, column: SchemaColumn) ![]u8 {
    switch (value) {
        .null_val => return try allocator.dupe(u8, ""),
        .string => |s| return try allocator.dupe(u8, s),
        .int => |n| {
            if (column.format) |fmt| {
                if (std.mem.eql(u8, fmt, "human_bytes")) {
                    return try humanBytes(allocator, @floatFromInt(n));
                }
            }
            return try std.fmt.allocPrint(allocator, "{d}", .{n});
        },
        .uint => |n| {
            if (column.format) |fmt| {
                if (std.mem.eql(u8, fmt, "human_bytes")) {
                    return try humanBytes(allocator, @floatFromInt(n));
                }
            }
            return try std.fmt.allocPrint(allocator, "{d}", .{n});
        },
        .float => |f| {
            if (column.format) |fmt| {
                if (std.mem.eql(u8, fmt, "human_bytes")) {
                    return try humanBytes(allocator, f);
                }
            }
            return try std.fmt.allocPrint(allocator, "{d:.1}", .{f});
        },
        .boolean => |b| return try allocator.dupe(u8, if (b) "true" else "false"),
    }
}

/// Format a byte count in human-readable form.
fn humanBytes(allocator: Allocator, bytes: f64) ![]u8 {
    const units = [_][]const u8{ "B", "KB", "MB", "GB", "TB" };
    var b = bytes;
    var i: usize = 0;
    while (b >= 1024 and i < units.len - 1) {
        b /= 1024;
        i += 1;
    }
    if (i == 0) {
        return try std.fmt.allocPrint(allocator, "{d:.0} {s}", .{ b, units[i] });
    }
    return try std.fmt.allocPrint(allocator, "{d:.1} {s}", .{ b, units[i] });
}

// ── Helpers ────────────────────────────────────────────────────────

fn makeIndent(allocator: Allocator, count: u32) ![]u8 {
    const buf = try allocator.alloc(u8, count);
    @memset(buf, ' ');
    return buf;
}

/// Join string slices with a separator. Returns an owned string.
fn joinSlices(allocator: Allocator, slices: []const []u8, sep: []const u8) ![]u8 {
    if (slices.len == 0) return try allocator.alloc(u8, 0);

    // Compute total length
    var total_len: usize = 0;
    for (slices, 0..) |s, i| {
        total_len += s.len;
        if (i > 0) total_len += sep.len;
    }

    const result = try allocator.alloc(u8, total_len);
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

// ── Tests ──────────────────────────────────────────────────────────

test "textProjection empty tree" {
    const allocator = std.testing.allocator;
    var render_tree = types.RenderTree.init(allocator);
    defer render_tree.deinit();

    const result = try textProjection(allocator, &render_tree);
    defer allocator.free(result);

    try std.testing.expectEqual(@as(usize, 0), result.len);
}

test "textProjection single text node" {
    const allocator = std.testing.allocator;
    var render_tree = types.RenderTree.init(allocator);
    defer render_tree.deinit();

    const root = types.VNode{
        .id = 1,
        .node_type = .text,
        .props = .{ .content = "Hello, Viewport!" },
        .children = &.{},
    };
    try tree_mod.setTreeRoot(&render_tree, root);

    const result = try textProjection(allocator, &render_tree);
    defer allocator.free(result);

    try std.testing.expectEqualStrings("Hello, Viewport!", result);
}

test "textProjection column box" {
    const allocator = std.testing.allocator;
    var render_tree = types.RenderTree.init(allocator);
    defer render_tree.deinit();

    var children = [_]types.VNode{
        .{ .id = 2, .node_type = .text, .props = .{ .content = "Line 1" }, .children = &.{} },
        .{ .id = 3, .node_type = .text, .props = .{ .content = "Line 2" }, .children = &.{} },
    };
    const root = types.VNode{
        .id = 1,
        .node_type = .box,
        .props = .{ .direction = .column },
        .children = &children,
    };
    try tree_mod.setTreeRoot(&render_tree, root);

    const result = try textProjection(allocator, &render_tree);
    defer allocator.free(result);

    try std.testing.expectEqualStrings("Line 1\nLine 2", result);
}

test "textProjection row box" {
    const allocator = std.testing.allocator;
    var render_tree = types.RenderTree.init(allocator);
    defer render_tree.deinit();

    var children = [_]types.VNode{
        .{ .id = 2, .node_type = .text, .props = .{ .content = "A" }, .children = &.{} },
        .{ .id = 3, .node_type = .text, .props = .{ .content = "B" }, .children = &.{} },
    };
    const root = types.VNode{
        .id = 1,
        .node_type = .box,
        .props = .{ .direction = .row },
        .children = &children,
    };
    try tree_mod.setTreeRoot(&render_tree, root);

    const result = try textProjection(allocator, &render_tree);
    defer allocator.free(result);

    try std.testing.expectEqualStrings("A\tB", result);
}

test "textProjection input node" {
    const allocator = std.testing.allocator;
    var render_tree = types.RenderTree.init(allocator);
    defer render_tree.deinit();

    const root = types.VNode{
        .id = 1,
        .node_type = .input,
        .props = .{ .value = "typed text" },
        .children = &.{},
    };
    try tree_mod.setTreeRoot(&render_tree, root);

    const result = try textProjection(allocator, &render_tree);
    defer allocator.free(result);

    try std.testing.expectEqualStrings("typed text", result);
}

test "textProjection input placeholder" {
    const allocator = std.testing.allocator;
    var render_tree = types.RenderTree.init(allocator);
    defer render_tree.deinit();

    const root = types.VNode{
        .id = 1,
        .node_type = .input,
        .props = .{ .placeholder = "Enter name..." },
        .children = &.{},
    };
    try tree_mod.setTreeRoot(&render_tree, root);

    const result = try textProjection(allocator, &render_tree);
    defer allocator.free(result);

    try std.testing.expectEqualStrings("Enter name...", result);
}

test "textProjection image/canvas with altText" {
    const allocator = std.testing.allocator;
    var render_tree = types.RenderTree.init(allocator);
    defer render_tree.deinit();

    const root = types.VNode{
        .id = 1,
        .node_type = .image,
        .props = .{ .alt_text = "logo.png" },
        .children = &.{},
    };
    try tree_mod.setTreeRoot(&render_tree, root);

    const result = try textProjection(allocator, &render_tree);
    defer allocator.free(result);

    try std.testing.expectEqualStrings("logo.png", result);
}

test "textProjection image without altText" {
    const allocator = std.testing.allocator;
    var render_tree = types.RenderTree.init(allocator);
    defer render_tree.deinit();

    const root = types.VNode{
        .id = 1,
        .node_type = .canvas,
        .props = .{},
        .children = &.{},
    };
    try tree_mod.setTreeRoot(&render_tree, root);

    const result = try textProjection(allocator, &render_tree);
    defer allocator.free(result);

    try std.testing.expectEqualStrings("[image]", result);
}

test "textProjection separator" {
    const allocator = std.testing.allocator;
    var render_tree = types.RenderTree.init(allocator);
    defer render_tree.deinit();

    const root = types.VNode{
        .id = 1,
        .node_type = .separator,
        .props = .{},
        .children = &.{},
    };
    try tree_mod.setTreeRoot(&render_tree, root);

    const result = try textProjection(allocator, &render_tree);
    defer allocator.free(result);

    try std.testing.expectEqualStrings(SEPARATOR_LINE, result);
}

test "textProjection nested box" {
    const allocator = std.testing.allocator;
    var render_tree = types.RenderTree.init(allocator);
    defer render_tree.deinit();

    // Simulate a counter app layout:
    //   box(column)
    //     text("Count: 0")
    //     box(row)
    //       text("+")
    //       text("-")

    var row_children = [_]types.VNode{
        .{ .id = 4, .node_type = .text, .props = .{ .content = "+" }, .children = &.{} },
        .{ .id = 5, .node_type = .text, .props = .{ .content = "-" }, .children = &.{} },
    };
    var col_children = [_]types.VNode{
        .{ .id = 2, .node_type = .text, .props = .{ .content = "Count: 0" }, .children = &.{} },
        .{ .id = 3, .node_type = .box, .props = .{ .direction = .row }, .children = &row_children },
    };
    const root = types.VNode{
        .id = 1,
        .node_type = .box,
        .props = .{ .direction = .column },
        .children = &col_children,
    };
    try tree_mod.setTreeRoot(&render_tree, root);

    const result = try textProjection(allocator, &render_tree);
    defer allocator.free(result);

    try std.testing.expectEqualStrings("Count: 0\n+\t-", result);
}

test "textProjection text_alt override" {
    const allocator = std.testing.allocator;
    var render_tree = types.RenderTree.init(allocator);
    defer render_tree.deinit();

    var children = [_]types.VNode{
        .{ .id = 2, .node_type = .text, .props = .{ .content = "hidden" }, .children = &.{} },
    };
    const root = types.VNode{
        .id = 1,
        .node_type = .box,
        .props = .{ .text_alt = "Custom projection" },
        .children = &children,
    };
    try tree_mod.setTreeRoot(&render_tree, root);

    const result = try textProjection(allocator, &render_tree);
    defer allocator.free(result);

    try std.testing.expectEqualStrings("Custom projection", result);
}

test "textProjection scroll node" {
    const allocator = std.testing.allocator;
    var render_tree = types.RenderTree.init(allocator);
    defer render_tree.deinit();

    var children = [_]types.VNode{
        .{ .id = 2, .node_type = .text, .props = .{ .content = "item 1" }, .children = &.{} },
        .{ .id = 3, .node_type = .text, .props = .{ .content = "item 2" }, .children = &.{} },
    };
    const root = types.VNode{
        .id = 1,
        .node_type = .scroll,
        .props = .{},
        .children = &children,
    };
    try tree_mod.setTreeRoot(&render_tree, root);

    const result = try textProjection(allocator, &render_tree);
    defer allocator.free(result);

    try std.testing.expectEqualStrings("item 1\nitem 2", result);
}

test "textProjection skips empty children" {
    const allocator = std.testing.allocator;
    var render_tree = types.RenderTree.init(allocator);
    defer render_tree.deinit();

    var children = [_]types.VNode{
        .{ .id = 2, .node_type = .text, .props = .{ .content = "visible" }, .children = &.{} },
        .{ .id = 3, .node_type = .text, .props = .{}, .children = &.{} }, // empty content
        .{ .id = 4, .node_type = .text, .props = .{ .content = "also visible" }, .children = &.{} },
    };
    const root = types.VNode{
        .id = 1,
        .node_type = .box,
        .props = .{ .direction = .column },
        .children = &children,
    };
    try tree_mod.setTreeRoot(&render_tree, root);

    const result = try textProjection(allocator, &render_tree);
    defer allocator.free(result);

    try std.testing.expectEqualStrings("visible\nalso visible", result);
}

test "humanBytes formatting" {
    const allocator = std.testing.allocator;

    {
        const s = try humanBytes(allocator, 500);
        defer allocator.free(s);
        try std.testing.expectEqualStrings("500 B", s);
    }
    {
        const s = try humanBytes(allocator, 1536);
        defer allocator.free(s);
        try std.testing.expectEqualStrings("1.5 KB", s);
    }
    {
        const s = try humanBytes(allocator, 1048576);
        defer allocator.free(s);
        try std.testing.expectEqualStrings("1.0 MB", s);
    }
}
