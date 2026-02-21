// main.zig — Root module for the Viewport protocol embeddable viewer.
//
// This module re-exports all public symbols so downstream consumers
// can do:
//
//     const viewport = @import("viewport");
//     var viewer = viewport.Viewer.init(allocator);

pub const types = @import("types.zig");
pub const wire = @import("wire.zig");
pub const tree = @import("tree.zig");
pub const text_projection = @import("text_projection.zig");
pub const viewer = @import("viewer.zig");

// ── Convenience re-exports ─────────────────────────────────────────

pub const Viewer = viewer.Viewer;

pub const VNode = types.VNode;
pub const RenderNode = types.RenderNode;
pub const RenderTree = types.RenderTree;
pub const NodeType = types.NodeType;
pub const NodeProps = types.NodeProps;
pub const ComputedLayout = types.ComputedLayout;
pub const PatchOp = types.PatchOp;
pub const InputEvent = types.InputEvent;
pub const InputKind = types.InputKind;
pub const SlotValue = types.SlotValue;
pub const EnvInfo = types.EnvInfo;
pub const ProtocolMessage = types.ProtocolMessage;
pub const MessageType = types.MessageType;
pub const ViewerMetrics = types.ViewerMetrics;
pub const RenderTarget = types.RenderTarget;
pub const ScreenshotResult = types.ScreenshotResult;
pub const FrameHeader = types.FrameHeader;

pub const MAGIC = types.MAGIC;
pub const PROTOCOL_VERSION = types.PROTOCOL_VERSION;
pub const HEADER_SIZE = wire.HEADER_SIZE;

// Wire format functions
pub const encodeHeader = wire.encodeHeader;
pub const decodeHeader = wire.decodeHeader;
pub const encodeFrame = wire.encodeFrame;
pub const decodeFrame = wire.decodeFrame;
pub const FrameReader = wire.FrameReader;

// Tree functions
pub const createRenderTree = tree.createRenderTree;
pub const setTreeRoot = tree.setTreeRoot;
pub const countNodes = tree.countNodes;
pub const treeDepth = tree.treeDepth;
pub const walkTree = tree.walkTree;
pub const walkTreeCtx = tree.walkTreeCtx;
pub const findById = tree.findById;
pub const findByText = tree.findByText;

// Text projection functions
pub const textProjection = text_projection.textProjection;
pub const textProjectionWithOptions = text_projection.textProjectionWithOptions;
pub const TextProjectionOptions = text_projection.TextProjectionOptions;

// ── Tests ──────────────────────────────────────────────────────────

test {
    // Run all sub-module tests
    @import("std").testing.refAllDeclsRecursive(@This());
}
