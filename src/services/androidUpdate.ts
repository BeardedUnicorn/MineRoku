/**
 * The Android app's own update, outside the page: MainActivity.kt adds
 * `window.RokuApp`, and AppUpdate.kt downloads a release's APK and opens
 * Android's installer on it, reporting to `window.__rokuUpdate`. None of
 * this exists anywhere else.
 */

/** What MainActivity.kt's AppBridge adds as `window.RokuApp`. */
export interface RokuAppBridge {
  /**
   * Downloads a release (or joins the download that's under way, or
   * carries on with one that was cut off) and opens Android's installer on
   * it. `window.__rokuUpdate` hears how far it is.
   */
  downloadUpdate(version: string): void;
  /** Whether the phone won't install an update (Android's Advanced Protection is on). */
  installsBlocked(): boolean;
  /** The phone's Security settings, where Advanced Protection is turned off. */
  openSecuritySettings(): void;
}

/** What AppUpdate.kt reports of a download: how far it is, that the installer is open, or why not. */
export type UpdateReport = { downloaded: number; total: number | null } | { done: true } | { error: string };

declare global {
  interface Window {
    RokuApp?: RokuAppBridge;
    __rokuUpdate?: (report: UpdateReport) => void;
  }
}

/** How far a phone's download is. */
export interface DownloadReport {
  downloaded: number;
  total: number | null;
}

export interface AppUpdateBridge {
  /** Resolves once Android's installer is open; rejects with AppUpdate.kt's reason. */
  download(version: string, onProgress: (progress: DownloadReport) => void): Promise<void>;
}

/**
 * The app's own download, or null where there's none (any desktop, or an
 * Android build without the bridge). Methods are called on the bridge
 * itself: Android refuses a method taken off it.
 */
export function appUpdateBridge(): AppUpdateBridge | null {
  const android = window.RokuApp;
  if (!android) return null;
  return {
    download: (version, onProgress) =>
      new Promise<void>((resolve, reject) => {
        window.__rokuUpdate = (report) => {
          if ('done' in report) resolve();
          else if ('error' in report) reject(report.error);
          else onProgress(report);
        };
        android.downloadUpdate(version);
      }),
  };
}

/**
 * Whether the phone won't install an update it downloads: Android's
 * Advanced Protection blocks apps that don't come from a store, as these
 * updates don't. False anywhere else.
 */
export function sideloadingBlocked(): boolean {
  try {
    return window.RokuApp?.installsBlocked() ?? false;
  } catch {
    return false;
  }
}

/** Opens the phone's Security settings. Nothing anywhere else. */
export function openSecuritySettings(): void {
  window.RokuApp?.openSecuritySettings();
}
