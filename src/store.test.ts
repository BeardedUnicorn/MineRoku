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

describe('store removeDevice', () => {
  const device = (id: string) => ({
    name: `TV ${id}`,
    ip: `10.0.0.${id}`,
    port: 8060,
    url: `http://10.0.0.${id}:8060`,
    hardware_id: `roku:${id}`,
    status: 'connected' as const,
  });

  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({
      devices: [device('1'), device('2')],
      selectedDevice: device('1'),
      favoriteApps: { 'roku:1': ['12'], 'roku:2': ['13'] },
    });
  });

  it('removes the device, its favorites, and clears the selection when it was selected', () => {
    useAppStore.getState().removeDevice('roku:1');

    const state = useAppStore.getState();
    expect(state.devices.map((d) => d.hardware_id)).toEqual(['roku:2']);
    expect(state.selectedDevice).toBeNull();
    expect(state.favoriteApps).toEqual({ 'roku:2': ['13'] });
  });

  it('keeps the selection when another device is removed', () => {
    useAppStore.getState().removeDevice('roku:2');

    const state = useAppStore.getState();
    expect(state.devices.map((d) => d.hardware_id)).toEqual(['roku:1']);
    expect(state.selectedDevice?.hardware_id).toBe('roku:1');
    expect(state.favoriteApps).toEqual({ 'roku:1': ['12'] });
  });

  it('does not come back from persisted storage', () => {
    useAppStore.getState().removeDevice('roku:1');

    const stored = JSON.parse(localStorage.getItem('roku-remote-storage') as string);
    expect(stored.state.devices.map((d: { hardware_id: string }) => d.hardware_id)).toEqual(['roku:2']);
    expect(stored.state.selectedDevice).toBeNull();
  });
});
