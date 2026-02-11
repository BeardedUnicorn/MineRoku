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
});
