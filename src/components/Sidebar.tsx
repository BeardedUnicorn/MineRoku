import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { 
    Box, 
    Typography, 
    CircularProgress, 
    List, 
    ListItem, 
    ListItemButton, 
    ListItemIcon, 
    ListItemText,
    IconButton,
    Tooltip,
    Divider,
    Badge
} from '@mui/material';
import { 
    Refresh as RefreshIcon,
    DesktopWindows as DeviceIcon,
    ChevronLeft as ChevronLeftIcon,
    ChevronRight as ChevronRightIcon
} from '@mui/icons-material';
import { motion } from 'framer-motion';
import { useAppStore, RokuDevice, ConnectionStatus } from '../store';
import logo from '../assets/logo.png';

interface SidebarProps {
    isOpen: boolean;
    onToggle: () => void;
    onDeviceSelect: (device: RokuDevice | null) => void;
    setIsSearching: (isSearching: boolean) => void;
    setDevicesFound: (found: boolean) => void;
}

const getBadgeColor = (status: ConnectionStatus) => {
    switch (status) {
        case 'connected': return 'success';
        case 'connecting': return 'warning';
        case 'disconnected': return 'error';
        default: return 'default';
    }
};

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onToggle, onDeviceSelect, setIsSearching, setDevicesFound }) => {
    const devices = useAppStore((state) => state.devices);
    const { addDiscoveredDevices, setDevices } = useAppStore((state) => state.actions);
    const [selectedIp, setSelectedIp] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const fetchDevices = useCallback(async () => {
        setLoading(true);
        setIsSearching(true);
        
        const connectingDevices = devices.map(d => ({ ...d, status: 'connecting' as ConnectionStatus }));
        setDevices(connectingDevices);

        try {
            const discoveredDevices: RokuDevice[] = await invoke('discover_roku_devices');
            addDiscoveredDevices(discoveredDevices);
            setDevicesFound(discoveredDevices.length > 0 || devices.length > 0);

            if (discoveredDevices.length > 0 && !selectedIp) {
                const newDevice = discoveredDevices[0];
                setSelectedIp(newDevice.ip);
                onDeviceSelect(newDevice);
            }
        } catch (error) {
            console.error('Error discovering devices:', error);
            const disconnectedDevices = devices.map(d => ({ ...d, status: 'disconnected' as ConnectionStatus }));
            setDevices(disconnectedDevices);
            setDevicesFound(false);
        } finally {
            setLoading(false);
            setIsSearching(false);
        }
    }, [addDiscoveredDevices, setDevices, setIsSearching, setDevicesFound, onDeviceSelect, selectedIp, devices]);

    useEffect(() => {
        const timer = setTimeout(() => {
            fetchDevices();
        }, 1000);
        return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleDeviceClick = (device: RokuDevice) => {
        if (device.status !== 'disconnected') {
            setSelectedIp(device.ip);
            onDeviceSelect(device);
        }
    };

    return (
        <Box
            component={motion.div}
            animate={{ width: isOpen ? 280 : 80 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            sx={{
                flexShrink: 0,
                bgcolor: 'background.paper',
                height: '100vh',
                display: 'flex',
                flexDirection: 'column',
                borderRight: '1px solid',
                borderColor: 'divider',
                overflow: 'hidden'
            }}
        >
            {/* Centered Logo and Header Section */}
            <Box sx={{ flexShrink: 0, pt: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1 }}>
                    <Box
                        component="img"
                        src={logo}
                        alt="App Logo"
                        sx={{ height: 40, width: 'auto' }}
                    />
                </Box>
                <motion.div
                    animate={{ opacity: isOpen ? 1 : 0, height: isOpen ? 'auto' : 0 }}
                    transition={{ duration: 0.2 }}
                    style={{ overflow: 'hidden' }}
                >
                    <Box sx={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'space-between', 
                        px: 2, 
                        pb: 1 
                    }}>
                        <Typography variant="h6" component="h2" noWrap>
                            Roku Devices
                        </Typography>
                        <Tooltip title="Refresh Devices">
                            <span>
                                <IconButton onClick={fetchDevices} disabled={loading}>
                                    {loading ? <CircularProgress size={24} /> : <RefreshIcon />}
                                </IconButton>
                            </span>
                        </Tooltip>
                    </Box>
                </motion.div>
            </Box>

            <Divider />
            
            {/* Device List */}
            <List sx={{ overflowY: 'auto', flexGrow: 1, overflowX: 'hidden' }}>
                {devices.map((device) => (
                    <ListItem key={device.ip} disablePadding>
                        <ListItemButton
                            selected={selectedIp === device.ip}
                            onClick={() => handleDeviceClick(device)}
                            disabled={device.status === 'disconnected'}
                            sx={{ justifyContent: isOpen ? 'initial' : 'center', px: 3 }}
                        >
                            <Tooltip title={!isOpen ? `${device.name} (${device.status})` : ''} placement="right">
                                <ListItemIcon sx={{ minWidth: 0, justifyContent: 'center' }}>
                                    <Badge
                                        variant="dot"
                                        color={getBadgeColor(device.status)}
                                        overlap="circular"
                                        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                                    >
                                        <DeviceIcon />
                                    </Badge>
                                </ListItemIcon>
                            </Tooltip>
                            {isOpen && <ListItemText primary={device.name} secondary={device.ip} sx={{ pl: 2 }} />}
                        </ListItemButton>
                    </ListItem>
                ))}
            </List>
            
            <Divider />
            
            {/* Sidebar Toggle Button */}
            <Box
                sx={{
                    py: 1,
                    display: 'flex',
                    justifyContent: isOpen ? 'flex-end' : 'center',
                }}
            >
                <Tooltip title={isOpen ? "Collapse Sidebar" : "Expand Sidebar"} placement="right">
                    <IconButton onClick={onToggle}>
                        {isOpen ? <ChevronLeftIcon /> : <ChevronRightIcon />}
                    </IconButton>
                </Tooltip>
            </Box>
        </Box>
    );
};

export default Sidebar;