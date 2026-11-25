import { create } from 'zustand';
import { getCachedApps, listRokuApps, type RokuApp } from './rokuClient';

// A device's app list, shared by the apps grid and the favorites row so they agree and the
// device is asked once. Not persisted: the backend keeps its own cache (get_cached_apps).

interface AppsEntry {
  apps: RokuApp[];
  isLoading: boolean;
}

interface AppsState {
  entries: Record<string, AppsEntry>;
}

type DeviceAddress = { ip: string; port: number };

const EMPTY: AppsEntry = { apps: [], isLoading: false };
/** A list this fresh is not fetched again just because another view mounted. */
const FRESH_MS = 10_000;
const RETRY_DELAY_MS = 2000;

export const useAppsStore = create<AppsState>(() => ({ entries: {} }));

const keyOf = (device: DeviceAddress) => `${device.ip}:${device.port}`;
const byName = (apps: RokuApp[]) => [...apps].sort((a, b) => a.name.localeCompare(b.name));

const patch = (key: string, change: Partial<AppsEntry>) =>
  useAppsStore.setState((state) => ({
    entries: { ...state.entries, [key]: { ...(state.entries[key] ?? EMPTY), ...change } },
  }));

const inFlight = new Map<string, Promise<string | null>>();
const fetchedAt = new Map<string, number>();

export const selectApps = (device: DeviceAddress) => (state: AppsState) =>
  state.entries[keyOf(device)] ?? EMPTY;

const errorText = (error: unknown): string => {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return String(error);
};

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/**
 * The backend's cached list, for an instant (and offline) view. It only fills an empty list:
 * it never replaces or blanks what is already shown.
 */
export async function loadCachedApps(device: DeviceAddress): Promise<void> {
  const key = keyOf(device);
  try {
    const cached = await getCachedApps(device.ip);
    if (cached.length > 0 && (useAppsStore.getState().entries[key]?.apps.length ?? 0) === 0) {
      patch(key, { apps: byName(cached) });
    }
  } catch {
    // Non-fatal; the live fetch still runs.
  }
}

/**
 * Fetch the live list. A Roku that is still waking up can answer with nothing or with XML that
 * does not parse, so the first such answer is retried once. Resolves with an error message, or
 * null on success. Calls made while one is running share it.
 */
export function refreshApps(device: DeviceAddress): Promise<string | null> {
  const key = keyOf(device);
  const running = inFlight.get(key);
  if (running) {
    return running;
  }

  const attempt = async (retried: boolean): Promise<string | null> => {
    try {
      const apps = await listRokuApps(device.ip, device.port);
      if (apps.length === 0 && !retried) {
        await wait(RETRY_DELAY_MS);
        return attempt(true);
      }
      fetchedAt.set(key, Date.now());
      patch(key, { apps: byName(apps) });
      return null;
    } catch (error) {
      console.error('Error fetching apps:', error);
      const message = errorText(error);
      if (message.includes('parse') && !retried) {
        await wait(RETRY_DELAY_MS);
        return attempt(true);
      }
      return message;
    }
  };

  patch(key, { isLoading: true });
  const request = attempt(false).finally(() => {
    inFlight.delete(key);
    patch(key, { isLoading: false });
  });
  inFlight.set(key, request);
  return request;
}

/** Like refreshApps, but does nothing when the list was fetched moments ago. */
export function ensureApps(device: DeviceAddress): Promise<string | null> {
  const last = fetchedAt.get(keyOf(device));
  if (last !== undefined && Date.now() - last < FRESH_MS && !inFlight.has(keyOf(device))) {
    return Promise.resolve(null);
  }
  return refreshApps(device);
}

/** Forget every list, as Delete All Data does. */
export function resetApps(): void {
  inFlight.clear();
  fetchedAt.clear();
  useAppsStore.setState({ entries: {} });
}
