/**
 * Native GPU Viewer — wgpu-based renderer for Viewport.
 *
 * This module provides the TypeScript-side architecture and types for
 * a native GPU viewer that would use wgpu + Taffy + HarfBuzz for
 * production rendering. The actual GPU rendering is a native component;
 * this module provides:
 *
 * 1. The GpuViewer class implementing ViewerBackend (test/CI mode)
 * 2. Type definitions for the native FFI bridge
 * 3. Render pipeline configuration types
 * 4. Shader and resource descriptors
 */

export { GpuViewer, createGpuViewer } from './viewer.js';
export type {
  GpuConfig,
  GpuRenderPipeline,
  GpuTextAtlas,
  GpuRect,
  GpuCommand,
  NativeGpuBridge,
} from './types.js';
