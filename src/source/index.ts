/**
 * Source-side library — local state model for app-side code.
 *
 * Provides SourceState (pending + published state management),
 * SourceConnection (AppConnection backed by SourceState),
 * and flush helpers for common timing patterns.
 */

export { SourceState } from './state.js';
export type { PublishedSnapshot } from './state.js';
export { SourceConnection, createSourceConnection } from './connection.js';
export { autoFlush, flushOnIdle, flushImmediate } from './flush.js';
export type { Disposable, FlushCallback } from './flush.js';
