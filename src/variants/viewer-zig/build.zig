const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // ── Library ──────────────────────────────────────────────────────

    const lib = b.addStaticLibrary(.{
        .name = "viewport-viewer",
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
    });
    b.installArtifact(lib);

    // ── Shared module for downstream consumers ──────────────────────

    _ = b.addModule("viewport", .{
        .root_source_file = b.path("src/main.zig"),
    });

    // ── Unit tests ──────────────────────────────────────────────────

    const test_step = b.step("test", "Run unit tests");

    const test_sources = [_][]const u8{
        "src/types.zig",
        "src/wire.zig",
        "src/tree.zig",
        "src/text_projection.zig",
        "src/viewer.zig",
        "src/main.zig",
    };

    for (test_sources) |source| {
        const t = b.addTest(.{
            .root_source_file = b.path(source),
            .target = target,
            .optimize = optimize,
        });
        const run_t = b.addRunArtifact(t);
        test_step.dependOn(&run_t.step);
    }

    // ── Example / smoke test binary ─────────────────────────────────

    const exe = b.addExecutable(.{
        .name = "viewport-example",
        .root_source_file = b.path("src/example.zig"),
        .target = target,
        .optimize = optimize,
    });
    b.installArtifact(exe);

    const run_cmd = b.addRunArtifact(exe);
    run_cmd.step.dependOn(b.getInstallStep());

    const run_step = b.step("run", "Run the example");
    run_step.dependOn(&run_cmd.step);
}
