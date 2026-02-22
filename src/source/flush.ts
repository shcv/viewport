/**
 * Flush helpers — common patterns for controlling when the SourceState
 * flushes pending changes to the transport.
 *
 * These are composable utilities that wrap SourceState.flush() with
 * different timing strategies.
 */

import type { ProtocolMessage } from '../core/types.js';
import type { SourceState } from './state.js';

/** A disposable handle that can be cleaned up. */
export interface Disposable {
  dispose(): void;
}

/** Callback invoked when messages are flushed. */
export type FlushCallback = (messages: ProtocolMessage[]) => void;

/**
 * Flush on a fixed interval (tick-based).
 *
 * Pending changes accumulate between ticks. On each tick, if there
 * are pending changes, flush them and call the callback.
 *
 * @param state - The SourceState to flush
 * @param onFlush - Called with the flushed messages
 * @param intervalMs - Tick interval in milliseconds (default: 16ms ≈ 60fps)
 */
export function autoFlush(
  state: SourceState,
  onFlush: FlushCallback,
  intervalMs = 16,
): Disposable {
  const timer = setInterval(() => {
    if (state.hasPending()) {
      const messages = state.flush();
      if (messages.length > 0) {
        onFlush(messages);
      }
    }
  }, intervalMs);

  return {
    dispose() {
      clearInterval(timer);
      // Flush any remaining pending changes
      if (state.hasPending()) {
        const messages = state.flush();
        if (messages.length > 0) {
          onFlush(messages);
        }
      }
    },
  };
}

/**
 * Flush when the event loop is idle (microtask-based).
 *
 * Batches all synchronous mutations into a single flush at the end
 * of the current microtask. This is the most natural pattern for
 * frameworks that batch state updates (like React).
 *
 * @param state - The SourceState to flush
 * @param onFlush - Called with the flushed messages
 */
export function flushOnIdle(
  state: SourceState,
  onFlush: FlushCallback,
): Disposable {
  let scheduled = false;
  let disposed = false;

  // Wrap state mutation methods to schedule a flush
  const originalFlush = state.flush.bind(state);

  function scheduleFlush(): void {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (disposed) return;
      if (state.hasPending()) {
        const messages = originalFlush();
        if (messages.length > 0) {
          onFlush(messages);
        }
      }
    });
  }

  // Monkey-patch the mutation methods to trigger scheduling.
  // This is intentionally lightweight — we intercept the public API
  // rather than requiring the caller to remember to schedule.
  const origSetTree = state.setTree.bind(state);
  const origPatch = state.patch.bind(state);
  const origDefineSlot = state.defineSlot.bind(state);
  const origDefineSchema = state.defineSchema.bind(state);
  const origEmitData = state.emitData.bind(state);

  state.setTree = (...args) => { origSetTree(...args); scheduleFlush(); };
  state.patch = (...args) => { origPatch(...args); scheduleFlush(); };
  state.defineSlot = (...args) => { origDefineSlot(...args); scheduleFlush(); };
  state.defineSchema = (...args) => { origDefineSchema(...args); scheduleFlush(); };
  state.emitData = (...args) => { origEmitData(...args); scheduleFlush(); };

  return {
    dispose() {
      disposed = true;
      // Restore original methods
      state.setTree = origSetTree;
      state.patch = origPatch;
      state.defineSlot = origDefineSlot;
      state.defineSchema = origDefineSchema;
      state.emitData = origEmitData;
      // Final flush
      if (state.hasPending()) {
        const messages = originalFlush();
        if (messages.length > 0) {
          onFlush(messages);
        }
      }
    },
  };
}

/**
 * Flush immediately after every mutation (synchronous).
 *
 * This preserves the current behavior where each app call results in
 * an immediate message. No coalescing, no batching.
 *
 * @param state - The SourceState to flush
 * @param onFlush - Called with the flushed messages
 */
export function flushImmediate(
  state: SourceState,
  onFlush: FlushCallback,
): Disposable {
  let disposed = false;

  const origSetTree = state.setTree.bind(state);
  const origPatch = state.patch.bind(state);
  const origDefineSlot = state.defineSlot.bind(state);
  const origDefineSchema = state.defineSchema.bind(state);
  const origEmitData = state.emitData.bind(state);

  function doFlush(): void {
    if (disposed) return;
    const messages = state.flush();
    if (messages.length > 0) {
      onFlush(messages);
    }
  }

  state.setTree = (...args) => { origSetTree(...args); doFlush(); };
  state.patch = (...args) => { origPatch(...args); doFlush(); };
  state.defineSlot = (...args) => { origDefineSlot(...args); doFlush(); };
  state.defineSchema = (...args) => { origDefineSchema(...args); doFlush(); };
  state.emitData = (...args) => { origEmitData(...args); doFlush(); };

  return {
    dispose() {
      disposed = true;
      state.setTree = origSetTree;
      state.patch = origPatch;
      state.defineSlot = origDefineSlot;
      state.defineSchema = origDefineSchema;
      state.emitData = origEmitData;
    },
  };
}
