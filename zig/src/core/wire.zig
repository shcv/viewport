// wire.zig — Wire format: 8-byte binary frame header + CBOR payload.
//
// ┌─────────┬─────────┬────────┬─────────────┬──────────────────┐
// │ magic   │ version │ type   │ length      │ CBOR payload     │
// │ 2 bytes │ 1 byte  │ 1 byte │ 4 bytes LE  │ variable         │
// └─────────┴─────────┴────────┴─────────────┴──────────────────┘

const std = @import("std");
const types = @import("types.zig");
const Allocator = std.mem.Allocator;

pub const HEADER_SIZE: usize = 8;

// ── Frame header encode/decode ─────────────────────────────────────

/// Encode a frame header into a buffer.
pub fn encodeHeader(msg_type: types.MessageType, payload_length: u32) [HEADER_SIZE]u8 {
    var buf: [HEADER_SIZE]u8 = undefined;

    // Magic bytes (big-endian): 'V' = 0x56, 'P' = 0x50
    buf[0] = @as(u8, @intCast((types.MAGIC >> 8) & 0xFF));
    buf[1] = @as(u8, @intCast(types.MAGIC & 0xFF));

    // Version
    buf[2] = types.PROTOCOL_VERSION;

    // Message type
    buf[3] = @intFromEnum(msg_type);

    // Payload length (little-endian u32)
    std.mem.writeInt(u32, buf[4..8], payload_length, .little);

    return buf;
}

/// Decode a frame header from bytes. Returns null if data is too short or magic
/// does not match.
pub fn decodeHeader(data: []const u8) ?types.FrameHeader {
    if (data.len < HEADER_SIZE) return null;

    // Magic bytes (big-endian)
    const magic: u16 = (@as(u16, data[0]) << 8) | @as(u16, data[1]);
    if (magic != types.MAGIC) return null;

    const version = data[2];
    const raw_type = data[3];

    // Validate message type
    const msg_type = std.meta.intToEnum(types.MessageType, raw_type) catch return null;

    const length = std.mem.readInt(u32, data[4..8], .little);

    return .{
        .magic = magic,
        .version = version,
        .msg_type = msg_type,
        .length = length,
    };
}

/// Encode a complete frame: header + payload.
/// Caller owns the returned slice.
pub fn encodeFrame(allocator: Allocator, msg_type: types.MessageType, payload: []const u8) ![]u8 {
    const frame = try allocator.alloc(u8, HEADER_SIZE + payload.len);
    const header = encodeHeader(msg_type, @intCast(payload.len));
    @memcpy(frame[0..HEADER_SIZE], &header);
    @memcpy(frame[HEADER_SIZE..], payload);
    return frame;
}

/// Decode a complete frame (header + payload). Returns null if data is
/// incomplete or the magic does not match.
pub fn decodeFrame(data: []const u8) ?struct { header: types.FrameHeader, payload: []const u8 } {
    const header = decodeHeader(data) orelse return null;
    const total_size = HEADER_SIZE + header.length;
    if (data.len < total_size) return null;

    return .{
        .header = header,
        .payload = data[HEADER_SIZE..total_size],
    };
}

// ── FrameReader: streaming frame parser with buffering ─────────────

/// Stream parser for reading frames from a byte stream.
/// Handles partial reads and buffering.
pub const FrameReader = struct {
    buffer: std.ArrayList(u8),
    allocator: Allocator,

    pub const Frame = struct {
        header: types.FrameHeader,
        payload: []const u8,
    };

    pub fn init(allocator: Allocator) FrameReader {
        return .{
            .buffer = std.ArrayList(u8).init(allocator),
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *FrameReader) void {
        self.buffer.deinit();
    }

    /// Feed bytes into the reader. Returns complete frames found.
    /// The returned frames reference memory owned by the FrameReader; they
    /// are only valid until the next call to `feed`.
    ///
    /// The caller owns the returned ArrayList of frames and must deinit it.
    pub fn feed(self: *FrameReader, data: []const u8) !std.ArrayList(Frame) {
        try self.buffer.appendSlice(data);

        var frames = std.ArrayList(Frame).init(self.allocator);

        while (self.buffer.items.len >= HEADER_SIZE) {
            const header = decodeHeader(self.buffer.items) orelse {
                // Bad magic -- skip one byte and try again (recovery)
                _ = self.buffer.orderedRemove(0);
                continue;
            };

            const total_size = HEADER_SIZE + header.length;
            if (self.buffer.items.len < total_size) break; // need more data

            // Extract payload (copy so it survives buffer compaction)
            const payload = try self.allocator.alloc(u8, header.length);
            @memcpy(payload, self.buffer.items[HEADER_SIZE..total_size]);

            try frames.append(.{
                .header = header,
                .payload = payload,
            });

            // Remove consumed bytes from the front
            const remaining = self.buffer.items.len - total_size;
            if (remaining > 0) {
                std.mem.copyForwards(u8, self.buffer.items[0..remaining], self.buffer.items[total_size..]);
            }
            self.buffer.shrinkRetainingCapacity(remaining);
        }

        return frames;
    }

    /// How many bytes are buffered but not yet forming a complete frame.
    pub fn pendingBytes(self: *const FrameReader) usize {
        return self.buffer.items.len;
    }
};

// ── CBOR stub ──────────────────────────────────────────────────────
//
// Full CBOR (RFC 8949) decoding is complex. This module provides the
// binary frame header parsing; CBOR payload parsing is left as a
// separate concern. For production use, integrate a Zig CBOR library
// such as zig-cbor or implement the subset needed for the Viewport
// protocol's message types.

pub const CborError = error{
    NotImplemented,
    InvalidCbor,
    UnexpectedType,
    OutOfMemory,
};

/// Stub: decode a CBOR payload into a ProtocolMessage.
/// This is a placeholder — real implementations should decode the CBOR
/// bytes into the appropriate ProtocolMessage variant based on the
/// message type from the frame header.
pub fn decodeCborPayload(_msg_type: types.MessageType, _payload: []const u8) CborError!types.ProtocolMessage {
    // TODO: Implement CBOR decoding for each message type.
    // For now, the viewer operates in embeddable mode (direct function
    // calls) which bypasses wire encoding entirely.
    _ = _msg_type;
    _ = _payload;
    return CborError.NotImplemented;
}

/// Stub: encode a ProtocolMessage into CBOR bytes.
pub fn encodeCborPayload(_allocator: Allocator, _msg: types.ProtocolMessage) CborError![]u8 {
    _ = _allocator;
    _ = _msg;
    return CborError.NotImplemented;
}

// ── Tests ──────────────────────────────────────────────────────────

test "encodeHeader produces correct bytes" {
    const header = encodeHeader(.tree, 256);

    // Magic: 0x56, 0x50 (big-endian)
    try std.testing.expectEqual(@as(u8, 0x56), header[0]);
    try std.testing.expectEqual(@as(u8, 0x50), header[1]);

    // Version: 1
    try std.testing.expectEqual(@as(u8, 1), header[2]);

    // Type: TREE = 0x02
    try std.testing.expectEqual(@as(u8, 0x02), header[3]);

    // Length: 256 in little-endian
    try std.testing.expectEqual(@as(u8, 0x00), header[4]);
    try std.testing.expectEqual(@as(u8, 0x01), header[5]);
    try std.testing.expectEqual(@as(u8, 0x00), header[6]);
    try std.testing.expectEqual(@as(u8, 0x00), header[7]);
}

test "decodeHeader roundtrip" {
    const original_type = types.MessageType.patch;
    const original_len: u32 = 12345;

    const header_bytes = encodeHeader(original_type, original_len);
    const decoded = decodeHeader(&header_bytes).?;

    try std.testing.expectEqual(types.MAGIC, decoded.magic);
    try std.testing.expectEqual(types.PROTOCOL_VERSION, decoded.version);
    try std.testing.expectEqual(original_type, decoded.msg_type);
    try std.testing.expectEqual(original_len, decoded.length);
}

test "decodeHeader returns null for bad magic" {
    var bad_bytes = [_]u8{ 0xFF, 0xFF, 1, 0x02, 0, 0, 0, 0 };
    try std.testing.expect(decodeHeader(&bad_bytes) == null);
}

test "decodeHeader returns null for short data" {
    var short_bytes = [_]u8{ 0x56, 0x50, 1 };
    try std.testing.expect(decodeHeader(&short_bytes) == null);
}

test "encodeFrame and decodeFrame roundtrip" {
    const allocator = std.testing.allocator;
    const payload = "hello viewport";
    const frame = try encodeFrame(allocator, .define, payload);
    defer allocator.free(frame);

    const result = decodeFrame(frame).?;
    try std.testing.expectEqual(types.MessageType.define, result.header.msg_type);
    try std.testing.expectEqual(@as(u32, @intCast(payload.len)), result.header.length);
    try std.testing.expectEqualStrings(payload, result.payload);
}

test "FrameReader streaming" {
    const allocator = std.testing.allocator;
    var reader = FrameReader.init(allocator);
    defer reader.deinit();

    // Build two frames
    const frame1 = try encodeFrame(allocator, .tree, "payload1");
    defer allocator.free(frame1);
    const frame2 = try encodeFrame(allocator, .patch, "p2");
    defer allocator.free(frame2);

    // Feed first frame in two parts
    const split = 5;
    {
        var frames = try reader.feed(frame1[0..split]);
        defer frames.deinit();
        try std.testing.expectEqual(@as(usize, 0), frames.items.len);
    }

    {
        // Feed rest of frame1 + all of frame2
        const rest = try allocator.alloc(u8, frame1.len - split + frame2.len);
        defer allocator.free(rest);
        @memcpy(rest[0 .. frame1.len - split], frame1[split..]);
        @memcpy(rest[frame1.len - split ..], frame2);

        var frames = try reader.feed(rest);
        defer {
            for (frames.items) |f| {
                allocator.free(@constCast(f.payload));
            }
            frames.deinit();
        }

        try std.testing.expectEqual(@as(usize, 2), frames.items.len);
        try std.testing.expectEqual(types.MessageType.tree, frames.items[0].header.msg_type);
        try std.testing.expectEqual(types.MessageType.patch, frames.items[1].header.msg_type);
    }

    try std.testing.expectEqual(@as(usize, 0), reader.pendingBytes());
}
