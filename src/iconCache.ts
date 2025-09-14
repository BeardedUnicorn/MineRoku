export interface IconCacheEntry {
  data: string;
  timestamp: number;
}

export const ICON_CACHE_LIMIT = 100;
export const ICON_CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour

export const iconCache = new Map<string, IconCacheEntry>();
