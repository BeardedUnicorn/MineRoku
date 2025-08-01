import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AppLauncher from './AppLauncher';
import { renderWithTheme } from '../testUtils';
import { useAppStore, RokuDevice } from '../store';
import { invoke } from '@tauri-apps/api/core';

const device: RokuDevice = { name: 'TV', ip: '1.1.1.1', port: 8060, url: 'http://1.1.1.1:8060', status: 'connected' };

vi.mocked(invoke);

beforeEach(() => {
  useAppStore.setState({ devices: [device], selectedDevice: device, favoriteApps: { [device.ip]: [] } });
  vi.mocked(invoke).mockReset();
});

describe('AppLauncher', () => {
  it('fetches and launches apps', async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === 'list_roku_apps') {
        return Promise.resolve([
          { id: '1', name: 'Netflix', version: '1.0' },
          { id: '2', name: 'YouTube', version: '1.0' },
        ]);
      }
      if (cmd === 'get_app_icon') {
        return Promise.resolve('data:image/png;base64,icon');
      }
      return Promise.resolve(undefined);
    });

    renderWithTheme(<AppLauncher device={device} />);

    await userEvent.click(screen.getByRole('button', { name: /refresh/i }));

    expect(await screen.findByText('Netflix')).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: /launch/i })[0]);
    expect(invoke).toHaveBeenCalledWith('launch_roku_app', { ip: device.ip, port: device.port, appId: '1' });

    await userEvent.click(screen.getAllByLabelText(/add to favorites|remove from favorites/i)[0]);
    expect(useAppStore.getState().favoriteApps[device.ip]).toContain('1');

    await userEvent.type(screen.getByLabelText(/search apps/i), 'Nope');
    expect(await screen.findByText(/no matching apps/i)).toBeInTheDocument();
  });
});
