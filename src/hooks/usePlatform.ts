import { useEffect, useState } from 'react';
import { platform } from '@tauri-apps/plugin-os';

// `undefined` until the first read. The Tauri plugin answers synchronously, so the platform is
// normally known on the very first render; a promise is only seen under test mocks.
let resolvedPlatform: string | null | undefined;
let platformPromise: Promise<string | null> | null = null;

function readPlatform(): string | null | undefined {
  if (resolvedPlatform !== undefined || platformPromise) {
    return resolvedPlatform;
  }

  try {
    const value = platform() as unknown;
    if (typeof (value as Promise<string>)?.then === 'function') {
      platformPromise = (value as Promise<string>)
        .catch(() => null)
        .then((result) => {
          resolvedPlatform = result;
          return result;
        });
    } else {
      resolvedPlatform = typeof value === 'string' ? value : null;
    }
  } catch {
    resolvedPlatform = null;
  }

  return resolvedPlatform;
}

/** Test hook: forget the cached platform so the next read asks the plugin again. */
export function resetPlatformForTests(): void {
  resolvedPlatform = undefined;
  platformPromise = null;
}

/** The OS the app runs on, or `null` while it is not known yet (or cannot be determined). */
export function usePlatform(): string | null {
  const [currentPlatform, setCurrentPlatform] = useState<string | null>(() => readPlatform() ?? null);

  useEffect(() => {
    let mounted = true;
    readPlatform();
    if (platformPromise) {
      void platformPromise.then((value) => {
        if (mounted) {
          setCurrentPlatform(value);
        }
      });
    }
    return () => {
      mounted = false;
    };
  }, []);

  return currentPlatform;
}
