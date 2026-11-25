import { useCallback, useState } from 'react';
import type { RokuDevice } from '../store';
import { launchRokuApp, type RokuApp } from '../services/rokuClient';
import { useToast } from '../components/ToastProvider';

const errorText = (error: unknown): string => {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return String(error);
};

/** Launch an app on the device, reporting the outcome in a toast. */
export function useLaunchApp(device: RokuDevice) {
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const showToast = useToast();
  const { ip, port, status } = device;

  const launch = useCallback(
    async (app: Pick<RokuApp, 'id' | 'name'>) => {
      if (status && status !== 'connected') {
        showToast({ message: 'Device appears offline', severity: 'error' });
        return;
      }
      setLaunchingId(app.id);
      try {
        await launchRokuApp(ip, port, app.id);
        showToast({ message: `Launched "${app.name}"`, severity: 'success' });
      } catch (error) {
        console.error('Error launching app:', error);
        showToast({ message: `Error launching "${app.name}": ${errorText(error)}`, severity: 'error' });
      } finally {
        setLaunchingId(null);
      }
    },
    [ip, port, status, showToast]
  );

  return { launch, launchingId };
}
