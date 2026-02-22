/**
 * Canonical integer property keys for the Viewport wire format.
 *
 * CBOR encodes small integers (0-23) in a single byte, making
 * integer keys more compact than even abbreviated string keys.
 * These IDs are versioned and well-defined — adding new ones
 * always appends to the enum (never reuses IDs).
 *
 * This is the authoritative mapping used by all language
 * implementations (TS, Zig, Go).
 */

/** Property keys for VNode serialization. */
export const enum NodeKey {
  // Core (0-9)
  ID          = 0,
  TYPE        = 1,
  CHILDREN    = 2,
  TEXT_ALT    = 3,

  // Layout (10-19)
  DIRECTION   = 10,
  WRAP        = 11,
  JUSTIFY     = 12,
  ALIGN       = 13,
  GAP         = 14,

  // Spacing (20-24)
  PADDING     = 20,
  MARGIN      = 21,

  // Visual (25-34)
  BORDER      = 25,
  BORDER_RADIUS = 26,
  BACKGROUND  = 27,
  OPACITY     = 28,
  SHADOW      = 29,

  // Sizing (35-44)
  WIDTH       = 35,
  HEIGHT      = 36,
  FLEX        = 37,
  MIN_WIDTH   = 38,
  MIN_HEIGHT  = 39,
  MAX_WIDTH   = 40,
  MAX_HEIGHT  = 41,

  // Text (45-59)
  CONTENT     = 45,
  FONT_FAMILY = 46,
  SIZE        = 47,
  WEIGHT      = 48,
  COLOR       = 49,
  DECORATION  = 50,
  TEXT_ALIGN  = 51,
  ITALIC      = 52,

  // Scroll (60-69)
  VIRTUAL_HEIGHT = 60,
  VIRTUAL_WIDTH  = 61,
  SCROLL_TOP  = 62,
  SCROLL_LEFT = 63,
  SCHEMA      = 64,

  // Input (70-79)
  VALUE       = 70,
  PLACEHOLDER = 71,
  MULTILINE   = 72,
  DISABLED    = 73,

  // Image/Canvas (80-89)
  DATA        = 80,
  FORMAT      = 81,
  ALT_TEXT    = 82,
  MODE        = 83,

  // Interactive (90-94)
  INTERACTIVE = 90,
  TAB_INDEX   = 91,
  STYLE       = 92,
  TRANSITION  = 93,
}

/** Property keys for PatchOp serialization. */
export const enum PatchKey {
  TARGET          = 0,
  SET             = 1,
  REMOVE          = 2,
  REPLACE         = 3,
  CHILDREN_INSERT = 4,
  CHILDREN_REMOVE = 5,
  CHILDREN_MOVE   = 6,
  TRANSITION      = 7,
  INDEX           = 8,
  NODE            = 9,
  FROM            = 10,
  TO              = 11,
}

/** Property keys for InputEvent serialization. */
export const enum InputKey {
  TARGET      = 0,
  KIND        = 1,
  KEY         = 2,
  VALUE       = 3,
  X           = 4,
  Y           = 5,
  BUTTON      = 6,
  ACTION      = 7,
  SCROLL_TOP  = 8,
  SCROLL_LEFT = 9,
}

/** Property keys for SchemaColumn serialization. */
export const enum SchemaKey {
  ID     = 0,
  NAME   = 1,
  TYPE   = 2,
  UNIT   = 3,
  FORMAT = 4,
}

/** Property keys for SlotValue serialization. */
export const enum SlotKey {
  KIND = 0,
  // Additional fields are encoded by their string name since
  // slot values are open-ended ({kind: string, [key: string]: unknown}).
  // The `kind` field is the only one that gets an integer key.
}

/**
 * Bidirectional mapping from NodeKey integers to property name strings.
 * Used by encode/decode to translate between wire format and VNode props.
 */
export const NODE_KEY_TO_PROP: Record<number, string> = {
  [NodeKey.ID]: 'id',
  [NodeKey.TYPE]: 'type',
  [NodeKey.CHILDREN]: 'children',
  [NodeKey.TEXT_ALT]: 'textAlt',
  [NodeKey.DIRECTION]: 'direction',
  [NodeKey.WRAP]: 'wrap',
  [NodeKey.JUSTIFY]: 'justify',
  [NodeKey.ALIGN]: 'align',
  [NodeKey.GAP]: 'gap',
  [NodeKey.PADDING]: 'padding',
  [NodeKey.MARGIN]: 'margin',
  [NodeKey.BORDER]: 'border',
  [NodeKey.BORDER_RADIUS]: 'borderRadius',
  [NodeKey.BACKGROUND]: 'background',
  [NodeKey.OPACITY]: 'opacity',
  [NodeKey.SHADOW]: 'shadow',
  [NodeKey.WIDTH]: 'width',
  [NodeKey.HEIGHT]: 'height',
  [NodeKey.FLEX]: 'flex',
  [NodeKey.MIN_WIDTH]: 'minWidth',
  [NodeKey.MIN_HEIGHT]: 'minHeight',
  [NodeKey.MAX_WIDTH]: 'maxWidth',
  [NodeKey.MAX_HEIGHT]: 'maxHeight',
  [NodeKey.CONTENT]: 'content',
  [NodeKey.FONT_FAMILY]: 'fontFamily',
  [NodeKey.SIZE]: 'size',
  [NodeKey.WEIGHT]: 'weight',
  [NodeKey.COLOR]: 'color',
  [NodeKey.DECORATION]: 'decoration',
  [NodeKey.TEXT_ALIGN]: 'textAlign',
  [NodeKey.ITALIC]: 'italic',
  [NodeKey.VIRTUAL_HEIGHT]: 'virtualHeight',
  [NodeKey.VIRTUAL_WIDTH]: 'virtualWidth',
  [NodeKey.SCROLL_TOP]: 'scrollTop',
  [NodeKey.SCROLL_LEFT]: 'scrollLeft',
  [NodeKey.SCHEMA]: 'schema',
  [NodeKey.VALUE]: 'value',
  [NodeKey.PLACEHOLDER]: 'placeholder',
  [NodeKey.MULTILINE]: 'multiline',
  [NodeKey.DISABLED]: 'disabled',
  [NodeKey.DATA]: 'data',
  [NodeKey.FORMAT]: 'format',
  [NodeKey.ALT_TEXT]: 'altText',
  [NodeKey.MODE]: 'mode',
  [NodeKey.INTERACTIVE]: 'interactive',
  [NodeKey.TAB_INDEX]: 'tabIndex',
  [NodeKey.STYLE]: 'style',
  [NodeKey.TRANSITION]: 'transition',
};

/** Reverse mapping: property name → NodeKey integer. */
export const PROP_TO_NODE_KEY: Record<string, number> = {};
for (const [key, prop] of Object.entries(NODE_KEY_TO_PROP)) {
  PROP_TO_NODE_KEY[prop] = Number(key);
}
