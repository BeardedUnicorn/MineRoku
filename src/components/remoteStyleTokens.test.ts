import { describe, it, expect } from 'vitest';
import { createTheme } from '@mui/material/styles';
import { getDpadMetrics, getRemoteStyleTokens, remoteStyleLabels } from './remoteStyleTokens';
import type { RemoteStylePreset } from '../store';

describe('remoteStyleTokens', () => {
  it('uses larger D-pad metrics on phones', () => {
    const phone = getDpadMetrics(true);
    const desktop = getDpadMetrics(false);

    expect(phone.arrowSize).toBe(82);
    expect(phone.centerSize).toBe(96);
    expect(phone.gap).toBe(10);
    expect(phone.arrowSize).toBeGreaterThan(desktop.arrowSize);
    expect(phone.centerSize).toBeGreaterThan(desktop.centerSize);
  });

  it('provides labels for all style presets', () => {
    expect(Object.keys(remoteStyleLabels).sort()).toEqual(
      ['classic', 'glass', 'highContrast', 'studio']
    );
  });

  it('falls back to classic tokens for unknown values', () => {
    const theme = createTheme();
    const classic = getRemoteStyleTokens('classic', theme);
    const unknown = getRemoteStyleTokens('mystery' as unknown as RemoteStylePreset, theme);

    expect(unknown.cardBackground).toBe(classic.cardBackground);
    expect(unknown.centerButtonBackground).toBe(classic.centerButtonBackground);
  });

  it('keeps the OK and power buttons the same whatever the app theme is', () => {
    const light = createTheme({ palette: { mode: 'light', primary: { main: '#00ff00' }, error: { main: '#0000ff' } } });

    expect(getRemoteStyleTokens('classic', light).centerButtonBackground).toBe(
      'linear-gradient(145deg, #8e65cf, #673ab7)'
    );
    (['classic', 'studio', 'glass', 'highContrast'] as const).forEach((style) => {
      const tokens = getRemoteStyleTokens(style, light);
      expect(tokens.powerButtonBackground).toBe('#d32f2f');
      expect(tokens.powerButtonHoverBackground).toBe('#f44336');
      expect(tokens.powerButtonColor).toBe('#ffffff');
    });
  });
});
