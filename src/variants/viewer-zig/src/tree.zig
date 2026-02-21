// tree.zig — Render tree manipulation utilities.
//
// These operate on the materialized RenderTree that viewers maintain.
// They mirror the TypeScript utilities in src/core/tree.ts.

const std = @import("std");
const types = @import("types.zig");
const Allocator = std.mem.Allocator;

const RenderNode = types.RenderNode;
const RenderTree = types.RenderTree;
const VNode = types.VNode;
const PatchOp = types.PatchOp;
const NodeProps = types.NodeProps;

// ── Tree creation ──────────────────────────────────────────────────

/// Create an empty render tree.
pub fn createRenderTree(allocator: Allocator) RenderTree {
    return RenderTree.init(allocator);
}

// ── VNode -> RenderNode conversion ─────────────────────────────────

/// Convert a VNode to a RenderNode, recursively converting all children.
/// Registers every node in the provided index map.
/// Caller does NOT own the returned pointer -- it is owned by the tree.
pub fn vnodeToRenderNode(
    allocator: Allocator,
    vnode: VNode,
    index: *std.AutoHashMap(u32, *RenderNode),
) !*RenderNode {
    const node = try allocator.create(RenderNode);
    node.* = RenderNode.init(allocator, vnode.id, vnode.node_type, vnode.props);

    // Copy textAlt into props if set on the VNode
    if (vnode.text_alt) |alt| {
        node.props.text_alt = alt;
    }

    // Convert children recursively
    for (vnode.children) |child_vnode| {
        const child = try vnodeToRenderNode(allocator, child_vnode, index);
        try node.addChild(child);
    }

    try index.put(vnode.id, node);
    return node;
}

// ── Set tree root ──────────────────────────────────────────────────

/// Set the root of a render tree from a VNode. Replaces any existing tree.
pub fn setTreeRoot(tree: *RenderTree, root: VNode) !void {
    // Tear down existing tree
    if (tree.root) |old_root| {
        old_root.deinit();
        tree.allocator.destroy(old_root);
    }
    tree.node_index.clearRetainingCapacity();

    // Build new tree
    tree.root = try vnodeToRenderNode(tree.allocator, root, &tree.node_index);
}

// ── Patch application ──────────────────────────────────────────────

/// Apply a single patch operation to a render tree.
/// Returns true if the patch was applied successfully.
pub fn applyPatch(tree: *RenderTree, op: PatchOp) !bool {
    // Handle remove
    if (op.remove) {
        return removeNode(tree, op.target);
    }

    // Handle replace
    if (op.replace) |replacement| {
        return try replaceNode(tree, op.target, replacement);
    }

    // Find target node
    const node = tree.node_index.get(op.target) orelse return false;

    // Apply property changes
    if (op.set) |set_props| {
        mergeProps(&node.props, set_props);
    }

    // Apply children insert
    if (op.children_insert) |insert| {
        const child = try vnodeToRenderNode(tree.allocator, insert.node, &tree.node_index);
        try node.insertChildAt(@intCast(insert.index), child);
    }

    // Apply children remove
    if (op.children_remove) |remove| {
        const idx: usize = @intCast(remove.index);
        if (idx < node.children.items.len) {
            const removed = node.children.orderedRemove(idx);
            removeSubtreeFromIndex(&tree.node_index, removed);
            removed.deinit();
            tree.allocator.destroy(removed);
        }
    }

    // Apply children move
    if (op.children_move) |move| {
        const from: usize = @intCast(move.from);
        const to: usize = @intCast(move.to);
        if (from < node.children.items.len and to < node.children.items.len) {
            const child = node.children.orderedRemove(from);
            const insert_at = @min(to, node.children.items.len);
            try node.children.insert(insert_at, child);
        }
    }

    return true;
}

/// Apply a batch of patch operations. Returns counts of applied and failed.
pub fn applyPatches(tree: *RenderTree, ops: []const PatchOp) !struct { applied: u32, failed: u32 } {
    var applied: u32 = 0;
    var failed: u32 = 0;

    for (ops) |op| {
        const ok = applyPatch(tree, op) catch false;
        if (ok) {
            applied += 1;
        } else {
            failed += 1;
        }
    }

    return .{ .applied = applied, .failed = failed };
}

// ── Merge properties ───────────────────────────────────────────────

/// Merge non-null fields from src into dst.
fn mergeProps(dst: *NodeProps, src: NodeProps) void {
    inline for (std.meta.fields(NodeProps)) |field| {
        const src_val = @field(src, field.name);
        // For optional fields, only overwrite if src has a value
        if (comptime @typeInfo(field.type) == .optional) {
            if (src_val != null) {
                @field(dst, field.name) = src_val;
            }
        } else {
            @field(dst, field.name) = src_val;
        }
    }
}

// ── Node removal helpers ───────────────────────────────────────────

/// Remove a node and its subtree from the tree.
fn removeNode(tree: *RenderTree, target_id: u32) bool {
    const node = tree.node_index.get(target_id) orelse return false;

    // Check if it is the root
    if (tree.root) |root| {
        if (root.id == target_id) {
            removeSubtreeFromIndex(&tree.node_index, root);
            root.deinit();
            tree.allocator.destroy(root);
            tree.root = null;
            return true;
        }
    }

    // Find parent
    const parent = findParent(tree.root, target_id) orelse return false;

    // Remove from parent's children
    for (parent.children.items, 0..) |child, i| {
        if (child.id == target_id) {
            _ = parent.children.orderedRemove(i);
            break;
        }
    }

    removeSubtreeFromIndex(&tree.node_index, node);
    node.deinit();
    tree.allocator.destroy(node);
    return true;
}

/// Replace a node in the tree with a new VNode.
fn replaceNode(tree: *RenderTree, target_id: u32, replacement: VNode) !bool {
    const existing = tree.node_index.get(target_id) orelse return false;

    // Build new subtree
    const new_node = try vnodeToRenderNode(tree.allocator, replacement, &tree.node_index);

    // Check if it is the root
    if (tree.root) |root| {
        if (root.id == target_id) {
            removeSubtreeFromIndex(&tree.node_index, existing);
            existing.deinit();
            tree.allocator.destroy(existing);
            tree.root = new_node;
            return true;
        }
    }

    // Find parent and swap
    const parent = findParent(tree.root, target_id) orelse {
        // Clean up new node since we can't place it
        removeSubtreeFromIndex(&tree.node_index, new_node);
        new_node.deinit();
        tree.allocator.destroy(new_node);
        return false;
    };

    for (parent.children.items, 0..) |child, i| {
        if (child.id == target_id) {
            removeSubtreeFromIndex(&tree.node_index, existing);
            existing.deinit();
            tree.allocator.destroy(existing);
            parent.children.items[i] = new_node;
            return true;
        }
    }

    return false;
}

/// Remove a node and all descendants from the index.
fn removeSubtreeFromIndex(index: *std.AutoHashMap(u32, *RenderNode), node: *RenderNode) void {
    _ = index.remove(node.id);
    for (node.children.items) |child| {
        removeSubtreeFromIndex(index, child);
    }
}

/// Find the parent of a node by ID via tree traversal.
fn findParent(root: ?*RenderNode, target_id: u32) ?*RenderNode {
    const r = root orelse return null;

    for (r.children.items) |child| {
        if (child.id == target_id) return r;
        const found = findParent(child, target_id);
        if (found != null) return found;
    }

    return null;
}

// ── Tree queries ───────────────────────────────────────────────────

/// Count all nodes in a tree.
pub fn countNodes(node: ?*const RenderNode) u32 {
    const n = node orelse return 0;
    var count: u32 = 1;
    for (n.children.items) |child| {
        count += countNodes(child);
    }
    return count;
}

/// Compute the maximum depth of a tree.
pub fn treeDepth(node: ?*const RenderNode) u32 {
    const n = node orelse return 0;
    if (n.children.items.len == 0) return 1;

    var max_child_depth: u32 = 0;
    for (n.children.items) |child| {
        const d = treeDepth(child);
        if (d > max_child_depth) max_child_depth = d;
    }
    return 1 + max_child_depth;
}

/// Visitor callback type for walkTree.
pub const WalkVisitor = *const fn (node: *const RenderNode, depth: u32) void;

/// Walk all nodes in depth-first order.
pub fn walkTree(node: ?*const RenderNode, visitor: WalkVisitor, depth: u32) void {
    const n = node orelse return;
    visitor(n, depth);
    for (n.children.items) |child| {
        walkTree(child, visitor, depth + 1);
    }
}

/// Walk all nodes with a context pointer for closures.
pub fn walkTreeCtx(
    node: ?*const RenderNode,
    ctx: anytype,
    comptime visitor: fn (@TypeOf(ctx), *const RenderNode, u32) void,
    depth: u32,
) void {
    const n = node orelse return;
    visitor(ctx, n, depth);
    for (n.children.items) |child| {
        walkTreeCtx(child, ctx, visitor, depth + 1);
    }
}

/// Find a node by ID using the tree's index.
pub fn findById(tree: *const RenderTree, id: u32) ?*RenderNode {
    return tree.node_index.get(id);
}

/// Find a node by ID via tree traversal (works without an index).
pub fn findByIdTraversal(root: ?*const RenderNode, id: u32) ?*RenderNode {
    const n = root orelse return null;
    if (n.id == id) return @constCast(n);
    for (n.children.items) |child| {
        const found = findByIdTraversal(child, id);
        if (found != null) return found;
    }
    return null;
}

/// Find a node by text content.
pub fn findByText(root: ?*const RenderNode, text: []const u8) ?*RenderNode {
    const n = root orelse return null;
    if (n.node_type == .text) {
        if (n.props.content) |content| {
            if (std.mem.eql(u8, content, text)) return @constCast(n);
        }
    }
    for (n.children.items) |child| {
        const found = findByText(child, text);
        if (found != null) return found;
    }
    return null;
}

/// Collect all nodes matching a predicate into caller-provided ArrayList.
pub fn findNodes(
    root: ?*const RenderNode,
    results: *std.ArrayList(*RenderNode),
    predicate: *const fn (*const RenderNode) bool,
) !void {
    const n = root orelse return;
    if (predicate(n)) {
        try results.append(@constCast(n));
    }
    for (n.children.items) |child| {
        try findNodes(child, results, predicate);
    }
}

// ── Tests ──────────────────────────────────────────────────────────

test "createRenderTree" {
    const allocator = std.testing.allocator;
    var tree = createRenderTree(allocator);
    defer tree.deinit();

    try std.testing.expect(tree.root == null);
}

test "setTreeRoot creates indexed tree" {
    const allocator = std.testing.allocator;
    var tree = createRenderTree(allocator);
    defer tree.deinit();

    var children = [_]VNode{
        .{
            .id = 2,
            .node_type = .text,
            .props = .{ .content = "hello" },
            .children = &.{},
        },
        .{
            .id = 3,
            .node_type = .text,
            .props = .{ .content = "world" },
            .children = &.{},
        },
    };

    const root = VNode{
        .id = 1,
        .node_type = .box,
        .props = .{ .direction = .column },
        .children = &children,
    };

    try setTreeRoot(&tree, root);

    try std.testing.expect(tree.root != null);
    try std.testing.expectEqual(@as(u32, 1), tree.root.?.id);
    try std.testing.expectEqual(@as(usize, 2), tree.root.?.children.items.len);
    try std.testing.expectEqual(@as(u32, 3), tree.node_index.count());

    // Verify index
    const found = findById(&tree, 2);
    try std.testing.expect(found != null);
    try std.testing.expectEqualStrings("hello", found.?.props.content.?);
}

test "countNodes and treeDepth" {
    const allocator = std.testing.allocator;
    var tree = createRenderTree(allocator);
    defer tree.deinit();

    var grandchild = [_]VNode{
        .{
            .id = 4,
            .node_type = .text,
            .props = .{ .content = "deep" },
            .children = &.{},
        },
    };

    var children = [_]VNode{
        .{
            .id = 2,
            .node_type = .text,
            .props = .{ .content = "a" },
            .children = &.{},
        },
        .{
            .id = 3,
            .node_type = .box,
            .props = .{},
            .children = &grandchild,
        },
    };

    const root = VNode{
        .id = 1,
        .node_type = .box,
        .props = .{},
        .children = &children,
    };

    try setTreeRoot(&tree, root);

    try std.testing.expectEqual(@as(u32, 4), countNodes(tree.root));
    try std.testing.expectEqual(@as(u32, 3), treeDepth(tree.root));
}

test "applyPatch set props" {
    const allocator = std.testing.allocator;
    var tree = createRenderTree(allocator);
    defer tree.deinit();

    var empty_children = [_]VNode{};
    const root = VNode{
        .id = 1,
        .node_type = .text,
        .props = .{ .content = "old" },
        .children = &empty_children,
    };

    try setTreeRoot(&tree, root);

    const patch = PatchOp{
        .target = 1,
        .set = .{ .content = "new" },
    };

    const ok = try applyPatch(&tree, patch);
    try std.testing.expect(ok);

    const node = findById(&tree, 1).?;
    try std.testing.expectEqualStrings("new", node.props.content.?);
}

test "applyPatch children insert" {
    const allocator = std.testing.allocator;
    var tree = createRenderTree(allocator);
    defer tree.deinit();

    const root = VNode{
        .id = 1,
        .node_type = .box,
        .props = .{},
        .children = &.{},
    };
    try setTreeRoot(&tree, root);

    const patch = PatchOp{
        .target = 1,
        .children_insert = .{
            .index = 0,
            .node = .{
                .id = 2,
                .node_type = .text,
                .props = .{ .content = "inserted" },
                .children = &.{},
            },
        },
    };

    const ok = try applyPatch(&tree, patch);
    try std.testing.expect(ok);
    try std.testing.expectEqual(@as(usize, 1), tree.root.?.children.items.len);
    try std.testing.expectEqual(@as(u32, 2), tree.root.?.children.items[0].id);
    try std.testing.expectEqual(@as(u32, 2), countNodes(tree.root));
}

test "applyPatch remove node" {
    const allocator = std.testing.allocator;
    var tree = createRenderTree(allocator);
    defer tree.deinit();

    var children = [_]VNode{
        .{ .id = 2, .node_type = .text, .props = .{ .content = "child" }, .children = &.{} },
    };
    const root = VNode{
        .id = 1,
        .node_type = .box,
        .props = .{},
        .children = &children,
    };
    try setTreeRoot(&tree, root);

    const patch = PatchOp{
        .target = 2,
        .remove = true,
    };

    const ok = try applyPatch(&tree, patch);
    try std.testing.expect(ok);
    try std.testing.expectEqual(@as(usize, 0), tree.root.?.children.items.len);
    try std.testing.expect(findById(&tree, 2) == null);
}

test "applyPatches batch" {
    const allocator = std.testing.allocator;
    var tree = createRenderTree(allocator);
    defer tree.deinit();

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
    try setTreeRoot(&tree, root);

    const ops = [_]PatchOp{
        .{ .target = 2, .set = .{ .content = "updated_a" } },
        .{ .target = 3, .set = .{ .content = "updated_b" } },
        .{ .target = 999, .set = .{ .content = "nonexistent" } }, // should fail
    };

    const result = try applyPatches(&tree, &ops);
    try std.testing.expectEqual(@as(u32, 2), result.applied);
    try std.testing.expectEqual(@as(u32, 1), result.failed);

    try std.testing.expectEqualStrings("updated_a", findById(&tree, 2).?.props.content.?);
    try std.testing.expectEqualStrings("updated_b", findById(&tree, 3).?.props.content.?);
}

test "findByText" {
    const allocator = std.testing.allocator;
    var tree = createRenderTree(allocator);
    defer tree.deinit();

    var children = [_]VNode{
        .{ .id = 2, .node_type = .text, .props = .{ .content = "Count: 0" }, .children = &.{} },
        .{ .id = 3, .node_type = .text, .props = .{ .content = "+" }, .children = &.{} },
    };
    const root = VNode{
        .id = 1,
        .node_type = .box,
        .props = .{},
        .children = &children,
    };
    try setTreeRoot(&tree, root);

    const found = findByText(tree.root, "Count: 0");
    try std.testing.expect(found != null);
    try std.testing.expectEqual(@as(u32, 2), found.?.id);

    const not_found = findByText(tree.root, "nonexistent");
    try std.testing.expect(not_found == null);
}

test "setTreeRoot replaces existing tree" {
    const allocator = std.testing.allocator;
    var tree = createRenderTree(allocator);
    defer tree.deinit();

    // Set initial tree
    const root1 = VNode{
        .id = 1,
        .node_type = .text,
        .props = .{ .content = "first" },
        .children = &.{},
    };
    try setTreeRoot(&tree, root1);
    try std.testing.expectEqual(@as(u32, 1), tree.root.?.id);

    // Replace with new tree
    const root2 = VNode{
        .id = 10,
        .node_type = .text,
        .props = .{ .content = "second" },
        .children = &.{},
    };
    try setTreeRoot(&tree, root2);
    try std.testing.expectEqual(@as(u32, 10), tree.root.?.id);
    try std.testing.expect(findById(&tree, 1) == null);
    try std.testing.expect(findById(&tree, 10) != null);
}
