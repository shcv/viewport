/**
 * GPU viewer type definitions.
 *
 * These types define the interface between the TypeScript harness
 * and the native GPU rendering engine. In production, a native
 * binary (Rust/Zig) would implement NativeGpuBridge and handle
 * actual GPU rendering via wgpu.
 */

/** Configuration for the GPU viewer. */
export interface GpuConfig {
  /** GPU API to use. */
  api: 'vulkan' | 'metal' | 'dx12' | 'webgpu';
  /** Enable MSAA. */
  msaa: 1 | 2 | 4 | 8;
  /** Target frame rate. */
  targetFps: number;
  /** Background color (RGBA). */
  clearColor: [number, number, number, number];
  /** Font configuration. */
  font: {
    family: string;
    sizePx: number;
    /** Path to font file for HarfBuzz shaping. */
    path?: string;
  };
  /** Layout engine to use. */
  layoutEngine: 'taffy' | 'yoga' | 'pure-ts';
  /** Debug overlays. */
  debug: {
    wireframe: boolean;
    layoutBounds: boolean;
    textAtlas: boolean;
    gpuTimings: boolean;
  };
}

/** A render pipeline stage for the GPU viewer. */
export interface GpuRenderPipeline {
  /** Pipeline stages in execution order. */
  stages: GpuPipelineStage[];
}

export interface GpuPipelineStage {
  name: string;
  type: 'compute' | 'render';
  /** Shader source (WGSL). */
  shader: string;
  /** Bind group layout. */
  bindings: GpuBinding[];
}

export interface GpuBinding {
  group: number;
  binding: number;
  type: 'uniform' | 'storage' | 'texture' | 'sampler';
  name: string;
}

/** Text atlas for glyph rendering. */
export interface GpuTextAtlas {
  /** Atlas texture dimensions. */
  width: number;
  height: number;
  /** Glyph entries. */
  glyphs: Map<string, GpuGlyphEntry>;
}

export interface GpuGlyphEntry {
  /** Unicode codepoint. */
  codepoint: number;
  /** Position in atlas. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Bearing for text layout. */
  bearingX: number;
  bearingY: number;
  advance: number;
}

/** A rectangle in GPU coordinates. */
export interface GpuRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Corner radii [topLeft, topRight, bottomRight, bottomLeft]. */
  cornerRadii?: [number, number, number, number];
  /** Fill color (RGBA). */
  color: [number, number, number, number];
  /** Border width. */
  borderWidth?: number;
  /** Border color (RGBA). */
  borderColor?: [number, number, number, number];
  /** Shadow. */
  shadow?: {
    offsetX: number;
    offsetY: number;
    blur: number;
    color: [number, number, number, number];
  };
}

/** A GPU render command. */
export type GpuCommand =
  | { type: 'rect'; rect: GpuRect }
  | { type: 'text'; x: number; y: number; text: string; color: [number, number, number, number]; sizePx: number }
  | { type: 'clip'; rect: GpuRect }
  | { type: 'unclip' }
  | { type: 'image'; x: number; y: number; width: number; height: number; textureId: number };

/**
 * Native GPU bridge interface.
 *
 * In production, this would be implemented by a native binary
 * (Rust with wgpu, or Zig with WebGPU bindings) that:
 * 1. Creates a GPU device and surface
 * 2. Manages render pipelines and shader compilation
 * 3. Maintains a text atlas via HarfBuzz shaping
 * 4. Executes render command lists
 * 5. Presents frames to the surface
 *
 * For testing, GpuViewer provides a software-rasterized fallback.
 */
export interface NativeGpuBridge {
  /** Initialize the GPU device and surface. */
  init(config: GpuConfig): Promise<void>;
  /** Submit a batch of render commands for the current frame. */
  submit(commands: GpuCommand[]): void;
  /** Present the current frame. */
  present(): void;
  /** Read back the framebuffer as RGBA pixels. */
  readPixels(): Uint8Array;
  /** Get GPU timing information. */
  getTimings(): { gpuTimeMs: number; presentTimeMs: number };
  /** Destroy the GPU context. */
  destroy(): void;
}
