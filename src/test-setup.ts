// Global Vitest setup. Extends `expect` with `@testing-library/jest-dom`
// matchers (toBeInTheDocument, toHaveTextContent, etc.) and stubs the
// browser globals that Capacitor + i18next routinely reach for so tests
// don't have to mock them per-suite.

import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// React Testing Library: unmount components between tests.
afterEach(() => cleanup());

// matchMedia — used by next-themes, framer-motion, and a few responsive
// components. jsdom doesn't ship one. Default to "no match" (mobile-first
// queries return false → render the desktop variant if the component
// reads at mount). Tests that care override with vi.spyOn.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// IntersectionObserver — used by lazy lists and some Radix primitives.
if (typeof globalThis !== 'undefined' && !('IntersectionObserver' in globalThis)) {
  class MockIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
    root = null;
    rootMargin = '';
    thresholds: ReadonlyArray<number> = [];
  }
  // Mock satisfies the shape needed by callers in tests (intentionally loose).
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = MockIntersectionObserver;
}

// ResizeObserver — Radix uses it for popovers and dropdowns.
if (typeof globalThis !== 'undefined' && !('ResizeObserver' in globalThis)) {
  class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = MockResizeObserver;
}

// Silence the "scrollIntoView is not a function" warning that Radix
// triggers in jsdom.
if (typeof window !== 'undefined') {
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
}
