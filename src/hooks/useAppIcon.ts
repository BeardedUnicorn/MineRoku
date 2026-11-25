import { useEffect, useState } from 'react';
import { iconCache, ICON_CACHE_LIMIT, ICON_CACHE_TTL_MS } from '../iconCache';
import { getAppIcon } from '../services/rokuClient';

const readCache = (key: string): string | null => {
  const cached = iconCache.get(key);
  if (!cached) {
    return null;
  }
  if (Date.now() - cached.timestamp < ICON_CACHE_TTL_MS) {
    return cached.data;
  }
  iconCache.delete(key);
  return null;
};

/**
 * An app's icon as a data URL, from the in-memory cache or the device. Returns null until it
 * arrives, when `appId` is null, or while `enabled` is false and nothing is cached.
 */
export function useAppIcon(
  device: { ip: string; port: number },
  appId: string | null,
  enabled = true
): string | null {
  const cacheKey = appId === null ? null : `${device.ip}:${device.port}:${appId}`;
  const [loaded, setLoaded] = useState<{ key: string; data: string } | null>(() => {
    const data = cacheKey ? readCache(cacheKey) : null;
    return cacheKey && data ? { key: cacheKey, data } : null;
  });

  useEffect(() => {
    if (!cacheKey || appId === null) {
      return;
    }
    const cached = readCache(cacheKey);
    if (cached) {
      setLoaded({ key: cacheKey, data: cached });
      return;
    }
    if (!enabled) {
      return;
    }

    let cancelled = false;
    getAppIcon(device.ip, device.port, appId)
      .then((data) => {
        if (cancelled) {
          return;
        }
        iconCache.set(cacheKey, { data, timestamp: Date.now() });
        if (iconCache.size > ICON_CACHE_LIMIT) {
          iconCache.delete(iconCache.keys().next().value as string);
        }
        setLoaded({ key: cacheKey, data });
      })
      .catch((error) => {
        if (!cancelled) {
          console.error(`Error fetching icon for app ${appId}:`, error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [device.ip, device.port, appId, cacheKey, enabled]);

  // An icon loaded for another app is never shown for this one.
  return loaded && loaded.key === cacheKey ? loaded.data : null;
}
