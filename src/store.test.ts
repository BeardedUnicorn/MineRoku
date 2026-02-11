import { beforeEach, describe, expect, it } from 'vitest';
import { coerceRemoteStylePreset, DEFAULT_REMOTE_STYLE, useAppStore } from './store';

describe('store remote style preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({
      devices: [],
      selectedDevice: null,
      favoriteApps: {},
      preferLastUsed: true,
      showAllDevices: true,
      remoteStyle: DEFAULT_REMOTE_STYLE,
    });
  });

  it('updates remote style and persists it', () => {
    useAppStore.getState().setRemoteStyle('glass');

    expect(useAppStore.getState().remoteStyle).toBe('glass');

    const stored = localStorage.getItem('roku-remote-storage');
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored as string);
    expect(parsed.state.remoteStyle).toBe('glass');
  });

  it('coerces unknown values to the default remote style', () => {
    expect(coerceRemoteStylePreset('classic')).toBe('classic');
    expect(coerceRemoteStylePreset('not-a-style')).toBe(DEFAULT_REMOTE_STYLE);
    expect(coerceRemoteStylePreset(null)).toBe(DEFAULT_REMOTE_STYLE);
  });
});
