import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  CHECK_INTERVAL_MS,
  automaticCheckDue,
  isNewer,
  lastCheckedAt,
  releasesSince,
  resetUpdates,
  sentence,
  useUpdates,
  type AvailableUpdate,
} from './updates';
import type { RokuAppBridge, UpdateReport } from './androidUpdate';

const update: AvailableUpdate = {
  version: '0.3.0',
  currentVersion: '0.1.0',
  notes: '### Added\n- Updates',
  changelog: '## 0.3.0\n\n### Added\n- Updates\n\n## 0.2.0\n\n- A fix\n\n## 0.1.0\n\n- First',
  date: '2026-11-24T10:00:00Z',
};

/** invoke answers each command with `replies[command]`: a value, or an Error to reject with. */
function backend(replies: Record<string, unknown>) {
  vi.mocked(invoke).mockImplementation((command: string) => {
    const reply = replies[command];
    return reply instanceof Error ? Promise.reject(reply.message) : Promise.resolve(reply);
  });
}

const state = () => useUpdates.getState().update;

beforeEach(() => {
  localStorage.clear();
  resetUpdates();
  vi.mocked(invoke).mockReset();
  vi.mocked(listen).mockReset();
  vi.mocked(listen).mockResolvedValue(() => {});
});

afterEach(() => {
  delete window.RokuApp;
  delete window.__rokuUpdate;
});

describe('helpers', () => {
  it('makes the backend’s refusals into sentences', () => {
    expect(sentence('the release feed couldn\'t be read')).toBe("The release feed couldn't be read.");
    expect(sentence('Check for updates first.')).toBe('Check for updates first.');
  });

  it('compares versions by their numbers', () => {
    expect(isNewer('0.10.0', '0.9.0')).toBe(true);
    expect(isNewer('1.0.0', '0.12.3')).toBe(true);
    expect(isNewer('0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('0.0.9', '0.1.0')).toBe(false);
    expect(isNewer('dev', '0.1.0')).toBe(false);
  });

  it('lists the releases since the running version, newest first', () => {
    expect(releasesSince(update)).toEqual([
      { version: '0.3.0', notes: '### Added\n- Updates' },
      { version: '0.2.0', notes: '- A fix' },
    ]);
  });

  it('falls back to the new version’s notes without a changelog', () => {
    expect(releasesSince({ ...update, changelog: null })).toEqual([
      { version: '0.3.0', notes: '### Added\n- Updates' },
    ]);
    expect(releasesSince({ ...update, changelog: null, notes: null })).toEqual([]);
  });
});

describe('checking', () => {
  it('opens the dialog for a newer release and remembers when it checked', async () => {
    backend({ check_for_update: update });
    const before = Date.now();
    await useUpdates.getState().check({ manual: false });
    expect(state()).toEqual({ status: 'available', update, open: true });
    expect(lastCheckedAt()).toBeGreaterThanOrEqual(before);
  });

  it('says when this is the newest', async () => {
    backend({ check_for_update: null });
    await useUpdates.getState().check({ manual: true });
    expect(state()).toEqual({ status: 'upToDate' });
  });

  it('shows a failed check the user asked for', async () => {
    backend({ check_for_update: new Error('the release feed couldn\'t be fetched (timeout)') });
    await useUpdates.getState().check({ manual: true });
    expect(state()).toEqual({ status: 'checkFailed', error: "The release feed couldn't be fetched (timeout)." });
    expect(lastCheckedAt()).toBeNull();
  });

  it('only logs a failed automatic check', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    backend({ check_for_update: new Error('offline') });
    await useUpdates.getState().check({ manual: false });
    expect(state()).toEqual({ status: 'idle' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('is due daily while automatic checks are on', () => {
    const now = Date.now();
    expect(automaticCheckDue(now)).toBe(true);
    localStorage.setItem('rokuUpdateLastCheckedAt', String(now - CHECK_INTERVAL_MS + 1000));
    expect(automaticCheckDue(now)).toBe(false);
    expect(automaticCheckDue(now + 1000)).toBe(true);
    useUpdates.getState().setAutoCheck(false);
    expect(automaticCheckDue(now + 1000)).toBe(false);
  });

  it('remembers whether checks are automatic', () => {
    useUpdates.getState().setAutoCheck(false);
    expect(localStorage.getItem('rokuUpdateAutoCheck')).toBe('false');
    resetUpdates();
    expect(useUpdates.getState().autoCheck).toBe(false);
  });

  it('closes the dialog on Later and opens it again on show', async () => {
    backend({ check_for_update: update });
    await useUpdates.getState().check({ manual: true });
    useUpdates.getState().later();
    expect(state()).toEqual({ status: 'available', update, open: false });
    useUpdates.getState().show();
    expect(state()).toEqual({ status: 'available', update, open: true });
  });
});

describe('a desktop install', () => {
  it('shows the download’s progress', async () => {
    let send: ((event: { payload: unknown }) => void) | undefined;
    vi.mocked(listen).mockImplementation((_event, handler) => {
      send = handler as typeof send;
      return Promise.resolve(() => {});
    });
    let finish: (value: unknown) => void = () => {};
    vi.mocked(invoke).mockImplementation((command: string) =>
      command === 'install_update' ? new Promise((resolve) => (finish = resolve)) : Promise.resolve(update)
    );
    await useUpdates.getState().check({ manual: true });

    const installing = useUpdates.getState().install();
    // The listener is up before the install starts
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('install_update'));
    expect(listen).toHaveBeenCalledWith('update-progress', expect.any(Function));
    send?.({ payload: { downloaded: 5, total: 10, installing: false } });
    expect(state()).toEqual({
      status: 'installing',
      update,
      progress: { downloaded: 5, total: 10, installing: false },
    });
    finish(undefined);
    await installing;
  });

  it('reports a failed install', async () => {
    backend({ check_for_update: update, install_update: new Error('signature mismatch') });
    await useUpdates.getState().check({ manual: true });
    await useUpdates.getState().install();
    expect(state()).toEqual({ status: 'installFailed', update, error: 'Signature mismatch.' });
  });
});

describe('a phone’s download', () => {
  function phone(): RokuAppBridge & { downloadUpdate: ReturnType<typeof vi.fn> } {
    const bridge = {
      downloadUpdate: vi.fn(),
      installsBlocked: vi.fn(() => false),
      openSecuritySettings: vi.fn(),
    };
    window.RokuApp = bridge;
    return bridge;
  }
  const report = (said: UpdateReport) => window.__rokuUpdate?.(said);

  it('downloads through the app and closes the dialog once the installer is open', async () => {
    const bridge = phone();
    backend({ check_for_update: update });
    await useUpdates.getState().check({ manual: true });

    const downloading = useUpdates.getState().download();
    expect(bridge.downloadUpdate).toHaveBeenCalledWith('0.3.0');
    report({ downloaded: 3, total: null });
    expect(state()).toEqual({
      status: 'installing',
      update,
      progress: { downloaded: 3, total: null, installing: false },
    });
    report({ done: true });
    await downloading;
    expect(state()).toEqual({ status: 'available', update, open: false });
  });

  it('reports why a download failed', async () => {
    phone();
    backend({ check_for_update: update });
    await useUpdates.getState().check({ manual: true });
    const downloading = useUpdates.getState().download();
    report({ error: 'GitHub answered 404.' });
    await downloading;
    expect(state()).toEqual({ status: 'installFailed', update, error: 'GitHub answered 404.' });
  });

  it('opens the APK in the browser without the app’s bridge', async () => {
    backend({ check_for_update: update, open_update_download: undefined });
    await useUpdates.getState().check({ manual: true });
    await useUpdates.getState().download();
    expect(invoke).toHaveBeenCalledWith('open_update_download');
    expect(state()).toEqual({ status: 'available', update, open: false });
  });

  it('reports a browser download that could not open', async () => {
    backend({ check_for_update: update, open_update_download: new Error('no browser') });
    await useUpdates.getState().check({ manual: true });
    await useUpdates.getState().openInBrowser();
    expect(state()).toEqual({ status: 'installFailed', update, error: 'No browser.' });
  });
});
