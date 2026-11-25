import { describe, expect, it } from 'vitest';
import indexHtml from '../index.html?raw';
import tauriConf from '../src-tauri/tauri.conf.json?raw';
import androidColors from '../src-tauri/gen/android/app/src/main/res/values/colors.xml?raw';
import theme from './theme';
import { tokens } from './tokens';

const bg = tokens.bg.toLowerCase();

describe('background color', () => {
  it('is the theme background', () => {
    expect(theme.palette.background.default).toBe(tokens.bg);
  });

  // These paint before the bundle loads, so they cannot read the token.
  it('matches the first paint in index.html', () => {
    const html = indexHtml.toLowerCase();
    expect(html).toContain(`<meta name="theme-color" content="${bg}"`);
    expect(html).not.toContain('#121212');
  });

  it('matches the desktop window background', () => {
    expect(JSON.parse(tauriConf).app.windows[0].backgroundColor.toLowerCase()).toBe(bg);
  });

  it('matches the Android window and system bars', () => {
    expect(androidColors.toLowerCase()).toContain(`<color name="app_background">#ff${bg.slice(1)}</color>`);
  });
});
