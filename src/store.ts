import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

export interface RokuDevice {
    name: string;
    ip: string;
    port: number;
    url: string;
    status: ConnectionStatus;
}

export interface AppState {
    devices: RokuDevice[];
    selectedDevice: RokuDevice | null;
    favoriteApps: { [deviceIp: string]: string[] };
    preferLastUsed: boolean;
    setDevices: (devices: RokuDevice[]) => void;
    setSelectedDevice: (device: RokuDevice | null) => void;
    updateDeviceStatus: (ip: string, status: ConnectionStatus) => void;
    addDiscoveredDevices: (discovered: RokuDevice[]) => void;
    upsertDevice: (device: Omit<RokuDevice, 'status'> & { status?: ConnectionStatus }) => void;
    markDeviceDisconnected: (ip: string) => void;
    toggleFavoriteApp: (deviceIp: string, appId: string) => void;
    setPreferLastUsed: (v: boolean) => void;
}

export const useAppStore = create<AppState>()(
    persist(
        (set, get) => ({
            devices: [],
            selectedDevice: null,
            favoriteApps: {},
            preferLastUsed: true,
            setDevices: (devices) => set({ devices }),
            setSelectedDevice: (device) => set({ selectedDevice: device }),
            updateDeviceStatus: (ip, status) => {
                set((state) => ({
                    devices: state.devices.map((d) =>
                        d.ip === ip ? { ...d, status } : d
                    ),
                }));
            },
            upsertDevice: (device) => {
                set((state) => {
                    const existingIndex = state.devices.findIndex(d => d.ip === device.ip);
                    const existing = existingIndex >= 0 ? state.devices[existingIndex] : undefined;
                    const next: RokuDevice = existing
                        ? {
                            ...existing,
                            ...device,
                            status: device.status ?? existing.status,
                          }
                        : {
                            name: device.name,
                            ip: device.ip,
                            port: device.port,
                            url: device.url,
                            status: device.status ?? 'connected',
                          };

                    const equal = existing && existing.name === next.name && existing.port === next.port && existing.url === next.url && existing.status === next.status;

                    let devices = state.devices;
                    if (!existing) {
                        devices = [...devices, next];
                    } else if (!equal) {
                        devices = devices.map((d, i) => (i === existingIndex ? next : d));
                    }

                    let selectedDevice = state.selectedDevice;
                    if (selectedDevice?.ip === next.ip) {
                        const selEqual = selectedDevice.name === next.name && selectedDevice.port === next.port && selectedDevice.url === next.url && selectedDevice.status === next.status;
                        if (!selEqual) {
                            selectedDevice = next;
                        }
                    }
                    return { devices, selectedDevice };
                });
            },
            markDeviceDisconnected: (ip) => {
                set((state) => ({
                    devices: state.devices.map((d) => d.ip === ip ? { ...d, status: 'disconnected' } : d)
                }));
            },
            addDiscoveredDevices: (discovered) => {
                // Manual discovery should upsert discovered devices as connected,
                // and never mark others offline — background events handle disconnections.
                const state = get();
                const existingDevices = state.devices;
                const discoveredIps = new Set(discovered.map(d => d.ip));

                // Update devices we already know about
                const updatedDevices = existingDevices.map(device => {
                    if (discoveredIps.has(device.ip)) {
                        const discoveredDevice = discovered.find(d => d.ip === device.ip)!;
                        const next = { ...device, ...discoveredDevice, status: 'connected' as ConnectionStatus };
                        const equal = device.name === next.name && device.port === next.port && device.url === next.url && device.status === next.status;
                        return equal ? device : next;
                    }
                    return device;
                });

                // Add brand new devices
                const newDevices = discovered
                    .filter(d => !existingDevices.some(ed => ed.ip === d.ip))
                    .map(d => ({ ...d, status: 'connected' as ConnectionStatus }));

                // Keep selected device in sync if it was discovered
                let selectedDevice = state.selectedDevice;
                if (selectedDevice && discoveredIps.has(selectedDevice.ip)) {
                    const selectedIp = selectedDevice.ip;
                    const discoveredDevice = discovered.find(d => d.ip === selectedIp);
                    if (discoveredDevice) {
                        const nextSel: RokuDevice = {
                            ...selectedDevice,
                            ...discoveredDevice,
                            status: 'connected',
                        };
                        const selEqual = selectedDevice.name === nextSel.name && selectedDevice.port === nextSel.port && selectedDevice.url === nextSel.url && selectedDevice.status === nextSel.status;
                        if (!selEqual) {
                            selectedDevice = nextSel;
                        }
                    }
                }

                set({ devices: [...updatedDevices, ...newDevices], selectedDevice });
            },
            toggleFavoriteApp: (deviceIp, appId) => {
                set((state) => {
                    const currentFavorites = state.favoriteApps[deviceIp] || [];
                    const newFavorites = currentFavorites.includes(appId)
                        ? currentFavorites.filter((id) => id !== appId)
                        : [...currentFavorites, appId];
                    
                    return {
                        favoriteApps: {
                            ...state.favoriteApps,
                            [deviceIp]: newFavorites,
                        },
                    };
                });
            },
            setPreferLastUsed: (v) => set({ preferLastUsed: v }),
        }),
        {
            name: 'roku-remote-storage', // name of the item in the storage (must be unique)
            storage: createJSONStorage(() => localStorage), // (optional) by default, 'localStorage' is used
            partialize: (state) => ({ 
                devices: state.devices, 
                favoriteApps: state.favoriteApps,
                selectedDevice: state.selectedDevice,
                preferLastUsed: state.preferLastUsed,
            }),
        }
    )
);
