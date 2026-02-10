// Use the vitest-compatible version of jest-dom which expects vitest's global
// `expect`. Importing the jest-specific build causes a ReferenceError because
// the global `expect` isn't defined when the module evaluates. The vitest
// entry point patches vitest's `expect` instead.
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import React from 'react';

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-ignore
global.ResizeObserver = ResizeObserverMock;

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
  Window: {
    getCurrent: () => ({
      onFocusChanged: () => Promise.resolve(() => {}),
      isFocused: () => Promise.resolve(true),
    }),
  },
}));

vi.mock('@tauri-apps/plugin-os', () => ({
  platform: vi.fn(() => Promise.resolve('linux')),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(),
}));

// Mock out react-transition-group to avoid running animations during tests.
vi.mock('react-transition-group', () => ({
  TransitionGroup: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  CSSTransition: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

// Note: if Snackbar auto-hide timers cause teardown warnings, consider
// using fake timers locally in affected tests rather than globally here.
