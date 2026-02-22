// source.zig — Source-side local state management for the Viewport protocol.
//
// This mirrors the TypeScript SourceState (src/source/state.ts):
//   - App mutations go to pending state (coalesced)
//   - flush() bundles pending ops into protocol messages
//   - Published state tracks what has been sent to the viewer
//
// Status: Stub — interface defined, implementation TODO.

const std = @import("std");
const types = @import("../core/types.zig");

const VNode = types.VNode;
const PatchOp = types.PatchOp;
const SlotValue = types.SlotValue;
const ProtocolMessage = types.ProtocolMessage;

/// Source-side local state: pending + published.
///
/// App mutations accumulate in the pending buffer. On flush(),
/// pending ops are bundled into protocol messages and the published
/// state is updated.
pub const SourceState = struct {
    allocator: std.mem.Allocator,
    seq: u64 = 0,
    has_pending: bool = false,

    pub fn init(allocator: std.mem.Allocator) SourceState {
        return .{ .allocator = allocator };
    }

    pub fn deinit(self: *SourceState) void {
        _ = self;
        // TODO: free pending/published state
    }

    /// Set a full tree (replaces any pending patches).
    pub fn setTree(self: *SourceState, root: *const VNode) void {
        _ = self;
        _ = root;
        // TODO: store pending tree, clear pending patches
    }

    /// Apply patch operations (coalesce with existing pending patches).
    pub fn patch(self: *SourceState, ops: []const PatchOp) void {
        _ = self;
        _ = ops;
        // TODO: coalesce patches per target
    }

    /// Define a slot (last-write-wins).
    pub fn defineSlot(self: *SourceState, slot: u32, value: SlotValue) void {
        _ = self;
        _ = slot;
        _ = value;
        // TODO: store in pending slots
    }

    /// Flush pending ops into protocol messages.
    /// Returns the number of messages generated.
    pub fn flush(self: *SourceState) u32 {
        if (!self.has_pending) return 0;
        self.has_pending = false;
        self.seq += 1;
        // TODO: build and return messages
        return 0;
    }

    /// Check if there are pending changes.
    pub fn hasPending(self: *const SourceState) bool {
        return self.has_pending;
    }
};

// ── Tests ──────────────────────────────────────────────────────────

test "SourceState: init and basic operations" {
    var state = SourceState.init(std.testing.allocator);
    defer state.deinit();

    try std.testing.expect(!state.hasPending());
    try std.testing.expectEqual(@as(u64, 0), state.seq);

    const flushed = state.flush();
    try std.testing.expectEqual(@as(u32, 0), flushed);
}
