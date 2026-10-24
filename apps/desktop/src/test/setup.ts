import '@testing-library/jest-dom/vitest';

// jsdom has no ResizeObserver; the viewport is mocked in tests but Radix needs this too.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

// jsdom does not implement scrolling; the Output panel scrolls to its newest entry.
Element.prototype.scrollIntoView ??= () => {};
