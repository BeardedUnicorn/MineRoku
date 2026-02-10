import { useEffect, useState } from 'react';
import { platform } from '@tauri-apps/plugin-os';

let platformPromise: Promise<string | null> | null = null;

async function getPlatformValue(): Promise<string | null> {
  if (!platformPromise) {
    try {
      const value = platform();
      if (typeof (value as unknown as Promise<string>)?.then === 'function') {
        platformPromise = (value as unknown as Promise<string>).catch(() => null);
      } else {
        platformPromise = Promise.resolve(value as string);
      }
    } catch {
      platformPromise = Promise.resolve(null);
    }
  }
  return platformPromise;
}

export function usePlatform(): string | null {
  const [currentPlatform, setCurrentPlatform] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void getPlatformValue().then((value) => {
      if (mounted) {
        setCurrentPlatform(value);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  return currentPlatform;
}
