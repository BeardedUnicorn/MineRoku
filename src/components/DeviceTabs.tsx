import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './DeviceTabs.css';

interface RokuDevice {
    name: string;
    ip: string;
    port: number;
    url: string;
}

interface DeviceTabsProps {
    onDeviceSelect: (device: RokuDevice) => void;
}

const DeviceTabs: React.FC<DeviceTabsProps> = ({ onDeviceSelect }) => {
    const [devices, setDevices] = useState<RokuDevice[]>([]);
    const [activeTab, setActiveTab] = useState<string | null>(null);

    useEffect(() => {
        const fetchDevices = async () => {
            try {
                const discoveredDevices: RokuDevice[] = await invoke('discover_roku_devices');
                setDevices(discoveredDevices);
                if (discoveredDevices.length > 0 && !activeTab) {
                    setActiveTab(discoveredDevices[0].ip);
                    onDeviceSelect(discoveredDevices[0]);
                } else if (discoveredDevices.length > 0 && activeTab) {
                    // If activeTab is set, ensure it's still in the discovered devices
                    const currentActiveDevice = discoveredDevices.find(d => d.ip === activeTab);
                    if (!currentActiveDevice) {
                        // If the active device is no longer discovered, select the first available
                        setActiveTab(discoveredDevices[0].ip);
                        onDeviceSelect(discoveredDevices[0]);
                    }
                } else if (discoveredDevices.length === 0) {
                    // No devices found, clear active tab
                    setActiveTab(null);
                    onDeviceSelect(null as any); // Pass null or an appropriate empty state
                }
            } catch (error) {
                console.error('Error discovering devices:', error);
                // Optionally, handle error state in UI
            }
        };

        fetchDevices();
        // Refresh devices every 10 seconds
        const intervalId = setInterval(fetchDevices, 10000);

        return () => clearInterval(intervalId);
    }, [activeTab, onDeviceSelect]);

    const handleTabClick = (device: RokuDevice) => {
        setActiveTab(device.ip);
        onDeviceSelect(device);
    };

    return (
        <div className="device-tabs">
            {devices.length > 0 ? (
                devices.map((device) => (
                    <button
                        key={device.ip}
                        className={`device-tab ${activeTab === device.ip ? 'active' : ''}`}
                        onClick={() => handleTabClick(device)}
                    >
                        {device.name}
                    </button>
                ))
            ) : (
                <p>Searching for Roku devices...</p>
            )}
        </div>
    );
};

export default DeviceTabs;