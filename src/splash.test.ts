import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import indexHtml from '../index.html?raw';
import { getRemoteStyleTokens } from './components/remoteStyleTokens';
import { dismissSplash } from './splash';
import { remoteStylePresets } from './store';
import theme from './theme';
import { tokens } from './tokens';

describe('dismissSplash', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="app-splash"></div>';
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  const splash = () => document.getElementById('app-splash');

  it('stays visible for the minimum time, then fades and is removed', () => {
    dismissSplash();
    expect(splash()?.dataset.state).toBe('waiting');

    vi.advanceTimersByTime(400);
    expect(splash()?.dataset.state).toBe('leaving');

    vi.runAllTimers();
    expect(splash()).toBeNull();
  });

  it('is removed as soon as the fade ends', () => {
    dismissSplash();
    vi.advanceTimersByTime(400);

    splash()?.dispatchEvent(new Event('transitionend'));
    expect(splash()).toBeNull();
  });

  it('ignores a second call, as StrictMode makes on mount', () => {
    dismissSplash();
    dismissSplash();
    expect(vi.getTimerCount()).toBe(1);

    vi.runAllTimers();
    expect(splash()).toBeNull();
  });

  it('does nothing once the splash is gone', () => {
    document.body.innerHTML = '';

    expect(() => dismissSplash()).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('index.html', () => {
  const head = new DOMParser().parseFromString(indexHtml, 'text/html').head;
  const inlineCss = head.querySelector('style')?.textContent ?? '';

  it('styles the first paint without waiting for the JS bundle', () => {
    expect(head.querySelector('meta[name="color-scheme"]')?.getAttribute('content')).toBe('dark');
    expect(inlineCss).toMatch(new RegExp(`html\\s*{[^}]*background:\\s*${tokens.bg}`, 'i'));
    expect(inlineCss).toMatch(/\.skip-link\s*{[^}]*top:\s*-48px/);
  });

  it.each(remoteStylePresets)('uses the %s remote accent colors', (preset) => {
    const accents = getRemoteStyleTokens(preset, theme).centerButtonBackground.match(/#[0-9a-f]{6}/gi);
    const rule = new RegExp(`\\[data-remote-style='${preset}'\\]\\s*{([^}]*)}`).exec(inlineCss)?.[1];

    expect(accents).toHaveLength(2);
    accents?.forEach((color) => expect(rule?.toLowerCase()).toContain(color.toLowerCase()));
  });
});
