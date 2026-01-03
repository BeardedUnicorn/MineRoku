import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

export interface RokuDevice {
    name: string;
    ip: string;
    port: number;
    url: string;
    hardware_id: string;
    status: ConnectionStatus;
}

export interface AppState {
    devices: RokuDevice[];
    selectedDevice: RokuDevice | null;
    favoriteApps: { [hardwareId: string]: string[] };
    preferLastUsed: boolean;
    showAllDevices: boolean;
    setDevices: (devices: RokuDevice[]) => void;
    setSelectedDevice: (device: RokuDevice | null) => void;
    updateDeviceStatus: (hardwareId: string, status: ConnectionStatus) => void;
    addDiscoveredDevices: (discovered: RokuDevice[]) => void;
    upsertDevice: (device: Omit<RokuDevice, 'status'> & { status?: ConnectionStatus }) => void;
    markDeviceDisconnected: (hardwareId: string) => void;
    toggleFavoriteApp: (hardwareId: string, appId: string) => void;
    setPreferLastUsed: (v: boolean) => void;
    setShowAllDevices: (v: boolean) => void;
}

// Migration function to update old IP-based storage to hardware_id
const migrateStorage = () => {
    const stored = localStorage.getItem('roku-remote-storage');
    if (!stored) return;
    
    try {
        const data = JSON.parse(stored);
        const state = data.state;
        
        if (!state) return;
        
        // Check if migration is needed (devices exist but don't have hardware_id)
        if (state.devices && state.devices.length > 0 && !state.devices[0].hardware_id) {
            console.log('Migrating storage to use hardware IDs...');
            
            // Generate temporary hardware IDs for existing devices based on IP
            state.devices = state.devices.map((device: { ip: string; name: string; port: number; url: string; status?: ConnectionStatus }) => ({
                ...device,
                hardware_id: `roku:legacy:${device.ip.replace(/\./g, '_')}`,
            }));
            
            // Migrate favoriteApps from IP to hardware_id
            if (state.favoriteApps) {
                const newFavoriteApps: { [key: string]: string[] } = {};
                for (const [ip, apps] of Object.entries(state.favoriteApps)) {
                    const device = state.devices.find((d: RokuDevice) => d.ip === ip);
                    if (device) {
                        newFavoriteApps[device.hardware_id] = apps as string[];
                    }
                }
                state.favoriteApps = newFavoriteApps;
            }
            
            // Update selected device
            if (state.selectedDevice && !state.selectedDevice.hardware_id) {
                const device = state.devices.find((d: RokuDevice) => d.ip === state.selectedDevice.ip);
                if (device) {
                    state.selectedDevice = device;
                }
            }
            
            // Save migrated data
            localStorage.setItem('roku-remote-storage', JSON.stringify({ ...data, state }));
            console.log('Storage migration complete');
        }
    } catch (e) {
        console.error('Failed to migrate storage:', e);
    }
};

// Run migration on module load
if (typeof window !== 'undefined') {
    migrateStorage();
}

export const useAppStore = create<AppState>()(
    persist(
        (set, get) => ({
            devices: [],
            selectedDevice: null,
            favoriteApps: {},
            preferLastUsed: true,
            showAllDevices: true,
            
            setDevices: (devices) => set({ devices }),
            setSelectedDevice: (device) => set({ selectedDevice: device }),
            
            updateDeviceStatus: (hardwareId, status) => {
                set((state) => ({
                    devices: state.devices.map((d) =>
                        d.hardware_id === hardwareId ? { ...d, status } : d
                    ),
                    selectedDevice: state.selectedDevice?.hardware_id === hardwareId 
                        ? { ...state.selectedDevice, status }
                        : state.selectedDevice,
                }));
            },
            
            upsertDevice: (device) => {
                set((state) => {
                    const existingIndex = state.devices.findIndex(d => d.hardware_id === device.hardware_id);
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
                            hardware_id: device.hardware_id,
                            status: device.status ?? 'connected',
                          };

                    // Log IP changes
                    if (existing && existing.ip !== next.ip) {
                        console.log(`Device ${next.name} IP changed from ${existing.ip} to ${next.ip}`);
                    }

                    const equal = existing && 
                        existing.name === next.name && 
                        existing.ip === next.ip &&
                        existing.port === next.port && 
                        existing.url === next.url && 
                        existing.status === next.status;

                    let devices = state.devices;
                    if (!existing) {
                        devices = [...devices, next];
                    } else if (!equal) {
                        devices = devices.map((d, i) => (i === existingIndex ? next : d));
                    }

                    let selectedDevice = state.selectedDevice;
                    if (selectedDevice?.hardware_id === next.hardware_id) {
                        const selEqual = selectedDevice.name === next.name && 
                            selectedDevice.ip === next.ip &&
                            selectedDevice.port === next.port && 
                            selectedDevice.url === next.url && 
                            selectedDevice.status === next.status;
                        if (!selEqual) {
                            selectedDevice = next;
                        }
                    }
                    return { devices, selectedDevice };
                });
            },
            
            markDeviceDisconnected: (hardwareId) => {
                set((state) => ({
                    devices: state.devices.map((d) => 
                        d.hardware_id === hardwareId ? { ...d, status: 'disconnected' as ConnectionStatus } : d
                    ),
                    selectedDevice: state.selectedDevice?.hardware_id === hardwareId
                        ? { ...state.selectedDevice, status: 'disconnected' as ConnectionStatus }
                        : state.selectedDevice,
                }));
            },
            
            addDiscoveredDevices: (discovered) => {
                const state = get();
                const existingDevices = state.devices;
                const discoveredIds = new Set(discovered.map(d => d.hardware_id));

                // Build a map of all devices by hardware_id
                const deviceMap = new Map<string, RokuDevice>(
                    existingDevices.map(d => [d.hardware_id, d])
                );
                
                // Update or add discovered devices
                discovered.forEach(device => {
                    const existing = deviceMap.get(device.hardware_id);
                    if (existing) {
                        deviceMap.set(device.hardware_id, {
                            ...existing,
                            ...device,
                            status: 'connected' as ConnectionStatus,
                        });
                    } else {
                        deviceMap.set(device.hardware_id, {
                            ...device,
                            status: 'connected' as ConnectionStatus,
                        });
                    }
                });

                const updatedDevices = Array.from(deviceMap.values());

                // Update selected device if it was discovered (IP might have changed)
                let selectedDevice = state.selectedDevice;
                if (selectedDevice && discoveredIds.has(selectedDevice.hardware_id)) {
                    selectedDevice = deviceMap.get(selectedDevice.hardware_id) || selectedDevice;
                }

                set({ devices: updatedDevices, selectedDevice });
            },
            
            toggleFavoriteApp: (hardwareId, appId) => {
                set((state) => {
                    const currentFavorites = state.favoriteApps[hardwareId] || [];
                    const newFavorites = currentFavorites.includes(appId)
                        ? currentFavorites.filter((id) => id !== appId)
                        : [...currentFavorites, appId];
                    
                    return {
                        favoriteApps: {
                            ...state.favoriteApps,
                            [hardwareId]: newFavorites,
                        },
                    };
                });
            },
            
            setPreferLastUsed: (v) => set({ preferLastUsed: v }),
            setShowAllDevices: (v) => set({ showAllDevices: v }),
        }),
        {
            name: 'roku-remote-storage',
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({ 
                devices: state.devices, 
                favoriteApps: state.favoriteApps,
                selectedDevice: state.selectedDevice,
                preferLastUsed: state.preferLastUsed,
                showAllDevices: state.showAllDevices,
            }),
        }
    )
);