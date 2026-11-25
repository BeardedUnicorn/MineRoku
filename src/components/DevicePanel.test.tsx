import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { cleanup, screen, waitFor } from '@testing-library/react';
import DevicePanel from './DevicePanel';
import { renderWithTheme } from '../testUtils';
import { useAppStore, RokuDevice } from '../store';
import { openUrl } from '@tauri-apps/plugin-opener';
import { invoke } from '@tauri-apps/api/core';
import { iconCache } from '../iconCache';

describe('DevicePanel', () => {
  const device: RokuDevice = {
    name: 'Living Room',
    ip: '1.1.1.1',
    port: 8060,
    url: 'http://1.1.1.1:8060',
    hardware_id: 'roku:living-room',
    status: 'connected',
  };

  beforeEach(() => {
    useAppStore.setState({
      devices: [device],
      selectedDevice: null,
      favoriteApps: {},
      preferLastUsed: true,
      showAllDevices: true,
      remoteStyle: 'classic',
    });
    vi.mocked(openUrl).mockReset();
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
    iconCache.clear();
    localStorage.clear();
  });

  // Dialogs left open by one test would hide the rest of the page from the next.
  afterEach(() => {
    cleanup();
  });

  it('renders devices and handles selection and scanning', async () => {
    const scanForDevices = vi.fn();
    const onSelected = vi.fn();
    renderWithTheme(<DevicePanel onScan={scanForDevices} isScanning={false} onSelected={onSelected} />);

    // Device is rendered
    const deviceItem = screen.getByText('Living Room');
    expect(deviceItem).toBeInTheDocument();

    // Select device
    await userEvent.click(deviceItem);
    expect(useAppStore.getState().selectedDevice).toEqual(device);
    // A sheet showing the panel closes on this.
    expect(onSelected).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Scan for devices' }));
    expect(scanForDevices).toHaveBeenCalledTimes(1);
  });

  it('shows a scan in progress and blocks a second one', () => {
    renderWithTheme(<DevicePanel onScan={vi.fn()} isScanning />);

    expect(screen.getByRole('button', { name: 'Scan for devices' })).toBeDisabled();
    expect(screen.getByRole('progressbar', { name: /scanning for devices/i })).toBeVisible();
  });

  it('opens the about link', async () => {
    renderWithTheme(<DevicePanel onScan={vi.fn()} isScanning={false} />);

    const [aboutBtn] = screen.getAllByLabelText(/about/i);
    await userEvent.click(aboutBtn);
    expect(openUrl).toHaveBeenCalledWith('https://github.com/BeardedUnicorn/MineRoku');
  });

  it('hides non-selected offline devices when show all discovered devices is disabled', () => {
    const connected: RokuDevice = { ...device, hardware_id: 'roku:online', name: 'Connected TV', status: 'connected' };
    const selectedOffline: RokuDevice = {
      ...device,
      hardware_id: 'roku:selected-offline',
      name: 'Selected Offline',
      status: 'disconnected',
    };
    const hiddenOffline: RokuDevice = {
      ...device,
      hardware_id: 'roku:hidden-offline',
      name: 'Hidden Offline',
      status: 'disconnected',
    };

    useAppStore.setState({
      devices: [connected, selectedOffline, hiddenOffline],
      selectedDevice: selectedOffline,
      showAllDevices: false,
      favoriteApps: {},
      preferLastUsed: true,
      remoteStyle: 'classic',
    });

    renderWithTheme(<DevicePanel onScan={vi.fn()} isScanning={false} />);

    expect(screen.getAllByText('Connected TV').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Selected Offline').length).toBeGreaterThan(0);
    expect(screen.queryByText('Hidden Offline')).not.toBeInTheDocument();
  });

  describe('forgetting a device', () => {
    const other: RokuDevice = {
      ...device,
      name: 'Bedroom',
      ip: '2.2.2.2',
      url: 'http://2.2.2.2:8060',
      hardware_id: 'roku:bedroom',
    };

    const renderPanel = () =>
      renderWithTheme(<DevicePanel onScan={vi.fn()} isScanning={false} />);

    const openForgetDialog = async (name: string) => {
      const buttons = screen.getAllByRole('button', { name: `Forget ${name}` });
      await userEvent.click(buttons[buttons.length - 1]);
      return screen.findByRole('dialog', { name: new RegExp(`forget ${name}`, 'i') });
    };

    beforeEach(() => {
      useAppStore.setState({
        devices: [device, other],
        selectedDevice: device,
        favoriteApps: { [device.hardware_id]: ['12'], [other.hardware_id]: ['13'] },
      });
    });

    it('removes the device from the backend and the list after confirming', async () => {
      iconCache.set('1.1.1.1:8060:12', { data: 'a', timestamp: 1 });
      iconCache.set('2.2.2.2:8060:13', { data: 'b', timestamp: 1 });
      renderPanel();

      await openForgetDialog('Living Room');
      await userEvent.click(screen.getByRole('button', { name: 'Forget' }));

      await waitFor(() => {
        expect(useAppStore.getState().devices.map((d) => d.hardware_id)).toEqual(['roku:bedroom']);
      });
      expect(invoke).toHaveBeenCalledWith('forget_device', { hardwareId: 'roku:living-room' });
      // It was the selected device: the selection and its notification go with it.
      expect(useAppStore.getState().selectedDevice).toBeNull();
      expect(invoke).toHaveBeenCalledWith('hide_media_notification');
      expect(useAppStore.getState().favoriteApps).toEqual({ 'roku:bedroom': ['13'] });
      expect(Array.from(iconCache.keys())).toEqual(['2.2.2.2:8060:13']);
      expect(screen.queryByText('Living Room')).not.toBeInTheDocument();
    });

    it('leaves the selection alone when another device is forgotten', async () => {
      renderPanel();

      await openForgetDialog('Bedroom');
      await userEvent.click(screen.getByRole('button', { name: 'Forget' }));

      await waitFor(() => {
        expect(useAppStore.getState().devices.map((d) => d.hardware_id)).toEqual(['roku:living-room']);
      });
      expect(useAppStore.getState().selectedDevice?.hardware_id).toBe('roku:living-room');
      expect(invoke).not.toHaveBeenCalledWith('hide_media_notification');
    });

    it('does nothing when cancelled', async () => {
      renderPanel();

      await openForgetDialog('Living Room');
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(invoke).not.toHaveBeenCalledWith('forget_device', expect.anything());
      expect(useAppStore.getState().devices).toHaveLength(2);
    });

    it('keeps the device and reports the error when the backend fails', async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) =>
        cmd === 'forget_device' ? Promise.reject('database is locked') : Promise.resolve(undefined)
      );
      renderPanel();

      await openForgetDialog('Living Room');
      await userEvent.click(screen.getByRole('button', { name: 'Forget' }));

      expect(await screen.findByText(/could not forget this device: database is locked/i)).toBeInTheDocument();
      expect(useAppStore.getState().devices).toHaveLength(2);
      expect(useAppStore.getState().selectedDevice?.hardware_id).toBe('roku:living-room');
    });

    it('does not select the device when its forget button is pressed', async () => {
      useAppStore.setState({ selectedDevice: null });
      renderPanel();

      await openForgetDialog('Bedroom');

      expect(useAppStore.getState().selectedDevice).toBeNull();
    });
  });
});
