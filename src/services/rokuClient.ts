import { invoke } from '@tauri-apps/api/core';

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
  isPlaying: boolean;
  appIconUrl?: string;
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

export async function restartApp(): Promise<void> {
  return invoke<void>('restart_app');
}

export async function updateMediaNotification(
  args: UpdateMediaNotificationArgs
): Promise<void> {
  return invoke<void>('update_media_notification', {
    deviceName: args.deviceName,
    deviceIp: args.deviceIp,
    devicePort: args.devicePort,
    appName: args.appName,
    isPlaying: args.isPlaying,
    appIconUrl: args.appIconUrl,
  });
}
