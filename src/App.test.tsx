import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { platform } from '@tauri-apps/plugin-os';
import App from './App';
import { renderWithTheme } from './testUtils';
import { useAppStore, type RokuDevice } from './store';
import { resetPlatformForTests } from './hooks/usePlatform';

const device: RokuDevice = {
  name: 'Living Room',
  ip: '1.1.1.1',
  port: 8060,
  url: 'http://1.1.1.1:8060',
  hardware_id: 'roku:living-room',
  status: 'connected',
};

type Handlers = Record<string, () => unknown>;

const mockInvoke = (handlers: Handlers = {}) => {
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd in handlers) {
      return Promise.resolve().then(handlers[cmd]) as Promise<never>;
    }
    switch (cmd) {
      case 'get_cached_devices':
      case 'discover_roku_devices':
      case 'list_roku_apps':
      case 'get_cached_apps':
        return Promise.resolve([]) as Promise<never>;
      case 'get_active_app':
        return Promise.resolve({ name: 'Home', id: 'roku' }) as Promise<never>;
      case 'check_device_connectivity':
      case 'ensure_android_discovery_permissions':
      case 'ensure_android_local_network_access':
      case 'ensure_android_notification_permission':
        return Promise.resolve(true) as Promise<never>;
      default:
        return Promise.resolve(undefined) as Promise<never>;
    }
  });
};

const calledCommands = () => vi.mocked(invoke).mock.calls.map(([cmd]) => cmd);

const setPlatform = (value: string) => {
  // The real plugin answers synchronously.
  vi.mocked(platform).mockReturnValue(value as ReturnType<typeof platform>);
  resetPlatformForTests();
};

beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  useAppStore.setState({
    devices: [],
    selectedDevice: null,
    favoriteApps: {},
    preferLastUsed: true,
    showAllDevices: true,
    remoteStyle: 'classic',
  });
});

afterEach(() => {
  cleanup();
  vi.mocked(platform).mockImplementation(() => Promise.resolve('linux') as never);
  resetPlatformForTests();
});

describe('App on desktop', () => {
  beforeEach(() => setPlatform('linux'));

  it('scans for devices on launch', async () => {
    mockInvoke();
    renderWithTheme(<App />);

    await waitFor(() => expect(calledCommands()).toContain('discover_roku_devices'));
    expect(calledCommands()).not.toContain('ensure_android_local_network_access');
  });

  it('returns to the empty state with a Refresh button once the last device is gone', async () => {
    useAppStore.setState({ devices: [device], selectedDevice: device });
    mockInvoke();
    renderWithTheme(<App />);
    await screen.findByTestId('remote-control-shell');

    useAppStore.getState().removeDevice(device.hardware_id);

    expect(await screen.findByText(/no roku devices found/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^refresh$/i })).toBeInTheDocument();
  });
});

describe('App on Android', () => {
  beforeEach(() => setPlatform('android'));

  it('does not scan on its own', async () => {
    mockInvoke();
    renderWithTheme(<App />);

    expect(await screen.findByRole('button', { name: /scan for devices/i })).toBeInTheDocument();
    expect(screen.queryByText(/no roku devices found/i)).not.toBeInTheDocument();
    expect(calledCommands()).not.toContain('discover_roku_devices');
  });

  it('asks for local network access before talking to a saved device', async () => {
    useAppStore.setState({ devices: [device], selectedDevice: device });
    let granted = false;
    mockInvoke({ ensure_android_local_network_access: () => granted });
    renderWithTheme(<App />);

    expect(await screen.findByText(/local network access needed/i)).toBeInTheDocument();
    // Nothing was sent to the device while access was missing.
    expect(calledCommands()).not.toContain('check_device_connectivity');
    expect(calledCommands()).not.toContain('get_active_app');
    expect(screen.queryByTestId('remote-control-shell')).not.toBeInTheDocument();

    granted = true;
    await userEvent.click(screen.getByRole('button', { name: /allow access/i }));

    expect(await screen.findByTestId('remote-control-shell')).toBeInTheDocument();
    await waitFor(() => expect(calledCommands()).toContain('check_device_connectivity'));
  });

  it('shows the remote straight away when access is already granted', async () => {
    useAppStore.setState({ devices: [device], selectedDevice: device });
    mockInvoke();
    renderWithTheme(<App />);

    expect(await screen.findByTestId('remote-control-shell')).toBeInTheDocument();
    expect(screen.queryByText(/local network access needed/i)).not.toBeInTheDocument();
  });

  it('reports a failed permission check instead of leaving the scan hanging', async () => {
    mockInvoke({
      ensure_android_discovery_permissions: () => {
        throw 'Android activity is not available';
      },
    });
    renderWithTheme(<App />);

    await userEvent.click(await screen.findByRole('button', { name: /scan for devices/i }));

    expect(
      await screen.findByText(/scan failed: android activity is not available/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /scan for devices/i })).toBeEnabled();
    expect(calledCommands()).not.toContain('discover_roku_devices');
  });

  it('explains a denied discovery permission and offers Settings', async () => {
    mockInvoke({ ensure_android_discovery_permissions: () => false });
    renderWithTheme(<App />);

    await userEvent.click(await screen.findByRole('button', { name: /scan for devices/i }));

    expect(await screen.findByText(/permission is required to find roku devices/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open settings/i })).toBeInTheDocument();
    expect(calledCommands()).not.toContain('discover_roku_devices');
  });
});
