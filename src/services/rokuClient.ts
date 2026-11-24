import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface RokuDeviceEvent {
  name: string;
  ip: string;
  port: number;
  url: string;
  hardware_id: string;
}

export interface RokuApp {
  id: string;
  name: string;
  version: string;
}

export interface ActiveAppInfo {
  name: string;
  id: string;
}

export interface PluginInfo {
  id: string;
  name: string;
  bandwidth: string;
}

export interface FormatInfo {
  audio: string;
  captions: string;
  container: string;
  drm: string;
  video: string;
  video_res: string;
}

export interface MediaPlayerInfo {
  state: string;
  error: boolean;
  plugin?: PluginInfo;
  format?: FormatInfo;
  position?: string;
  duration?: string;
  is_live?: boolean;
  runtime?: string;
}

interface UpdateMediaNotificationArgs {
  deviceName: string;
  deviceIp: string;
  devicePort: number;
  appName: string;
  appId?: string;
  isPlaying: boolean;
}

const ICON_REQUEST_CONCURRENCY = 6;

let discoverInFlight: Promise<RokuDeviceEvent[]> | null = null;
const listAppsInFlight = new Map<string, Promise<RokuApp[]>>();
let activeIconRequests = 0;
const iconQueue: Array<() => void> = [];
const iconInFlight = new Map<string, Promise<string>>();

function normalizeRokuApp(raw: unknown): RokuApp | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const app = raw as Record<string, unknown>;
  const idValue = app.id ?? app.appId ?? app.app_id;
  const nameValue = app.name;
  const versionValue = app.version;

  const id = typeof idValue === 'string' ? idValue.trim() : '';
  const name = typeof nameValue === 'string' ? nameValue.trim() : '';
  const version = typeof versionValue === 'string' && versionValue.trim() ? versionValue : 'N/A';

  if (!id || !name) {
    return null;
  }

  return { id, name, version };
}

function enqueueIconRequest<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      activeIconRequests += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          activeIconRequests -= 1;
          const next = iconQueue.shift();
          if (next) {
            next();
          }
        });
    };

    if (activeIconRequests < ICON_REQUEST_CONCURRENCY) {
      run();
      return;
    }

    iconQueue.push(run);
  });
}

export async function discoverRokuDevices(): Promise<RokuDeviceEvent[]> {
  if (discoverInFlight) {
    return discoverInFlight;
  }

  discoverInFlight = invoke<RokuDeviceEvent[]>('discover_roku_devices').finally(() => {
    discoverInFlight = null;
  });
  return discoverInFlight;
}

export async function checkDeviceConnectivity(ip: string, port: number): Promise<boolean> {
  return invoke<boolean>('check_device_connectivity', { ip, port });
}

export async function getMediaPlayer(ip: string, port: number): Promise<MediaPlayerInfo> {
  return invoke<MediaPlayerInfo>('get_media_player', { ip, port });
}

export async function listRokuApps(ip: string, port: number): Promise<RokuApp[]> {
  const requestKey = `${ip}:${port}`;
  const inFlight = listAppsInFlight.get(requestKey);
  if (inFlight) {
    return inFlight;
  }

  const request = invoke<unknown[]>('list_roku_apps', { ip, port })
    .then((apps) => apps.map(normalizeRokuApp).filter((app): app is RokuApp => app !== null))
    .finally(() => {
      listAppsInFlight.delete(requestKey);
    });

  listAppsInFlight.set(requestKey, request);
  return request;
}

export async function sendRokuCommand(
  ip: string,
  port: number,
  command: string
): Promise<string> {
  return invoke<string>('send_roku_command', { ip, port, command });
}

/** The key `toggleRokuPower` is asked for; it is not sent to the Roku as it is. */
export const POWER_TOGGLE_COMMAND = 'Power';

/**
 * Turns the TV on when it is in standby and off when it is on. Resolves with the key that was
 * sent: "PowerOn", "PowerOff", or "Power" when the TV didn't say which state it is in.
 */
export async function toggleRokuPower(ip: string, port: number): Promise<string> {
  return invoke<string>('toggle_roku_power', { ip, port });
}

export async function launchRokuApp(ip: string, port: number, appId: string): Promise<string> {
  return invoke<string>('launch_roku_app', { ip, port, appId });
}

export async function getActiveApp(ip: string, port: number): Promise<ActiveAppInfo> {
  const app = await invoke<Record<string, unknown>>('get_active_app', { ip, port });
  const id = app.id ?? app.appId ?? app.app_id;
  const name = app.name;

  return {
    id: typeof id === 'string' && id.trim() ? id : 'roku',
    name: typeof name === 'string' && name.trim() ? name : 'Roku',
  };
}

export async function getAppIcon(ip: string, port: number, appId: string): Promise<string> {
  if (!appId?.trim()) {
    throw new Error('Missing app id for icon request');
  }

  const requestKey = `${ip}:${port}:${appId}`;
  const inFlight = iconInFlight.get(requestKey);
  if (inFlight) {
    return inFlight;
  }

  const request = enqueueIconRequest(() => invoke<string>('get_app_icon', { ip, port, appId }))
    .finally(() => {
      iconInFlight.delete(requestKey);
    });

  iconInFlight.set(requestKey, request);
  return request;
}

export async function getCachedDevices(): Promise<RokuDeviceEvent[]> {
  return invoke<RokuDeviceEvent[]>('get_cached_devices');
}

export async function getCachedApps(ip: string): Promise<RokuApp[]> {
  const apps = await invoke<unknown[]>('get_cached_apps', { ip });
  return apps.map(normalizeRokuApp).filter((app): app is RokuApp => app !== null);
}

export async function clearAllData(): Promise<void> {
  return invoke<void>('clear_all_data');
}

/** Removes one device and its cached apps and icons from the backend cache. */
export async function forgetDevice(hardwareId: string): Promise<void> {
  return invoke<void>('forget_device', { hardwareId });
}

export async function restartApp(): Promise<void> {
  return invoke<void>('restart_app');
}

/** check_for_update's reply when there's a newer release (updates.rs). */
export interface AvailableUpdate {
  version: string;
  /** The version running now. */
  currentVersion: string;
  /** The release's CHANGELOG section (Markdown). */
  notes: string | null;
  /** Every release's notes, newest first (the CHANGELOG's sections); null from a feed without them. */
  changelog: string | null;
  /** When it was published (RFC 3339). */
  date: string | null;
}

/** `update-progress`'s payload while a desktop installs an update. */
export interface UpdateProgress {
  downloaded: number;
  /** null when the server doesn't say. */
  total: number | null;
  /** The download is done and the update is being installed. */
  installing: boolean;
}

/** Asks the latest GitHub release whether there's a newer version; null when this is the newest. */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  return invoke<AvailableUpdate | null>('check_for_update');
}

/**
 * A desktop's update: downloads, verifies and installs what the last check
 * found, then restarts into it. Only comes back on failure.
 */
export async function installUpdate(): Promise<void> {
  return invoke<void>('install_update');
}

/** A phone's fallback: opens the found release's APK in the browser. */
export async function openUpdateDownload(): Promise<void> {
  return invoke<void>('open_update_download');
}

/** Hears a desktop install's download progress. */
export function onUpdateProgress(handler: (progress: UpdateProgress) => void): Promise<UnlistenFn> {
  return listen<UpdateProgress>('update-progress', (event) => handler(event.payload));
}

export async function updateMediaNotification(
  args: UpdateMediaNotificationArgs
): Promise<void> {
  return invoke<void>('update_media_notification', {
    deviceName: args.deviceName,
    deviceIp: args.deviceIp,
    devicePort: args.devicePort,
    appName: args.appName,
    appId: args.appId,
    isPlaying: args.isPlaying,
  });
}

export async function ensureAndroidDiscoveryPermissions(): Promise<boolean> {
  return invoke<boolean>('ensure_android_discovery_permissions');
}

export async function ensureAndroidNotificationPermission(): Promise<boolean> {
  return invoke<boolean>('ensure_android_notification_permission');
}

export async function openAndroidAppSettings(): Promise<void> {
  return invoke<void>('open_android_app_settings');
}

/** Removes the Android media notification. A no-op on other platforms. */
export async function hideMediaNotification(): Promise<void> {
  return invoke<void>('hide_media_notification');
}

/**
 * Android 17+ needs a runtime permission to reach devices on the LAN at all, even without a
 * scan. Resolves with the user's answer; always `true` on older Android and other platforms.
 */
export async function ensureAndroidLocalNetworkAccess(): Promise<boolean> {
  return invoke<boolean>('ensure_android_local_network_access');
}

/** A short haptic tick on Android; a no-op elsewhere. Never rejects. */
export function hapticTap(): void {
  void invoke<void>('haptic_tap').catch(() => undefined);
}
