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
    favoriteApps: { [deviceIp: string]: string[] };
    actions: {
        setDevices: (devices: RokuDevice[]) => void;
        updateDeviceStatus: (ip: string, status: ConnectionStatus) => void;
        addDiscoveredDevices: (discovered: RokuDevice[]) => void;
        toggleFavoriteApp: (deviceIp: string, appId: string) => void;
    };
}

export const useAppStore = create<AppState>()(
    persist(
        (set, get) => ({
            devices: [],
            favoriteApps: {},
            actions: {
                setDevices: (devices) => set({ devices }),
                updateDeviceStatus: (ip, status) => {
                    set((state) => ({
                        devices: state.devices.map((d) =>
                            d.ip === ip ? { ...d, status } : d
                        ),
                    }));
                },
                addDiscoveredDevices: (discovered) => {
                    const existingDevices = get().devices;
                    const discoveredIps = new Set(discovered.map(d => d.ip));

                    // Update existing devices
                    const updatedDevices = existingDevices.map(device => {
                        if (discoveredIps.has(device.ip)) {
                            // Found on network, mark as connected
                            const discoveredDevice = discovered.find(d => d.ip === device.ip)!;
                            return { ...discoveredDevice, status: 'connected' as ConnectionStatus };
                        }
                        // Not found, mark as disconnected
                        return { ...device, status: 'disconnected' as ConnectionStatus };
                    });

                    // Add new devices not previously known
                    const newDevices = discovered.filter(d => !existingDevices.some(ed => ed.ip === d.ip));
                    
                    set({ devices: [...updatedDevices, ...newDevices] });
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
            },
        }),
        {
            name: 'roku-controller-storage', // name of the item in the storage (must be unique)
            storage: createJSONStorage(() => localStorage), // (optional) by default, 'localStorage' is used
            partialize: (state) => ({ devices: state.devices, favoriteApps: state.favoriteApps }), // Persist only devices and favorites
        }
    )
);