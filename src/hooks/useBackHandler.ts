import { useEffect, useRef } from 'react';
import { onBackButtonPress } from '@tauri-apps/api/app';
import type { PluginListener } from '@tauri-apps/api/core';
import { usePlatform } from './usePlatform';

type BackHandler = () => void;

// Open drawers and dialogs, most recent last. The Android back gesture closes the top one.
const handlers: BackHandler[] = [];
let listener: Promise<PluginListener | null> | null = null;

// The native listener exists only while something is open: with no listener registered, Tauri
// leaves the back gesture to the system, which is what should happen on the main screen.
function syncListener() {
  if (handlers.length > 0 && !listener) {
    listener = onBackButtonPress(() => {
      handlers[handlers.length - 1]?.();
    }).catch(() => null);
  } else if (handlers.length === 0 && listener) {
    const pending = listener;
    listener = null;
    void pending.then((registered) => registered?.unregister()).catch(() => undefined);
  }
}

/** While `active`, the Android back gesture calls `onBack` instead of leaving the app. */
export function useBackHandler(active: boolean, onBack: BackHandler): void {
  const currentPlatform = usePlatform();
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!active || currentPlatform !== 'android') {
      return;
    }

    const handler: BackHandler = () => onBackRef.current();
    handlers.push(handler);
    syncListener();

    return () => {
      const index = handlers.lastIndexOf(handler);
      if (index >= 0) {
        handlers.splice(index, 1);
      }
      syncListener();
    };
  }, [active, currentPlatform]);
}
