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
let activeIconRequests = 0;
const iconQueue: Array<() => void> = [];
const iconInFlight = new Map<string, Promise<string>>();

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
  return invoke<RokuApp[]>('list_roku_apps', { ip, port });
}

export async function sendRokuCommand(
  ip: string,
  port: number,
  command: string
): Promise<string> {
  return invoke<string>('send_roku_command', { ip, port, command });
}

export async function launchRokuApp(ip: string, port: number, appId: string): Promise<string> {
  return invoke<string>('launch_roku_app', { ip, port, app_id: appId });
}

export async function getActiveApp(ip: string, port: number): Promise<ActiveAppInfo> {
  return invoke<ActiveAppInfo>('get_active_app', { ip, port });
}

export async function getAppIcon(ip: string, port: number, appId: string): Promise<string> {
  const requestKey = `${ip}:${port}:${appId}`;
  const inFlight = iconInFlight.get(requestKey);
  if (inFlight) {
    return inFlight;
  }

  const request = enqueueIconRequest(() => invoke<string>('get_app_icon', { ip, port, app_id: appId }))
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
  return invoke<RokuApp[]>('get_cached_apps', { ip });
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
