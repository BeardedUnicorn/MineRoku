import { useCallback, useEffect } from 'react';
import type { RokuDevice } from '../store';
import type { RokuApp } from '../services/rokuClient';
import { ensureApps, loadCachedApps, refreshApps, selectApps, useAppsStore } from '../services/appsStore';
import { useToast } from '../components/ToastProvider';

interface DeviceApps {
  apps: RokuApp[];
  isLoading: boolean;
  /** Fetch again now, reporting a failure in a toast. */
  refresh: () => void;
}

/**
 * The device's apps, sorted by name: the cached list at once, then the live one on mount and
 * whenever the device comes back online. `reportErrors` is for the view the user asked for the
 * list in; a view that merely uses the list (the favorites row) stays quiet.
 */
export function useDeviceApps(device: RokuDevice, { reportErrors = false } = {}): DeviceApps {
  const { ip, port } = device;
  const { apps, isLoading } = useAppsStore(selectApps(device));
  const showToast = useToast();
  const isConnected = !device.status || device.status === 'connected';

  useEffect(() => {
    void loadCachedApps({ ip, port });
  }, [ip, port]);

  useEffect(() => {
    if (!isConnected) {
      return;
    }
    let live = true;
    void ensureApps({ ip, port }).then((error) => {
      if (error && live && reportErrors) {
        showToast({ message: `Error fetching apps: ${error}`, severity: 'error' });
      }
    });
    return () => {
      live = false;
    };
  }, [ip, port, isConnected, reportErrors, showToast]);

  const refresh = useCallback(() => {
    if (!isConnected) {
      return;
    }
    void refreshApps({ ip, port }).then((error) => {
      if (error) {
        showToast({ message: `Error fetching apps: ${error}`, severity: 'error' });
      }
    });
  }, [ip, port, isConnected, showToast]);

  return { apps, isLoading, refresh };
}
