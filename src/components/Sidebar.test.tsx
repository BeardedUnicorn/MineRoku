import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import Sidebar from './Sidebar';
import { renderWithTheme } from '../testUtils';
import { useAppStore, RokuDevice } from '../store';
import { invoke } from '@tauri-apps/api/core';

vi.mocked(invoke);

describe('Sidebar', () => {
  const device: RokuDevice = { name: 'Living Room', ip: '1.1.1.1', port: 8060, url: 'http://1.1.1.1:8060', status: 'connected' };

  beforeEach(() => {
    useAppStore.setState({ devices: [device], selectedDevice: null, favoriteApps: {} });
    vi.mocked(invoke).mockReset();
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

    // Refresh button
    await userEvent.click(screen.getByLabelText(/refresh device list/i));
    expect(scanForDevices).toHaveBeenCalled();
  });

  it('opens popup window', async () => {
    const scanForDevices = vi.fn();
    renderWithTheme(<Sidebar isOpen onToggle={() => {}} scanForDevices={scanForDevices} isScanning={false} />);

    await userEvent.click(screen.getByLabelText(/open remote in new window/i));
    expect(invoke).toHaveBeenCalledWith('open_popup_window');
  });
});
