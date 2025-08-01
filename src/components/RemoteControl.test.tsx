import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithTheme } from '../testUtils';
import RemoteControl from './RemoteControl';
import { RokuDevice } from '../store';
import { invoke } from '@tauri-apps/api/core';

const device: RokuDevice = { name: 'TV', ip: '1.1.1.1', port: 8060, url: 'http://1.1.1.1:8060', status: 'connected' };

vi.mocked(invoke);

beforeEach(() => {
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === 'get_active_app') {
      return Promise.resolve({ name: 'Home', id: 'home' });
    }
    if (cmd === 'send_roku_command') {
      return Promise.resolve();
    }
    if (cmd === 'get_app_icon') {
      return Promise.resolve('data:image/png;base64,icon');
    }
    return Promise.resolve();
  });
});

describe('RemoteControl', () => {
  it('sends commands via buttons and keyboard', async () => {
    renderWithTheme(<RemoteControl device={device} />);

    const homeBtn = await screen.findByLabelText('Home');
    await userEvent.click(homeBtn);
    expect(invoke).toHaveBeenCalledWith('send_roku_command', { ip: device.ip, port: device.port, command: 'home' });

    await userEvent.keyboard('{ArrowUp}');
    expect(invoke).toHaveBeenCalledWith('send_roku_command', { ip: device.ip, port: device.port, command: 'up' });
  });

  it('shows error feedback when command fails', async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === 'send_roku_command') {
        return Promise.reject('fail');
      }
      if (cmd === 'get_active_app') {
        return Promise.resolve({ name: 'Home', id: 'home' });
      }
      return Promise.resolve();
    });

    renderWithTheme(<RemoteControl device={device} />);

    // Multiple play/pause buttons are rendered (cloned elements used by MUI),
    // so select the first match rather than relying on a singular query.
    const [playBtn] = await screen.findAllByLabelText('Play / Pause');
    await userEvent.click(playBtn);
    expect(await screen.findByText(/error/i)).toBeInTheDocument();
  });
});
