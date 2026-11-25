import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { cleanup, screen, within } from '@testing-library/react';
import SettingsDialog from './SettingsDialog';
import { renderWithTheme } from '../testUtils';
import { useAppStore, RokuDevice } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { resetUpdates, useUpdates } from '../services/updates';

describe('SettingsDialog', () => {
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
    localStorage.clear();
    resetUpdates();
  });

  afterEach(() => {
    cleanup();
  });

  const openSettings = (onClose = vi.fn()) => {
    renderWithTheme(<SettingsDialog open onClose={onClose} />);
    return screen.findByRole('dialog', { name: 'Settings' });
  };

  it('is not shown until opened', () => {
    renderWithTheme(<SettingsDialog open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('changes the remote style with one tap', async () => {
    const dialog = await openSettings();
    const group = within(dialog).getByRole('radiogroup', { name: /remote style/i });

    expect(within(group).getByRole('radio', { name: 'Classic' })).toBeChecked();
    await userEvent.click(within(group).getByRole('radio', { name: 'Glass' }));

    expect(useAppStore.getState().remoteStyle).toBe('glass');
    expect(within(group).getByRole('radio', { name: 'Glass' })).toBeChecked();
    expect(within(group).getAllByRole('radio')).toHaveLength(4);
  });

  it('toggles the device list settings', async () => {
    const dialog = await openSettings();

    await userEvent.click(within(dialog).getByRole('switch', { name: 'Show all discovered devices' }));
    await userEvent.click(within(dialog).getByRole('switch', { name: 'Prefer last-used device on startup' }));

    expect(useAppStore.getState().showAllDevices).toBe(false);
    expect(useAppStore.getState().preferLastUsed).toBe(false);
  });

  it('closes from its close button', async () => {
    const onClose = vi.fn();
    const dialog = await openSettings(onClose);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Close settings' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('links to the project', async () => {
    const dialog = await openSettings();

    await userEvent.click(within(dialog).getByRole('button', { name: /on github/i }));
    expect(openUrl).toHaveBeenCalledWith('https://github.com/BeardedUnicorn/MineRoku');
  });

  it('keeps saved data and reports the error when Delete All Data fails', async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      cmd === 'clear_all_data' ? Promise.reject('disk full') : Promise.resolve(undefined)
    );
    const onClose = vi.fn();
    await openSettings(onClose);

    await userEvent.click(await screen.findByRole('button', { name: /delete all data/i }));
    await userEvent.click(await screen.findByRole('button', { name: /delete all & restart/i }));

    expect(await screen.findByText(/could not delete saved data: disk full/i)).toBeInTheDocument();
    expect(useAppStore.getState().devices).toHaveLength(1);
    expect(invoke).not.toHaveBeenCalledWith('restart_app');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('deletes everything, closes and restarts on desktop', async () => {
    const onClose = vi.fn();
    await openSettings(onClose);

    await userEvent.click(await screen.findByRole('button', { name: /delete all data/i }));
    await userEvent.click(await screen.findByRole('button', { name: /delete all & restart/i }));

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('restart_app'));
    expect(invoke).toHaveBeenCalledWith('clear_all_data');
    expect(useAppStore.getState().devices).toHaveLength(0);
    expect(onClose).toHaveBeenCalled();
  });

  describe('updates', () => {
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
