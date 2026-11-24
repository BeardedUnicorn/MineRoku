import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import Sidebar from './Sidebar';
import { renderWithTheme } from '../testUtils';
import { useAppStore, RokuDevice } from '../store';
import { openUrl } from '@tauri-apps/plugin-opener';
import { invoke } from '@tauri-apps/api/core';
import { iconCache } from '../iconCache';
import { resetUpdates, useUpdates } from '../services/updates';

describe('Sidebar', () => {
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
    resetUpdates();
  });

  // Dialogs left open by one test would hide the rest of the page from the next.
  afterEach(() => {
    cleanup();
  });

  it('renders devices and handles selection and refresh', async () => {
    const scanForDevices = vi.fn();
    renderWithTheme(<Sidebar isOpen onToggle={() => {}} scanForDevices={scanForDevices} isScanning={false} />);

    // Device is rendered
    const deviceItem = screen.getByText('Living Room');
    expect(deviceItem).toBeInTheDocument();

    // Select device
    await userEvent.click(deviceItem);
    expect(useAppStore.getState().selectedDevice).toEqual(device);

    // Refresh button - MUI wraps the button in a span that duplicates the label,
    // so select the actual button element.
    const refreshBtns = screen.getAllByLabelText(/refresh device list/i);
    await userEvent.click(refreshBtns[refreshBtns.length - 1]);
    expect(scanForDevices).toHaveBeenCalled();
  });

  it('opens the about link', async () => {
    const scanForDevices = vi.fn();
    renderWithTheme(<Sidebar isOpen onToggle={() => {}} scanForDevices={scanForDevices} isScanning={false} />);

    const [aboutBtn] = screen.getAllByLabelText(/about/i);
    await userEvent.click(aboutBtn);
    expect(openUrl).toHaveBeenCalledWith('https://github.com/mherold1/roku-controller');
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

    renderWithTheme(<Sidebar isOpen onToggle={() => {}} scanForDevices={vi.fn()} isScanning={false} />);

    expect(screen.getAllByText('Connected TV').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Selected Offline').length).toBeGreaterThan(0);
    expect(screen.queryByText('Hidden Offline')).not.toBeInTheDocument();
  });

  it('updates remote style from settings', async () => {
    const scanForDevices = vi.fn();
    renderWithTheme(<Sidebar isOpen onToggle={() => {}} scanForDevices={scanForDevices} isScanning={false} />);

    const [settingsBtn] = screen.getAllByLabelText(/settings/i);
    await userEvent.click(settingsBtn);

    const styleSelect = await screen.findByRole('combobox', { name: /remote style/i });
    await userEvent.click(styleSelect);
    await userEvent.click(await screen.findByRole('option', { name: /glass/i }));

    expect(useAppStore.getState().remoteStyle).toBe('glass');
  });

  describe('forgetting a device', () => {
    const other: RokuDevice = {
      ...device,
      name: 'Bedroom',
      ip: '2.2.2.2',
      url: 'http://2.2.2.2:8060',
      hardware_id: 'roku:bedroom',
    };

    const renderSidebar = () =>
      renderWithTheme(<Sidebar isOpen onToggle={() => {}} scanForDevices={vi.fn()} isScanning={false} />);

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
      renderSidebar();

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
      renderSidebar();

      await openForgetDialog('Bedroom');
      await userEvent.click(screen.getByRole('button', { name: 'Forget' }));

      await waitFor(() => {
        expect(useAppStore.getState().devices.map((d) => d.hardware_id)).toEqual(['roku:living-room']);
      });
      expect(useAppStore.getState().selectedDevice?.hardware_id).toBe('roku:living-room');
      expect(invoke).not.toHaveBeenCalledWith('hide_media_notification');
    });

    it('does nothing when cancelled', async () => {
      renderSidebar();

      await openForgetDialog('Living Room');
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(invoke).not.toHaveBeenCalledWith('forget_device', expect.anything());
      expect(useAppStore.getState().devices).toHaveLength(2);
    });

    it('keeps the device and reports the error when the backend fails', async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) =>
        cmd === 'forget_device' ? Promise.reject('database is locked') : Promise.resolve(undefined)
      );
      renderSidebar();

      await openForgetDialog('Living Room');
      await userEvent.click(screen.getByRole('button', { name: 'Forget' }));

      expect(await screen.findByText(/could not forget this device: database is locked/i)).toBeInTheDocument();
      expect(useAppStore.getState().devices).toHaveLength(2);
      expect(useAppStore.getState().selectedDevice?.hardware_id).toBe('roku:living-room');
    });

    it('does not select the device when its forget button is pressed', async () => {
      useAppStore.setState({ selectedDevice: null });
      renderSidebar();

      await openForgetDialog('Bedroom');

      expect(useAppStore.getState().selectedDevice).toBeNull();
    });
  });

  it('keeps saved data and reports the error when Delete All Data fails', async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      cmd === 'clear_all_data' ? Promise.reject('disk full') : Promise.resolve(undefined)
    );
    renderWithTheme(<Sidebar isOpen onToggle={() => {}} scanForDevices={vi.fn()} isScanning={false} />);

    const [settingsBtn] = screen.getAllByLabelText(/settings/i);
    await userEvent.click(settingsBtn);
    await userEvent.click(await screen.findByRole('button', { name: /delete all data/i }));
    await userEvent.click(await screen.findByRole('button', { name: /delete all & restart/i }));

    expect(await screen.findByText(/could not delete saved data: disk full/i)).toBeInTheDocument();
    expect(useAppStore.getState().devices).toHaveLength(1);
    expect(invoke).not.toHaveBeenCalledWith('restart_app');
  });

  describe('updates in settings', () => {
    async function openSettings() {
      renderWithTheme(<Sidebar isOpen onToggle={() => {}} scanForDevices={vi.fn()} isScanning={false} />);
      const [settingsBtn] = screen.getAllByLabelText(/settings/i);
      await userEvent.click(settingsBtn);
      return screen.findByRole('dialog', { name: 'Settings' });
    }

    it('shows the version and checks for updates on request', async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) =>
        Promise.resolve(cmd === 'check_for_update' ? null : undefined)
      );
      const dialog = await openSettings();

      expect(await within(dialog).findByText('Version 0.1.0')).toBeInTheDocument();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Check for updates' }));

      expect(invoke).toHaveBeenCalledWith('check_for_update');
      expect(await within(dialog).findByText('Roku Remote is up to date.')).toBeInTheDocument();
    });

    it('offers an update a check found', async () => {
      const update = { version: '0.2.0', currentVersion: '0.1.0', notes: null, changelog: null, date: null };
      vi.mocked(invoke).mockImplementation((cmd: string) =>
        Promise.resolve(cmd === 'check_for_update' ? update : undefined)
      );
      const dialog = await openSettings();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Check for updates' }));

      expect(await within(dialog).findByText('Roku Remote 0.2.0 is available.')).toBeInTheDocument();
      useUpdates.getState().later();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Update…' }));
      expect(useUpdates.getState().update).toEqual({ status: 'available', update, open: true });
    });

    it('shows why a check failed', async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) =>
        cmd === 'check_for_update' ? Promise.reject('offline') : Promise.resolve(undefined)
      );
      const dialog = await openSettings();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Check for updates' }));
      expect(await within(dialog).findByText("Couldn't check for updates. Offline.")).toBeInTheDocument();
    });

    it('turns automatic checks off', async () => {
      const dialog = await openSettings();
      const toggle = within(dialog).getByRole('switch', { name: 'Check for updates automatically' });
      expect(toggle).toBeChecked();
      await userEvent.click(toggle);
      expect(useUpdates.getState().autoCheck).toBe(false);
      expect(localStorage.getItem('rokuUpdateAutoCheck')).toBe('false');
    });
  });
});
