/**
 * Counter app — the simplest interactive test case.
 *
 * Exercises: basic tree, patches (content update), click handling,
 * keyboard input, focus management.
 */

import { defineApp, box, text, clickable, column, row } from '../app-sdk/index.js';
import type { AppConnection } from '../core/types.js';

// Stable IDs for all nodes
const ID = {
  ROOT: 1,
  TITLE: 2,
  DISPLAY: 3,
  CONTROLS: 4,
  DEC_BTN: 5,
  DEC_LABEL: 6,
  INC_BTN: 7,
  INC_LABEL: 8,
  RESET_BTN: 9,
  RESET_LABEL: 10,
  STATUS: 11,
} as const;

export const counterApp = defineApp({
  name: 'counter',
  description: 'Simple counter with increment/decrement buttons. Tests basic tree, patches, and click handling.',

  setup(conn: AppConnection) {
    let count = 0;

    function updateDisplay() {
      conn.patch([
        { target: ID.DISPLAY, set: { content: `Count: ${count}` } },
        { target: ID.STATUS, set: { content: `Last action at ${new Date().toISOString()}` } },
      ]);
    }

    // Build initial tree
    conn.setTree(
      column({ id: ID.ROOT, padding: 16, gap: 12 }, [
        text({ id: ID.TITLE, content: 'Counter', weight: 'bold', size: 20 }),

        text({ id: ID.DISPLAY, content: `Count: ${count}`, size: 16, fontFamily: 'monospace' }),

        row({ id: ID.CONTROLS, gap: 8 }, [
          clickable({
            id: ID.DEC_BTN,
            background: '#f38ba8',
            padding: [4, 12],
            borderRadius: 4,
          }, [
            text({ id: ID.DEC_LABEL, content: '  -  ', color: '#fff' }),
          ]),

          clickable({
            id: ID.INC_BTN,
            background: '#a6e3a1',
            padding: [4, 12],
            borderRadius: 4,
          }, [
            text({ id: ID.INC_LABEL, content: '  +  ', color: '#1e1e2e' }),
          ]),

          clickable({
            id: ID.RESET_BTN,
            background: '#6c7086',
            padding: [4, 12],
            borderRadius: 4,
          }, [
            text({ id: ID.RESET_LABEL, content: 'Reset', color: '#fff' }),
          ]),
        ]),

        text({ id: ID.STATUS, content: 'Ready', color: '#6c7086', size: 12 }),
      ])
    );

    // Handle input events
    conn.onInput((event) => {
      if (event.kind === 'click') {
        switch (event.target) {
          case ID.DEC_BTN:
          case ID.DEC_LABEL:
            count--;
            updateDisplay();
            break;
          case ID.INC_BTN:
          case ID.INC_LABEL:
            count++;
            updateDisplay();
            break;
          case ID.RESET_BTN:
          case ID.RESET_LABEL:
            count = 0;
            updateDisplay();
            break;
        }
      }

      if (event.kind === 'key') {
        switch (event.key) {
          case 'ArrowUp':
          case 'k':
            count++;
            updateDisplay();
            break;
          case 'ArrowDown':
          case 'j':
            count--;
            updateDisplay();
            break;
          case 'r':
            count = 0;
            updateDisplay();
            break;
        }
      }
    });

    return {};
  },
});
