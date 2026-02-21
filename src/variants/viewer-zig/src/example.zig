// example.zig — Smoke test / usage example for the Viewport viewer.
//
// Demonstrates the embeddable viewer pattern:
//   1. Create a viewer
//   2. Set a tree (direct function call, no serialization)
//   3. Apply patches
//   4. Read text projection and metrics
//
// Run with: zig build run

const std = @import("std");
const viewport = @import("main.zig");

pub fn main() !void {
    const stdout = std.io.getStdOut().writer();
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    try stdout.print("=== Viewport Protocol — Zig Embeddable Viewer ===\n\n", .{});

    // ── Create viewer ──────────────────────────────────────────────

    var viewer = viewport.Viewer.init(allocator);
    defer viewer.deinit();

    try stdout.print("Viewer created (headless mode)\n", .{});

    // ── Build a counter app tree ───────────────────────────────────
    //
    //   box(column)
    //     text("Counter App")
    //     separator
    //     text("Count: 0")
    //     box(row)
    //       text("+")
    //       text("-")

    var btn_children = [_]viewport.VNode{
        .{ .id = 5, .node_type = .text, .props = .{ .content = "+", .interactive = .clickable }, .children = &.{} },
        .{ .id = 6, .node_type = .text, .props = .{ .content = "-", .interactive = .clickable }, .children = &.{} },
    };
    var children = [_]viewport.VNode{
        .{ .id = 2, .node_type = .text, .props = .{ .content = "Counter App", .weight = .bold }, .children = &.{} },
        .{ .id = 3, .node_type = .separator, .props = .{}, .children = &.{} },
        .{ .id = 4, .node_type = .text, .props = .{ .content = "Count: 0" }, .children = &.{} },
        .{ .id = 7, .node_type = .box, .props = .{ .direction = .row, .gap = 8 }, .children = &btn_children },
    };
    const root = viewport.VNode{
        .id = 1,
        .node_type = .box,
        .props = .{ .direction = .column, .padding = .{ .uniform = 16 } },
        .children = &children,
    };

    try viewer.setTree(root);
    try stdout.print("Tree set (6 nodes)\n\n", .{});

    // ── Text projection ────────────────────────────────────────────

    const text = try viewer.getTextProjection();
    defer allocator.free(text);

    try stdout.print("--- Text Projection ---\n{s}\n-----------------------\n\n", .{text});

    // ── Simulate click on "+" ──────────────────────────────────────

    const ops1 = [_]viewport.PatchOp{
        .{ .target = 4, .set = .{ .content = "Count: 1" } },
    };
    try viewer.applyPatches(&ops1);

    const text2 = try viewer.getTextProjection();
    defer allocator.free(text2);

    try stdout.print("After increment:\n{s}\n\n", .{text2});

    // ── A few more increments ──────────────────────────────────────

    const ops2 = [_]viewport.PatchOp{
        .{ .target = 4, .set = .{ .content = "Count: 2" } },
    };
    try viewer.applyPatches(&ops2);

    const ops3 = [_]viewport.PatchOp{
        .{ .target = 4, .set = .{ .content = "Count: 3" } },
    };
    try viewer.applyPatches(&ops3);

    // ── Render (headless = no-op but tracks dirty state) ──────────

    const changed = viewer.render();
    try stdout.print("Render returned: {}\n", .{changed});

    // ── Metrics ────────────────────────────────────────────────────

    const m = viewer.getMetrics();
    try stdout.print("\n--- Metrics ---\n", .{});
    try stdout.print("  Messages processed: {d}\n", .{m.messages_processed});
    try stdout.print("  Tree node count:    {d}\n", .{m.tree_node_count});
    try stdout.print("  Tree depth:         {d}\n", .{m.tree_depth});
    try stdout.print("  Slot count:         {d}\n", .{m.slot_count});
    try stdout.print("  Memory estimate:    {d} bytes\n", .{m.memory_usage_bytes});
    try stdout.print("  Last frame time:    {d:.3} ms\n", .{m.last_frame_time_ms});
    try stdout.print("  Peak frame time:    {d:.3} ms\n", .{m.peak_frame_time_ms});
    try stdout.print("  Avg frame time:     {d:.3} ms\n", .{m.avg_frame_time_ms});

    // ── Wire format demo ───────────────────────────────────────────

    try stdout.print("\n--- Wire Format ---\n", .{});

    const header = viewport.encodeHeader(.tree, 42);
    try stdout.print("  Encoded header: ", .{});
    for (header) |b| {
        try stdout.print("{x:0>2} ", .{b});
    }
    try stdout.print("\n", .{});

    const decoded = viewport.decodeHeader(&header).?;
    try stdout.print("  Decoded: magic=0x{x:0>4} ver={d} type=0x{x:0>2} len={d}\n", .{
        decoded.magic,
        decoded.version,
        @intFromEnum(decoded.msg_type),
        decoded.length,
    });

    // ── Screenshot ─────────────────────────────────────────────────

    const ss = try viewer.screenshot();
    defer allocator.free(ss.data);

    try stdout.print("\n--- Screenshot (ANSI) ---\n{s}\n", .{ss.data});

    try stdout.print("\n=== Done ===\n", .{});
}
