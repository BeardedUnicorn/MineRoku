/**
 * Updates from Roku Remote's GitHub releases (modeled on TaskMint's). The
 * Rust side reads the release feed and installs (src-tauri/src/updates.rs).
 * This store holds what the update dialog (UpdatePrompt) and Settings →
 * Updates show, and whether checks run on their own.
 *
 * A phone isn't updated in place. The app downloads the release's APK
 * (AppUpdate.kt) and opens Android's installer on it, which installs it
 * over the app. Where the app can't download it, or the download fails, the
 * browser does instead (`openInBrowser`).
 */

import { create } from 'zustand';
import {
  checkForUpdate,
  installUpdate,
  onUpdateProgress,
  openUpdateDownload,
  type AvailableUpdate,
  type UpdateProgress,
} from './rokuClient';
import { appUpdateBridge } from './androidUpdate';

export type { AvailableUpdate, UpdateProgress } from './rokuClient';

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking'; manual: boolean }
  | { status: 'upToDate' }
  /** A check the user asked for failed (automatic checks fail quietly). */
  | { status: 'checkFailed'; error: string }
  /** `open`: the dialog asks. Later closes it until the next check. */
  | { status: 'available'; update: AvailableUpdate; open: boolean }
  /** `progress` is null until the download starts. */
  | { status: 'installing'; update: AvailableUpdate; progress: UpdateProgress | null }
  | { status: 'installFailed'; update: AvailableUpdate; error: string };

export interface UpdatesStore {
  update: UpdateState;
  /** Checks run on their own (at launch, then daily). */
  autoCheck: boolean;
  /**
   * Asks GitHub for a newer release; one it finds opens the dialog. A check
   * the user asked for (`manual`) shows its failure; an automatic one only
   * logs it. Nothing happens while a check or an install is under way.
   */
  check(options: { manual: boolean }): Promise<void>;
  /** Closes the dialog; the next check asks again. */
  later(): void;
  /** Opens the dialog again for the update a check found. */
  show(): void;
  /**
   * A desktop's update: downloads and installs it, showing its progress.
   * On success the app restarts into the new version, so this only comes
   * back on failure.
   */
  install(): Promise<void>;
  /**
   * A phone's update: downloads the release, showing its progress, and
   * opens Android's installer on it, which asks before replacing the app.
   * The dialog closes once the installer is up. Where the app can't
   * download it itself, the browser does.
   */
  download(): Promise<void>;
  /** A phone's update the other way: the browser downloads the APK, and the dialog closes. */
  openInBrowser(): Promise<void>;
  setAutoCheck(autoCheck: boolean): void;
}

/** How long after the last check an automatic one is due. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

// "roku" first, so that Delete All Data removes them with the rest
const AUTO_CHECK_KEY = 'rokuUpdateAutoCheck';
const LAST_CHECKED_KEY = 'rokuUpdateLastCheckedAt';

/** localStorage can be unavailable; then nothing is remembered. */
function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered; the default comes back next launch.
  }
}

/** A refusal as a sentence: the Rust side's messages start in lower case. */
export function sentence(reason: unknown): string {
  const text = String(reason).trim();
  const capital = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}

/** When the last check succeeded, in ms; null if never. */
export function lastCheckedAt(): number | null {
  const value = Number(stored(LAST_CHECKED_KEY));
  return value > 0 ? value : null;
}

/** An automatic check is due: they're on, and the last one was a day ago (or never). */
export function automaticCheckDue(now: number): boolean {
  const last = lastCheckedAt();
  return useUpdates.getState().autoCheck && (last === null || now - last >= CHECK_INTERVAL_MS);
}

/** A version's numbers ("0.2.0"); null for anything else. */
function numbers(version: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Whether `version` is newer than `than`; false when either can't be read. */
export function isNewer(version: string, than: string): boolean {
  const a = numbers(version);
  const b = numbers(than);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/** One release's notes: its version and the Markdown under its heading. */
export interface ReleaseNotes {
  version: string;
  notes: string;
}

/**
 * The releases since the version running now, newest first: the feed's
 * changelog sections (`## X.Y.Z`) newer than it. A feed without a
 * changelog gives the new version's own notes.
 */
export function releasesSince(update: AvailableUpdate): ReleaseNotes[] {
  const sections = (update.changelog ?? '')
    .split(/^## /m)
    .slice(1)
    .map((section) => {
      const newline = section.indexOf('\n');
      const heading = (newline < 0 ? section : section.slice(0, newline)).trim();
      const body = newline < 0 ? '' : section.slice(newline + 1).trim();
      return { version: heading.split(/\s/)[0], notes: body };
    })
    .filter(({ version }) => isNewer(version, update.currentVersion));
  if (sections.length > 0) return sections;
  return update.notes ? [{ version: update.version, notes: update.notes.trim() }] : [];
}

function initial(): Pick<UpdatesStore, 'update' | 'autoCheck'> {
  return { update: { status: 'idle' }, autoCheck: stored(AUTO_CHECK_KEY) !== 'false' };
}

export const useUpdates = create<UpdatesStore>()((set, get) => {
  const setUpdate = (update: UpdateState) => set({ update });
  /** What a check found, when the dialog can act on it. */
  const found = (): AvailableUpdate | null => {
    const { update } = get();
    return update.status === 'available' || update.status === 'installFailed' ? update.update : null;
  };

  return {
    ...initial(),

    async check({ manual }) {
      const before = get().update;
      if (before.status === 'checking' || before.status === 'installing') return;
      setUpdate({ status: 'checking', manual });
      try {
        const update = await checkForUpdate();
        store(LAST_CHECKED_KEY, String(Date.now()));
        setUpdate(update === null ? { status: 'upToDate' } : { status: 'available', update, open: true });
      } catch (error) {
        if (manual) {
          setUpdate({ status: 'checkFailed', error: sentence(error) });
        } else {
          console.warn('Automatic update check failed:', error);
          setUpdate(before);
        }
      }
    },

    later() {
      const update = found();
      if (update) setUpdate({ status: 'available', update, open: false });
    },

    show() {
      const { update } = get();
      if (update.status === 'available') setUpdate({ ...update, open: true });
    },

    async install() {
      const update = found();
      if (!update) return;
      setUpdate({ status: 'installing', update, progress: null });
      const stop = await onUpdateProgress((progress) => {
        const now = get().update;
        if (now.status === 'installing') setUpdate({ ...now, progress });
      }).catch(() => () => {});
      try {
        await installUpdate();
      } catch (error) {
        setUpdate({ status: 'installFailed', update, error: sentence(error) });
      } finally {
        stop();
      }
    },

    async download() {
      const update = found();
      if (!update) return;
      const bridge = appUpdateBridge();
      if (!bridge) return get().openInBrowser();
      setUpdate({ status: 'installing', update, progress: null });
      try {
        await bridge.download(update.version, (progress) =>
          setUpdate({ status: 'installing', update, progress: { ...progress, installing: false } })
        );
        setUpdate({ status: 'available', update, open: false });
      } catch (error) {
        setUpdate({ status: 'installFailed', update, error: sentence(error) });
      }
    },

    async openInBrowser() {
      const update = found();
      if (!update) return;
      try {
        await openUpdateDownload();
        setUpdate({ status: 'available', update, open: false });
      } catch (error) {
        setUpdate({ status: 'installFailed', update, error: sentence(error) });
      }
    },

    setAutoCheck(autoCheck) {
      store(AUTO_CHECK_KEY, String(autoCheck));
      set({ autoCheck });
    },
  };
});

/** Back to what localStorage says: after Delete All Data, and for each test. */
export function resetUpdates(): void {
  useUpdates.setState(initial());
}
