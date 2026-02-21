/**
 * Chat app — message list with input.
 *
 * Exercises: scroll + append, input field interaction, dynamic
 * content growth, child insertion patches, focus handling.
 */

import { defineApp, box, text, scroll, column, row, input, clickable, separator } from '../app-sdk/index.js';
import type { AppConnection } from '../core/types.js';

const ID = {
  ROOT: 1,
  TITLE: 2,
  MESSAGE_LIST: 3,
  INPUT_ROW: 10,
  MSG_INPUT: 11,
  SEND_BTN: 12,
  SEND_LABEL: 13,
  STATUS: 20,
  // Messages start at 100, each gets 10 IDs
  MSG_BASE: 100,
} as const;

const MSG_BLOCK = 10; // IDs per message

interface ChatMessage {
  id: number;
  sender: string;
  text: string;
  time: string;
  isUser: boolean;
}

const INITIAL_MESSAGES: ChatMessage[] = [
  { id: 0, sender: 'System', text: 'Welcome to the chat!', time: '10:00', isUser: false },
  { id: 1, sender: 'Alice', text: 'Hey, has anyone looked at the new Viewport protocol?', time: '10:01', isUser: false },
  { id: 2, sender: 'Bob', text: 'Yes! The text projection feature is interesting.', time: '10:02', isUser: false },
  { id: 3, sender: 'Alice', text: 'I like how it handles structured data pipelines.', time: '10:03', isUser: false },
  { id: 4, sender: 'You', text: 'The layout engine using Taffy seems like a good choice.', time: '10:04', isUser: true },
  { id: 5, sender: 'Bob', text: 'Agreed. Flexbox+grid covers most TUI layouts.', time: '10:05', isUser: false },
];

// Canned responses for simulating a conversation
const BOT_RESPONSES = [
  'That\'s a great point! The protocol is designed to be compact.',
  'I think the tiered adoption model is key to getting traction.',
  'Have you tried building anything with the slot definition system?',
  'The remote transport improvements over SSH should be significant.',
  'MCP integration would make this really powerful for agent workflows.',
  'The canvas/WebGPU escape hatch is smart — covers edge cases without bloating the core.',
];

export const chatApp = defineApp({
  name: 'chat',
  description: 'Chat interface with message history and input. Tests scroll append, input, dynamic growth.',

  setup(conn: AppConnection) {
    const messages = [...INITIAL_MESSAGES];
    let inputValue = '';
    let nextMsgId = messages.length;
    let botResponseIdx = 0;
    let typingIndicator = false;

    function messageBaseId(msgIdx: number): number {
      return ID.MSG_BASE + msgIdx * MSG_BLOCK;
    }

    function buildMessage(msg: ChatMessage, idx: number) {
      const base = messageBaseId(idx);
      const align = msg.isUser ? 'end' : 'start';
      const bgColor = msg.isUser ? '#89b4fa' : '#313244';
      const textColor = msg.isUser ? '#1e1e2e' : '#cdd6f4';

      return row({
        id: base,
        justify: align,
        padding: [2, 0],
      }, [
        column({
          id: base + 1,
          maxWidth: 400,
          padding: [8, 12],
          borderRadius: 12,
          background: bgColor,
          gap: 4,
        }, [
          row({ gap: 8, justify: 'between' }, [
            text({
              id: base + 2,
              content: msg.sender,
              weight: 'bold',
              size: 12,
              color: msg.isUser ? '#1e1e2e' : '#89b4fa',
            }),
            text({
              id: base + 3,
              content: msg.time,
              size: 10,
              color: msg.isUser ? '#45475a' : '#6c7086',
            }),
          ]),
          text({
            id: base + 4,
            content: msg.text,
            color: textColor,
          }),
        ]),
      ]);
    }

    function buildTree() {
      conn.setTree(
        column({ id: ID.ROOT, padding: 0, gap: 0, height: '100%' }, [
          // Title bar
          box({
            id: ID.TITLE,
            padding: [8, 16],
            background: '#181825',
          }, [
            text({ content: 'Viewport Chat', weight: 'bold', size: 16 }),
          ]),

          // Message list
          scroll({
            id: ID.MESSAGE_LIST,
            flex: 1,
            padding: 12,
            direction: 'column',
            gap: 4,
          }, [
            ...messages.map((msg, i) => buildMessage(msg, i)),
            ...(typingIndicator ? [
              row({ justify: 'start', padding: [2, 0] }, [
                box({
                  padding: [8, 12],
                  borderRadius: 12,
                  background: '#313244',
                }, [
                  text({ content: 'Alice is typing...', color: '#6c7086', italic: true, size: 12 }),
                ]),
              ]),
            ] : []),
          ]),

          // Status bar
          text({
            id: ID.STATUS,
            content: `${messages.length} messages`,
            size: 11,
            color: '#6c7086',
            padding: [2, 16],
          }),

          // Input row
          row({
            id: ID.INPUT_ROW,
            gap: 8,
            padding: [8, 12],
            background: '#181825',
            align: 'center',
          }, [
            input({
              id: ID.MSG_INPUT,
              value: inputValue,
              placeholder: 'Type a message...',
              width: 500,
            }),
            clickable({
              id: ID.SEND_BTN,
              padding: [8, 16],
              borderRadius: 8,
              background: inputValue.trim() ? '#89b4fa' : '#313244',
            }, [
              text({
                id: ID.SEND_LABEL,
                content: 'Send',
                color: inputValue.trim() ? '#1e1e2e' : '#6c7086',
                weight: 'bold',
              }),
            ]),
          ]),
        ])
      );
    }

    function sendMessage() {
      if (!inputValue.trim()) return;

      const msg: ChatMessage = {
        id: nextMsgId++,
        sender: 'You',
        text: inputValue.trim(),
        time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
        isUser: true,
      };

      messages.push(msg);
      inputValue = '';

      // Use patch to append instead of full rebuild
      conn.patch([
        {
          target: ID.MESSAGE_LIST,
          childrenInsert: {
            index: messages.length - 1,
            node: buildMessage(msg, messages.length - 1),
          },
        },
        { target: ID.MSG_INPUT, set: { value: '' } },
        { target: ID.STATUS, set: { content: `${messages.length} messages` } },
        { target: ID.SEND_LABEL, set: { color: '#6c7086' } },
        { target: ID.SEND_BTN, set: { background: '#313244' } },
      ]);

      // Simulate bot response
      typingIndicator = true;
      buildTree(); // rebuild to show typing indicator

      // The harness or automation can trigger the response by sending a special key
    }

    function simulateBotReply() {
      typingIndicator = false;
      const response: ChatMessage = {
        id: nextMsgId++,
        sender: 'Alice',
        text: BOT_RESPONSES[botResponseIdx % BOT_RESPONSES.length],
        time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
        isUser: false,
      };
      botResponseIdx++;
      messages.push(response);
      buildTree();
    }

    buildTree();

    conn.onInput((event) => {
      if (event.kind === 'value_change' && event.target === ID.MSG_INPUT) {
        inputValue = event.value ?? '';
        // Update send button appearance
        conn.patch([
          { target: ID.SEND_LABEL, set: { color: inputValue.trim() ? '#1e1e2e' : '#6c7086' } },
          { target: ID.SEND_BTN, set: { background: inputValue.trim() ? '#89b4fa' : '#313244' } },
        ]);
      }

      if (event.kind === 'click') {
        if (event.target === ID.SEND_BTN || event.target === ID.SEND_LABEL) {
          sendMessage();
        }
      }

      if (event.kind === 'key') {
        if (event.key === 'Enter') {
          sendMessage();
        }
        // Special key to simulate bot response (for automation testing)
        if (event.key === 'F5') {
          simulateBotReply();
        }
      }
    });

    return {};
  },
});
