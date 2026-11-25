export interface IconCacheEntry {
  data: string;
  timestamp: number;
}

// Room for a whole app list: the grid is no longer paged.
export const ICON_CACHE_LIMIT = 300;
export const ICON_CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour

export const iconCache = new Map<string, IconCacheEntry>();
