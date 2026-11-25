import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AppLauncher from './AppLauncher';
import FavoritesRow from './FavoritesRow';
import { renderWithTheme } from '../testUtils';
import { useAppStore, RokuDevice } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { iconCache } from '../iconCache';
import { resetApps } from '../services/appsStore';

const device: RokuDevice = {
  name: 'TV',
  ip: '1.1.1.1',
  port: 8060,
  url: 'http://1.1.1.1:8060',
  hardware_id: 'roku:test-tv',
  status: 'connected',
};

const mockApps = (apps: { id: string; name: string }[]) => {
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === 'list_roku_apps') {
      return Promise.resolve(apps.map((app) => ({ ...app, version: '1.0' })));
    }
    if (cmd === 'get_app_icon') {
      return Promise.resolve('data:image/png;base64,icon');
    }
    return Promise.resolve(undefined);
  });
};

const calls = (cmd: string) => vi.mocked(invoke).mock.calls.filter(([name]) => name === cmd);

beforeEach(() => {
  useAppStore.setState({
    devices: [device],
    selectedDevice: device,
    favoriteApps: { [device.hardware_id]: [] },
  });
  vi.mocked(invoke).mockReset();
  resetApps();
  iconCache.clear();
});

afterEach(cleanup);

describe('AppLauncher', () => {
  it('fetches and launches apps', async () => {
    mockApps([
      { id: '1', name: 'Netflix' },
      { id: '2', name: 'YouTube' },
    ]);

    renderWithTheme(<AppLauncher device={device} />);

    expect(await screen.findByText('Netflix')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }));

    await userEvent.click(screen.getAllByRole('button', { name: /launch/i })[0]);
    expect(invoke).toHaveBeenCalledWith('launch_roku_app', {
      ip: device.ip,
      port: device.port,
      appId: '1',
    });
    expect(await screen.findByText('Launched "Netflix"')).toBeInTheDocument();

    expect(screen.queryByRole('region', { name: 'Favorites' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /add netflix to favorites/i }));
    expect(useAppStore.getState().favoriteApps[device.hardware_id]).toContain('1');

    vi.mocked(invoke).mockClear();
    const favorites = await screen.findByRole('region', { name: 'Favorites' });
    const favoriteLaunchButton = within(favorites).getByRole('button', { name: /launch netflix/i });
    favoriteLaunchButton.focus();
    await userEvent.keyboard('{Enter}');
    expect(invoke).toHaveBeenCalledWith('launch_roku_app', {
      ip: device.ip,
      port: device.port,
      appId: '1',
    });

    await userEvent.type(screen.getByLabelText(/search apps/i), 'Nope');
    expect(await screen.findByText(/no matching apps/i)).toBeInTheDocument();
  });

  it('shows every app in one grid, without pages', async () => {
    mockApps(Array.from({ length: 80 }, (_, i) => ({ id: String(i), name: `App ${String(i).padStart(2, '0')}` })));

    renderWithTheme(<AppLauncher device={device} />);

    expect(await screen.findByRole('heading', { name: 'All apps (80)' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^launch app/i })).toHaveLength(80);
    expect(screen.queryByRole('navigation', { name: /pagination/i })).not.toBeInTheDocument();
  });

  it('filters as you type and counts the matches', async () => {
    mockApps([
      { id: '1', name: 'Netflix' },
      { id: '2', name: 'YouTube' },
    ]);
    renderWithTheme(<AppLauncher device={device} />);
    await screen.findByText('Netflix');

    await userEvent.type(screen.getByLabelText(/search apps/i), 'you');

    expect(await screen.findByRole('heading', { name: 'All apps (1)' })).toBeInTheDocument();
    expect(screen.queryByText('Netflix')).not.toBeInTheDocument();
  });

  it('reports a failed fetch', async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      cmd === 'list_roku_apps' ? Promise.reject('connection refused') : Promise.resolve([])
    );
    renderWithTheme(<AppLauncher device={device} />);

    expect(await screen.findByText('Error fetching apps: connection refused')).toBeInTheDocument();
  });

  it('says the device is offline instead of fetching', async () => {
    mockApps([]);
    renderWithTheme(<AppLauncher device={{ ...device, status: 'disconnected' }} />);

    expect(await screen.findByText('Device offline')).toBeInTheDocument();
    expect(calls('list_roku_apps')).toHaveLength(0);
  });
});

describe('FavoritesRow', () => {
  it('renders nothing without favorites', async () => {
    mockApps([{ id: '1', name: 'Netflix' }]);
    renderWithTheme(<FavoritesRow device={device} />);

    await waitFor(() => expect(calls('list_roku_apps')).toHaveLength(1));
    expect(screen.queryByRole('region', { name: 'Favorites' })).not.toBeInTheDocument();
  });

  it('launches a favorite with one tap, without the apps grid', async () => {
    useAppStore.setState({ favoriteApps: { [device.hardware_id]: ['2', 'gone'] } });
    mockApps([
      { id: '1', name: 'Netflix' },
      { id: '2', name: 'YouTube' },
    ]);
    renderWithTheme(<FavoritesRow device={device} />);

    const favorites = await screen.findByRole('region', { name: 'Favorites' });
    // Only favorites the device still has.
    expect(within(favorites).getAllByRole('button')).toHaveLength(1);
    await userEvent.click(within(favorites).getByRole('button', { name: 'Launch YouTube' }));

    expect(invoke).toHaveBeenCalledWith('launch_roku_app', { ip: device.ip, port: device.port, appId: '2' });
  });

  it('shares one fetch with the apps grid', async () => {
    useAppStore.setState({ favoriteApps: { [device.hardware_id]: ['1'] } });
    mockApps([{ id: '1', name: 'Netflix' }]);
    renderWithTheme(
      <>
        <FavoritesRow device={device} />
        <AppLauncher device={device} />
      </>
    );

    await screen.findByRole('heading', { name: 'All apps (1)' });
    expect(calls('list_roku_apps')).toHaveLength(1);
  });
});
