// jsdom lacks a few browser APIs that Radix primitives and the theme toggle rely on.
const noop = (): void => undefined;

function defineMissing(target: object, key: string, value: unknown): void {
  // Some of these exist on jsdom objects as undefined, so test the value, not the key.
  if ((target as Record<string, unknown>)[key] !== undefined) return;
  Object.defineProperty(target, key, { value, configurable: true, writable: true });
}

defineMissing(
  globalThis,
  'ResizeObserver',
  class {
    observe = noop;
    unobserve = noop;
    disconnect = noop;
  },
);

if (typeof window !== 'undefined') {
  defineMissing(window, 'matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: noop,
    removeEventListener: noop,
    addListener: noop,
    removeListener: noop,
    dispatchEvent: () => false,
  }));
  defineMissing(Element.prototype, 'scrollIntoView', noop);
  defineMissing(Element.prototype, 'hasPointerCapture', () => false);
  defineMissing(Element.prototype, 'setPointerCapture', noop);
  defineMissing(Element.prototype, 'releasePointerCapture', noop);
}
