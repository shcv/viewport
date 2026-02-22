/**
 * Viewer-side library — local state model and viewer implementations.
 *
 * ViewerState manages the committed render tree with dirty tracking,
 * decoupling message ingestion from rendering.
 */

export { ViewerState } from './state.js';
export type { DirtySet } from './state.js';
export { HeadlessViewer, createHeadlessViewer } from './headless/index.js';
export { DomViewer, createDomViewer } from './dom/index.js';
export { AnsiViewer, createAnsiViewer } from './ansi/index.js';
export { GpuViewer, createGpuViewer } from './gpu/index.js';
