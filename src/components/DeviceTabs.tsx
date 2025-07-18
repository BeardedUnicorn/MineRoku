import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Box, Button, Typography, CircularProgress, Chip } from '@mui/material';
import { Refresh as RefreshIcon } from '@mui/icons-material';

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
    const [isSearching, setIsSearching] = useState(false);

    const fetchDevices = async () => {
        setIsSearching(true);
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
                onDeviceSelect(null as any);
            }
        } catch (error) {
            console.error('Error discovering devices:', error);
        } finally {
            setIsSearching(false);
        }
    };

    useEffect(() => {
        fetchDevices();
        // Refresh devices every 15 seconds
        const intervalId = setInterval(fetchDevices, 15000);
        return () => clearInterval(intervalId);
    }, []);

    const handleTabClick = (device: RokuDevice) => {
        setActiveTab(device.ip);
        onDeviceSelect(device);
    };

    const handleRefresh = () => {
        fetchDevices();
    };

    return (
        <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <Typography variant="h6">
                    Roku Devices
                </Typography>
                <Button
                    variant="outlined"
                    size="small"
                    onClick={handleRefresh}
                    disabled={isSearching}
                    startIcon={isSearching ? <CircularProgress size={16} /> : <RefreshIcon />}
                >
                    {isSearching ? 'Searching...' : 'Refresh'}
                </Button>
            </Box>

            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
                {devices.length > 0 ? (
                    devices.map((device) => (
                        <Chip
                            key={device.ip}
                            label={device.name}
                            onClick={() => handleTabClick(device)}
                            color={activeTab === device.ip ? 'primary' : 'default'}
                            variant={activeTab === device.ip ? 'filled' : 'outlined'}
                            sx={{ 
                                cursor: 'pointer',
                                fontSize: '0.875rem',
                                '&:hover': {
                                    backgroundColor: activeTab === device.ip ? 'primary.dark' : 'action.hover'
                                }
                            }}
                        />
                    ))
                ) : isSearching ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <CircularProgress size={20} />
                        <Typography variant="body2" color="text.secondary">
                            Searching for Roku devices...
                        </Typography>
                    </Box>
                ) : (
                    <Typography variant="body2" color="text.secondary">
                        No Roku devices found. Click refresh to search again.
                    </Typography>
                )}
            </Box>
        </Box>
    );
};

export default DeviceTabs;
