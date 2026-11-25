import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
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

const bedroom: RokuDevice = {
  name: 'Bedroom',
  ip: '2.2.2.2',
  port: 8060,
  url: 'http://2.2.2.2:8060',
  hardware_id: 'roku:bedroom',
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
      case 'check_android_local_network_access':
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

  it('returns to the empty state with a scan button once the last device is gone', async () => {
    useAppStore.setState({ devices: [device], selectedDevice: device });
    mockInvoke();
    renderWithTheme(<App />);
    await screen.findByTestId('remote-control-shell');

    useAppStore.getState().removeDevice(device.hardware_id);

    expect(await screen.findByText(/no roku devices found/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^scan again$/i })).toBeInTheDocument();
  });

  it('keeps the device list on screen and selects with one click', async () => {
    useAppStore.setState({ devices: [device, bedroom], selectedDevice: device });
    mockInvoke();
    renderWithTheme(<App />);

    const rail = screen.getByRole('navigation', { name: /device navigation/i });
    await userEvent.click(within(rail).getByText('Bedroom'));

    expect(useAppStore.getState().selectedDevice?.hardware_id).toBe(bedroom.hardware_id);
    expect(await screen.findByRole('heading', { level: 1, name: /bedroom/i })).toBeInTheDocument();
  });

  it('offers the known devices, one tap each, when none is selected', async () => {
    useAppStore.setState({ devices: [device, bedroom], selectedDevice: null, preferLastUsed: true });
    mockInvoke();
    renderWithTheme(<App />);

    const main = screen.getByRole('main');
    expect(await within(main).findByRole('heading', { name: /choose a roku/i })).toBeInTheDocument();
    await userEvent.click(within(main).getByRole('button', { name: /bedroom/i }));

    expect(useAppStore.getState().selectedDevice?.hardware_id).toBe(bedroom.hardware_id);
    expect(await screen.findByTestId('remote-control-shell')).toBeInTheDocument();
  });

  it('opens Settings from the app bar in one click', async () => {
    mockInvoke();
    renderWithTheme(<App />);

    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  });

  it('reports the result of a scan started from the device list', async () => {
    useAppStore.setState({ devices: [device], selectedDevice: device });
    mockInvoke({ discover_roku_devices: () => [device, bedroom] });
    renderWithTheme(<App />);
    await screen.findByTestId('remote-control-shell');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Scan for devices' })).toBeEnabled());

    await userEvent.click(screen.getByRole('button', { name: 'Scan for devices' }));

    expect(await screen.findByText('Found 2 devices')).toBeInTheDocument();
  });
});

describe('App on a phone-sized window', () => {
  beforeEach(() => {
    setPlatform('linux');
    const width = 400;
    vi.stubGlobal('matchMedia', (query: string) => {
      const min = /min-width:\s*([\d.]+)px/.exec(query);
      const max = /max-width:\s*([\d.]+)px/.exec(query);
      return {
        matches: (!min || width >= Number(min[1])) && (!max || width <= Number(max[1])),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
      };
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the device list from the title and closes it on selection', async () => {
    useAppStore.setState({ devices: [device, bedroom], selectedDevice: device });
    mockInvoke();
    renderWithTheme(<App />);

    expect(screen.queryByRole('navigation', { name: /device navigation/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /living room\. change device/i }));

    const sheet = await screen.findByRole('dialog', { name: 'Devices' });
    await userEvent.click(within(sheet).getByText('Bedroom'));

    expect(useAppStore.getState().selectedDevice?.hardware_id).toBe(bedroom.hardware_id);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Devices' })).not.toBeInTheDocument());
  });

  it('keeps the remote mounted, and its shortcuts working, on the Apps tab', async () => {
    useAppStore.setState({ devices: [device], selectedDevice: device });
    mockInvoke();
    renderWithTheme(<App />);
    await screen.findByTestId('remote-control-shell');

    await userEvent.click(screen.getByRole('button', { name: /apps/i }));
    expect(await screen.findByLabelText(/search apps/i)).toBeInTheDocument();

    expect(screen.getByTestId('remote-control-shell')).not.toBeVisible();
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    await waitFor(() =>
      expect(vi.mocked(invoke)).toHaveBeenCalledWith('send_roku_command', {
        ip: device.ip,
        port: device.port,
        command: 'up',
      })
    );
  });
});

describe('App on Android', () => {
  beforeEach(() => setPlatform('android'));

  it('does not scan on its own', async () => {
    mockInvoke();
    renderWithTheme(<App />);

    expect(await within(screen.getByRole('main')).findByRole('button', { name: /scan for devices/i })).toBeInTheDocument();
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

  it('picks up access granted in system Settings when the app comes back', async () => {
    useAppStore.setState({ devices: [device], selectedDevice: device });
    let granted = false;
    mockInvoke({
      ensure_android_local_network_access: () => granted,
      check_android_local_network_access: () => granted,
    });
    renderWithTheme(<App />);
    expect(await screen.findByText(/local network access needed/i)).toBeInTheDocument();

    // Still denied: coming back changes nothing and does not prompt again.
    const prompts = () => calledCommands().filter((cmd) => cmd === 'ensure_android_local_network_access').length;
    const promptsBefore = prompts();
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(calledCommands()).toContain('check_android_local_network_access'));
    expect(screen.getByText(/local network access needed/i)).toBeInTheDocument();

    granted = true;
    fireEvent(document, new Event('visibilitychange'));

    expect(await screen.findByTestId('remote-control-shell')).toBeInTheDocument();
    expect(prompts()).toBe(promptsBefore);
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

    await userEvent.click(await within(screen.getByRole('main')).findByRole('button', { name: /scan for devices/i }));

    expect(
      await screen.findByText(/scan failed: android activity is not available/i)
    ).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('button', { name: /scan for devices/i })).toBeEnabled();
    expect(calledCommands()).not.toContain('discover_roku_devices');
  });

  it('explains a denied discovery permission and offers Settings', async () => {
    mockInvoke({ ensure_android_discovery_permissions: () => false });
    renderWithTheme(<App />);

    await userEvent.click(await within(screen.getByRole('main')).findByRole('button', { name: /scan for devices/i }));

    expect(await screen.findByText(/permission is required to find roku devices/i)).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('button', { name: /open settings/i })).toBeInTheDocument();
    expect(calledCommands()).not.toContain('discover_roku_devices');
  });
});
