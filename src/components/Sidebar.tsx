import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore, RokuDevice } from '../store';
import {
    Drawer, List, ListItemButton, ListItemText,
    Typography, Box, IconButton, Divider, CircularProgress, Tooltip, useTheme, useMediaQuery
} from '@mui/material';
import {
    Refresh as RefreshIcon,
    Settings as SettingsIcon,
    Info as InfoIcon
} from '@mui/icons-material';

interface SidebarProps {
    isOpen: boolean;
    onToggle: () => void;
    setIsSearching: (isSearching: boolean) => void;
    setDevicesFound: (devicesFound: boolean) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onToggle, setIsSearching, setDevicesFound }) => {
    const { devices, selectedDevice, setDevices, setSelectedDevice } = useAppStore();
    const [isScanning, setIsScanning] = useState(false);
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    const handleDeviceSelect = (device: RokuDevice) => {
        setSelectedDevice(device);
        if (isMobile) {
            onToggle(); // Close sidebar on selection in mobile view
        }
    };

    const scanForDevices = useCallback(async () => {
        setIsScanning(true);
        setIsSearching(true);
        try {
            const foundDevices: RokuDevice[] = await invoke('discover_roku_devices');
            setDevices(foundDevices);
            const anyDevicesFound = foundDevices.length > 0;
            setDevicesFound(anyDevicesFound);
            if (anyDevicesFound) {
                const previouslySelected = selectedDevice;
                const stillExists =
                    previouslySelected &&
                    foundDevices.find((d) => d.ip === previouslySelected.ip);
                if (stillExists) {
                    setSelectedDevice(stillExists);
                } else {
                    setSelectedDevice(foundDevices[0]);
                }
            } else {
                // If no devices are found, clear the selection
                setSelectedDevice(null);
            }
        } catch (err) {
            console.error("Discovery error:", err);
            setDevicesFound(false);
            setSelectedDevice(null);
        } finally {
            setIsScanning(false);
            setIsSearching(false);
        }
    }, [setDevices, setSelectedDevice, selectedDevice, setIsSearching, setDevicesFound]);

    useEffect(() => {
        scanForDevices();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Run only once on initial mount

    const drawerWidth = 280;

    return (
        <Drawer
            variant={isMobile ? 'temporary' : 'permanent'}
            open={isOpen}
            onClose={onToggle}
            ModalProps={{ keepMounted: true }} // Better for mobile performance
            sx={{
                width: drawerWidth,
                flexShrink: 0,
                [`& .MuiDrawer-paper`]: {
                    width: drawerWidth,
                    boxSizing: 'border-box',
                    backgroundColor: 'background.paper',
                    borderRight: { xs: 'none', md: `1px solid ${theme.palette.divider}` },
                },
            }}
        >
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                p: 1,
                backgroundColor: 'background.default',
                height: '64px' // Match AppBar height
            }}>
                <Typography variant="h6" sx={{ ml: 1, color: 'text.primary' }}>Roku Devices</Typography>
            </Box>
            <Divider />
            <Box sx={{ flexGrow: 1, overflowY: 'auto' }}>
                <List>
                    {isScanning ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}><CircularProgress /></Box>
                    ) : (
                        devices.map((device: RokuDevice) => (
                            <ListItemButton
                                key={device.ip}
                                selected={selectedDevice?.ip === device.ip}
                                onClick={() => handleDeviceSelect(device)}
                            >
                                <ListItemText primary={device.name} secondary={device.ip} />
                            </ListItemButton>
                        ))
                    )}
                </List>
            </Box>
            <Divider />
            <Box sx={{ p: 1, display: 'flex', justifyContent: 'space-around' }}>
                <Tooltip title="Refresh Device List">
                    <span>
                        <IconButton
                            aria-label="Refresh Device List"
                            onClick={scanForDevices}
                            disabled={isScanning}
                        >
                            <RefreshIcon />
                        </IconButton>
                    </span>
                </Tooltip>
                <Tooltip title="Settings">
                    <span>
                        <IconButton
                            aria-label="Settings"
                            onClick={() => { /* Add settings logic */ }}
                            disabled
                        >
                            <SettingsIcon />
                        </IconButton>
                    </span>
                </Tooltip>
                <Tooltip title="About">
                    <IconButton
                        aria-label="About"
                        onClick={() =>
                            invoke('open_url', { url: 'https://github.com/mherold1/roku-controller' })
                        }
                    >
                        <InfoIcon />
                    </IconButton>
                </Tooltip>
            </Box>
        </Drawer>
    );
};

export default Sidebar;