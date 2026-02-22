/**
 * Component builder functions.
 *
 * These provide a convenient declarative API for building VNode trees.
 * Test apps code against these instead of constructing VNodes manually.
 */

import type { VNode, NodeProps } from '../core/types.js';

let nextId = 50000;

/** Reset the auto-ID counter (useful between test runs). */
export function resetIdCounter(start = 50000): void {
  nextId = start;
}

/** Get the next auto-generated ID. */
function autoId(): number {
  return nextId++;
}

type BoxProps = Pick<
  NodeProps,
  | 'direction' | 'wrap' | 'justify' | 'align' | 'gap'
  | 'padding' | 'margin' | 'border' | 'borderRadius'
  | 'background' | 'opacity' | 'shadow'
  | 'width' | 'height' | 'flex' | 'minWidth' | 'minHeight' | 'maxWidth' | 'maxHeight'
  | 'interactive' | 'tabIndex' | 'style' | 'transition'
>;

type TextProps = Pick<
  NodeProps,
  | 'content' | 'fontFamily' | 'size' | 'weight' | 'color'
  | 'decoration' | 'textAlign' | 'italic' | 'style'
>;

type ScrollProps = BoxProps & Pick<
  NodeProps,
  'virtualHeight' | 'virtualWidth' | 'scrollTop' | 'scrollLeft' | 'schema'
>;

type InputFieldProps = Pick<
  NodeProps,
  'value' | 'placeholder' | 'multiline' | 'disabled' | 'width' | 'style'
>;

/** Create a box layout node. */
export function box(
  props: BoxProps & { id?: number },
  children?: VNode[]
): VNode {
  const { id, ...rest } = props;
  return {
    id: id ?? autoId(),
    type: 'box',
    props: rest as NodeProps,
    children: children ?? [],
  };
}

/** Create a text content node. */
export function text(
  props: TextProps & { id?: number }
): VNode {
  const { id, ...rest } = props;
  return {
    id: id ?? autoId(),
    type: 'text',
    props: rest as NodeProps,
  };
}

/** Create a scrollable region. */
export function scroll(
  props: ScrollProps & { id?: number },
  children?: VNode[]
): VNode {
  const { id, ...rest } = props;
  return {
    id: id ?? autoId(),
    type: 'scroll',
    props: rest as NodeProps,
    children: children ?? [],
  };
}

/** Create a text input field. */
export function input(
  props: InputFieldProps & { id?: number }
): VNode {
  const { id, ...rest } = props;
  return {
    id: id ?? autoId(),
    type: 'input',
    props: rest as NodeProps,
  };
}

/** Create a separator line. */
export function separator(id?: number): VNode {
  return {
    id: id ?? autoId(),
    type: 'separator',
    props: {},
  };
}

/** Create an image node. */
export function image(
  props: Pick<NodeProps, 'altText' | 'width' | 'height' | 'format'> & { id?: number }
): VNode {
  const { id, ...rest } = props;
  return {
    id: id ?? autoId(),
    type: 'image',
    props: rest as NodeProps,
  };
}

/** Create a canvas node. */
export function canvas(
  props: Pick<NodeProps, 'width' | 'height' | 'altText' | 'mode'> & { id?: number }
): VNode {
  const { id, ...rest } = props;
  return {
    id: id ?? autoId(),
    type: 'canvas',
    props: rest as NodeProps,
  };
}

// ── Convenience compound builders ──────────────────────────────────

/** A clickable box (button-like). */
export function clickable(
  props: BoxProps & { id?: number },
  children?: VNode[]
): VNode {
  return box({ ...props, interactive: 'clickable' }, children);
}

/** A row layout. */
export function row(
  props: Omit<BoxProps, 'direction'> & { id?: number },
  children?: VNode[]
): VNode {
  return box({ ...props, direction: 'row' }, children);
}

/** A column layout. */
export function column(
  props: Omit<BoxProps, 'direction'> & { id?: number },
  children?: VNode[]
): VNode {
  return box({ ...props, direction: 'column' }, children);
}

/** A styled heading text. */
export function heading(
  content: string,
  id?: number
): VNode {
  return text({ id, content, weight: 'bold', size: 20 });
}

/** A styled label text. */
export function label(
  content: string,
  id?: number
): VNode {
  return text({ id, content, weight: 'bold' });
}

/** A dim/muted text. */
export function muted(
  content: string,
  id?: number
): VNode {
  return text({ id, content, color: '#6c7086' });
}
