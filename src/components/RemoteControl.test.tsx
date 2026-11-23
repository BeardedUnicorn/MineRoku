import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithTheme } from '../testUtils';
import RemoteControl from './RemoteControl';
import { RokuDevice, useAppStore } from '../store';
import { invoke } from '@tauri-apps/api/core';

const device: RokuDevice = {
  name: 'TV',
  ip: '1.1.1.1',
  port: 8060,
  url: 'http://1.1.1.1:8060',
  hardware_id: 'roku:test-tv',
  status: 'connected',
};

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
  useAppStore.setState({ remoteStyle: 'classic' });
});

afterEach(() => {
  cleanup();
});

describe('RemoteControl', () => {
  // jsdom has no layout, so check the cause: with the default content-box, the
  // shell's padding and border are added to its 100% width and it overflows phones.
  it('includes padding and border in the remote shell width', async () => {
    renderWithTheme(<RemoteControl device={device} />);

    const shell = await screen.findByTestId('remote-control-shell');
    expect(getComputedStyle(shell).boxSizing).toBe('border-box');
  });

  describe('D-pad size on phones', () => {
    const setViewportWidth = (width: number) => {
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
    };

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('uses the large D-pad when it fits', async () => {
      setViewportWidth(360);
      renderWithTheme(<RemoteControl device={device} />);

      const dpad = await screen.findByTestId('remote-dpad');
      expect(getComputedStyle(dpad).width).toBe('300px');
    });

    it('falls back to the smaller D-pad on very narrow phones', async () => {
      setViewportWidth(340);
      renderWithTheme(<RemoteControl device={device} />);

      const dpad = await screen.findByTestId('remote-dpad');
      expect(getComputedStyle(dpad).width).toBe('248px');
    });
  });

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

  it('opens media player status from an accessible button control', async () => {
    renderWithTheme(<RemoteControl device={device} />);

    const [statusButton] = await screen.findAllByRole('button', { name: /open media player status/i });
    await userEvent.click(statusButton);

    expect(await screen.findByText(/media player status/i)).toBeInTheDocument();
  });

  it('applies remote style tokens from global settings', async () => {
    renderWithTheme(<RemoteControl device={device} />);

    const shells = await screen.findAllByTestId('remote-control-shell');
    const shell = shells[shells.length - 1];
    expect(shell).toHaveAttribute('data-remote-style', 'classic');

    useAppStore.getState().setRemoteStyle('studio');

    await waitFor(() => {
      const updated = screen.getAllByTestId('remote-control-shell');
      expect(updated[updated.length - 1]).toHaveAttribute('data-remote-style', 'studio');
    });
  });

  describe('layout stability', () => {
    const playing = {
      state: 'play',
      error: false,
      position: '30000 ms',
      duration: '120000 ms',
      is_live: false,
    };

    it('reserves the progress bar space when nothing is playing', async () => {
      renderWithTheme(<RemoteControl device={device} />);

      const progress = await screen.findByTestId('remote-progress');
      // Present in the layout, just not visible: the buttons below keep their position.
      expect(progress).toBeInTheDocument();
      expect(getComputedStyle(progress).visibility).toBe('hidden');
      expect(progress).toHaveAttribute('aria-hidden', 'true');
      expect(progress.querySelector('[role="progressbar"]')).not.toBeNull();
    });

    it('shows the same progress element once media is playing', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      // Media state arrives through the poll, which only runs while the window has focus.
      const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
      try {
        vi.mocked(invoke).mockImplementation((cmd: string) => {
          if (cmd === 'get_active_app') return Promise.resolve({ name: 'Netflix', id: '12' });
          if (cmd === 'get_media_player') return Promise.resolve(playing);
          return Promise.resolve();
        });
        renderWithTheme(<RemoteControl device={device} />);

        const before = await screen.findByTestId('remote-progress');
        vi.advanceTimersByTime(2100);

        await waitFor(() => {
          expect(getComputedStyle(screen.getByTestId('remote-progress')).visibility).toBe('visible');
        });
        expect(screen.getByTestId('remote-progress')).toBe(before);
        expect(screen.getByText('0:30')).toBeInTheDocument();
        expect(screen.getByText('2:00')).toBeInTheDocument();
      } finally {
        hasFocus.mockRestore();
        vi.useRealTimers();
      }
    });

    it('shows the offline notice in the title slot instead of adding a row', async () => {
      renderWithTheme(<RemoteControl device={{ ...device, status: 'disconnected' }} />);

      const notice = await screen.findByRole('status');
      expect(notice).toHaveTextContent(/device offline/i);
      expect(screen.queryByText('Roku Remote')).not.toBeInTheDocument();
    });
  });

  it('delivers every press of a repeated button, in order', async () => {
    const sent: string[] = [];
    let release: (() => void) | undefined;
    vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
      if (cmd === 'get_active_app') return Promise.resolve({ name: 'Home', id: 'home' });
      if (cmd === 'send_roku_command') {
        sent.push((args as { command: string }).command);
        // The first request stays in flight while the others are pressed.
        if (sent.length === 1) {
          return new Promise<void>((resolve) => {
            release = resolve;
          });
        }
      }
      return Promise.resolve();
    });
    renderWithTheme(<RemoteControl device={device} />);

    const down = (await screen.findAllByLabelText('Down'))[0];
    await userEvent.click(down);
    await userEvent.click(down);
    await userEvent.click(down);
    expect(sent).toEqual(['down']);

    release?.();
    await waitFor(() => expect(sent).toEqual(['down', 'down', 'down']));
  });

  describe('keyboard shortcuts', () => {
    const sentCommands = () =>
      vi
        .mocked(invoke)
        .mock.calls.filter(([cmd]) => cmd === 'send_roku_command')
        .map(([, args]) => (args as { command: string }).command);

    it('leaves Escape to an open dialog instead of sending Back', async () => {
      renderWithTheme(<RemoteControl device={device} />);

      const [statusButton] = await screen.findAllByRole('button', { name: /open media player status/i });
      await userEvent.click(statusButton);
      await screen.findByRole('dialog');
      vi.mocked(invoke).mockClear();

      await userEvent.keyboard('{Escape}');

      expect(sentCommands()).toEqual([]);
    });

    it('ignores shortcuts combined with Ctrl or Cmd', async () => {
      renderWithTheme(<RemoteControl device={device} />);
      await screen.findByTestId('remote-control-shell');

      await userEvent.keyboard('{Control>}={/Control}{Meta>}h{/Meta}');

      expect(sentCommands()).toEqual([]);
    });

    it('sends only the focused button\'s command on Enter', async () => {
      renderWithTheme(<RemoteControl device={device} />);

      const homeBtn = await screen.findByLabelText('Home');
      homeBtn.focus();
      await userEvent.keyboard('{Enter}');

      expect(sentCommands()).toEqual(['home']);
    });
  });
});
