/**
 * A tiny DOM builder. Screens are small functions that return elements, so there is no framework
 * to learn; if screens multiply, Preact or Svelte can replace this file without touching the engine.
 *
 * Text is always added as text nodes (never innerHTML), so names and story text from data can
 * never inject markup.
 */

export type Child = Node | string | number | false | null | undefined;
export type Props = Record<string, unknown>;

const PROPERTY_KEYS = new Set([
  'value',
  'checked',
  'selected',
  'disabled',
  'indeterminate',
  'open',
]);
const SVG_NS = 'http://www.w3.org/2000/svg';

function applyProps(el: Element, props: Props | null | undefined): void {
  if (!props) return;
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'dataset' && typeof value === 'object') {
      Object.assign((el as HTMLElement).dataset, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (PROPERTY_KEYS.has(key)) {
      (el as unknown as Record<string, unknown>)[key] = value;
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
}

export function append(parent: Node, children: readonly (Child | readonly Child[])[]): void {
  for (const child of children) {
    if (Array.isArray(child)) append(parent, child);
    else if (child === null || child === undefined || child === false) continue;
    else if (typeof child === 'string' || typeof child === 'number')
      parent.appendChild(document.createTextNode(String(child)));
    else parent.appendChild(child as Node);
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: (Child | readonly Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  applyProps(el, props);
  append(el, children);
  return el;
}

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: (Child | readonly Child[])[]
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  applyProps(el, props);
  append(el, children);
  return el;
}

export function clear(el: Element): void {
  el.replaceChildren();
}

/** Visually hidden text for screen readers. */
export function srOnly(text: string): HTMLSpanElement {
  return h('span', { class: 'sr-only' }, text);
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}
