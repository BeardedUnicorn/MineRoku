import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { platform } from '@tauri-apps/plugin-os';
import UpdatePrompt, { DUE_CHECK_INTERVAL_MS, FIRST_CHECK_DELAY_MS } from './UpdatePrompt';
import { renderWithTheme } from '../testUtils';
import { resetUpdates, useUpdates, type AvailableUpdate } from '../services/updates';
import { resetPlatformForTests } from '../hooks/usePlatform';

const update: AvailableUpdate = {
  version: '0.3.0',
  currentVersion: '0.1.0',
  notes: '### Added\n- Updates from GitHub',
  changelog: '## 0.3.0\n\n### Added\n- Updates from GitHub\n\n## 0.2.0\n\n### Fixed\n- A crash\n\n## 0.1.0\n\n- First',
  date: null,
};

// Tests swap actions for spies; each starts from the real ones
const original = useUpdates.getState();

function found(next = update) {
  useUpdates.setState({ update: { status: 'available', update: next, open: true } });
}

function onPlatform(name: string) {
  vi.mocked(platform).mockReturnValue(name as ReturnType<typeof platform>);
  resetPlatformForTests();
}

beforeEach(() => {
  localStorage.clear();
  useUpdates.setState(original, true);
  resetUpdates();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined);
  onPlatform('macos');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete window.RokuApp;
  vi.mocked(platform).mockImplementation(() => Promise.resolve('linux') as never);
  resetPlatformForTests();
});

describe('UpdatePrompt', () => {
  it('shows nothing until a check finds an update', () => {
    renderWithTheme(<UpdatePrompt automaticChecks={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the new version and every release since this one', () => {
    found();
    renderWithTheme(<UpdatePrompt automaticChecks={false} />);
    const dialog = screen.getByRole('dialog', { name: 'Roku Remote 0.3.0 is available' });
    expect(within(dialog).getByText(/You have 0\.1\.0, 2 releases behind\./)).toBeInTheDocument();
    const notes = within(dialog).getByRole('region', { name: 'Release notes' });
    expect(within(notes).getByText('Updates from GitHub')).toBeInTheDocument();
    expect(within(notes).getByText('A crash')).toBeInTheDocument();
    expect(within(notes).queryByText('First')).not.toBeInTheDocument();
  });

  it('installs on a desktop', async () => {
    found();
    const install = vi.fn(() => Promise.resolve());
    useUpdates.setState({ install });
    renderWithTheme(<UpdatePrompt automaticChecks={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Install and restart' }));
    expect(install).toHaveBeenCalled();
  });

  it('closes on Later', async () => {
    found();
    renderWithTheme(<UpdatePrompt automaticChecks={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(useUpdates.getState().update).toEqual({ status: 'available', update, open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the download’s progress and can’t be closed meanwhile', () => {
    useUpdates.setState({
      update: { status: 'installing', update, progress: { downloaded: 2_500_000, total: 10_000_000, installing: false } },
    });
    renderWithTheme(<UpdatePrompt automaticChecks={false} />);
    expect(screen.getByRole('progressbar', { name: 'Downloading the update' })).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByText('Downloading… 2.5 MB of 10.0 MB')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Later' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Install and restart' })).toBeDisabled();
  });

  it('says when it is installing', () => {
    useUpdates.setState({
      update: { status: 'installing', update, progress: { downloaded: 10, total: 10, installing: true } },
    });
    renderWithTheme(<UpdatePrompt automaticChecks={false} />);
    expect(screen.getByText('Installing… Roku Remote restarts when it\'s done.')).toBeInTheDocument();
  });

  it('shows a failed install with a retry', () => {
    useUpdates.setState({ update: { status: 'installFailed', update, error: 'Signature mismatch.' } });
    renderWithTheme(<UpdatePrompt automaticChecks={false} />);
    expect(screen.getByRole('alert')).toHaveTextContent("The update couldn't be installed. Signature mismatch.");
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Download in browser' })).not.toBeInTheDocument();
  });

  describe('on Android', () => {
    beforeEach(() => onPlatform('android'));

    it('downloads instead of installing', async () => {
      found();
      const download = vi.fn(() => Promise.resolve());
      useUpdates.setState({ download });
      renderWithTheme(<UpdatePrompt automaticChecks={false} />);
      expect(await screen.findByText(/Android asks before installing it/)).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Download' }));
      expect(download).toHaveBeenCalled();
    });

    it('offers the browser after a failed download', async () => {
      useUpdates.setState({ update: { status: 'installFailed', update, error: 'GitHub answered 404.' } });
      const openInBrowser = vi.fn(() => Promise.resolve());
      useUpdates.setState({ openInBrowser });
      renderWithTheme(<UpdatePrompt automaticChecks={false} />);
      await userEvent.click(await screen.findByRole('button', { name: 'Download in browser' }));
      expect(openInBrowser).toHaveBeenCalled();
    });

    it('says how to install with Advanced Protection on', async () => {
      const openSecuritySettings = vi.fn();
      window.RokuApp = { downloadUpdate: vi.fn(), installsBlocked: () => true, openSecuritySettings };
      found();
      renderWithTheme(<UpdatePrompt automaticChecks={false} />);
      expect(await screen.findByText(/Advanced Protection is on/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled();
      await userEvent.click(screen.getByRole('button', { name: 'Open settings' }));
      expect(openSecuritySettings).toHaveBeenCalled();
    });
  });

  describe('automatic checks', () => {
    it('check after launch, then when a day has passed', async () => {
      vi.useFakeTimers();
      const check = vi.fn(() => Promise.resolve());
      useUpdates.setState({ check });
      renderWithTheme(<UpdatePrompt automaticChecks />);
      expect(check).not.toHaveBeenCalled();

      act(() => vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS));
      expect(check).toHaveBeenCalledWith({ manual: false });

      // The launch check happened just now, so the hourly look finds nothing due
      localStorage.setItem('rokuUpdateLastCheckedAt', String(Date.now()));
      check.mockClear();
      act(() => vi.advanceTimersByTime(DUE_CHECK_INTERVAL_MS));
      expect(check).not.toHaveBeenCalled();

      act(() => vi.advanceTimersByTime(24 * DUE_CHECK_INTERVAL_MS));
      expect(check).toHaveBeenCalledWith({ manual: false });
    });

    it('do nothing while they are off', () => {
      vi.useFakeTimers();
      const check = vi.fn(() => Promise.resolve());
      useUpdates.setState({ check, autoCheck: false });
      renderWithTheme(<UpdatePrompt automaticChecks />);
      act(() => vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS + 2 * DUE_CHECK_INTERVAL_MS));
      expect(check).not.toHaveBeenCalled();
    });
  });
});
