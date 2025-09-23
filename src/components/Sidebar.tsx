import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useAppStore, RokuDevice } from '../store';
import { shallow } from 'zustand/shallow';
import {
    Drawer, List, ListItemButton, ListItemText,
    Typography, Box, IconButton, Divider, CircularProgress, Tooltip, useTheme, useMediaQuery,
    Dialog, DialogTitle, DialogContent, FormControlLabel, Switch
} from '@mui/material';
import {
    Refresh as RefreshIcon,
    Settings as SettingsIcon,
    Info as InfoIcon,
    Add as AddIcon
} from '@mui/icons-material';

interface SidebarProps {
    isOpen: boolean;
    onToggle: () => void;
    scanForDevices: () => Promise<void>;
    isScanning: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onToggle, scanForDevices, isScanning }) => {
    const { devices, selectedDevice } = useAppStore(
        (s) => ({ devices: s.devices, selectedDevice: s.selectedDevice }),
        shallow
    );
    const setSelectedDevice = useAppStore((s) => s.setSelectedDevice);
    const preferLastUsed = useAppStore((s) => s.preferLastUsed);
    const setPreferLastUsed = useAppStore((s) => s.setPreferLastUsed);
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const [settingsOpen, setSettingsOpen] = React.useState(false);

    const handleDeviceSelect = (device: RokuDevice) => {
        setSelectedDevice(device);
        if (isMobile) {
            onToggle(); // Close sidebar on selection in mobile view
        }
    };

    const openPopupWindow = () => {
        invoke('open_popup_window');
    };

    const drawerWidth = 280;

    return (
        <>
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
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 1 }}>
                    <Typography variant="h6" sx={{ color: 'text.primary' }}>Roku Devices</Typography>
                    {isScanning && <CircularProgress size={16} />}
                </Box>
            </Box>
            <Divider />
            <Box sx={{ flexGrow: 1, overflowY: 'auto' }}>
                <List>
                    {devices.map((device: RokuDevice) => (
                        <ListItemButton
                            key={device.ip}
                            selected={selectedDevice?.ip === device.ip}
                            onClick={() => handleDeviceSelect(device)}
                        >
                            <ListItemText primary={device.name} secondary={device.ip} />
                            <Box
                                aria-label={device.status === 'connected' ? 'Device online' : 'Device offline'}
                                sx={{
                                    width: 10,
                                    height: 10,
                                    borderRadius: '50%',
                                    bgcolor: device.status === 'connected' ? 'success.main' : 'text.disabled',
                                }}
                            />
                        </ListItemButton>
                    ))}
                    {!devices.length && (
                        <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                            {isScanning ? 'Scanning for devices…' : 'No devices discovered yet.'}
                        </Typography>
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
                <Tooltip title="Open Remote in New Window">
                    <IconButton
                        aria-label="Open Remote in New Window"
                        onClick={openPopupWindow}
                    >
                        <AddIcon />
                    </IconButton>
                </Tooltip>
                <Tooltip title="Settings">
                    <IconButton
                        aria-label="Settings"
                        onClick={() => setSettingsOpen(true)}
                    >
                        <SettingsIcon />
                    </IconButton>
                </Tooltip>
                <Tooltip title="About">
                    <IconButton
                        aria-label="About"
                        onClick={() => openUrl('https://github.com/mherold1/roku-controller')}
                    >
                        <InfoIcon />
                    </IconButton>
                </Tooltip>
            </Box>
        </Drawer>
        <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)}>
            <DialogTitle>Settings</DialogTitle>
            <DialogContent>
                <FormControlLabel
                    control={<Switch checked={preferLastUsed} onChange={(e) => setPreferLastUsed(e.target.checked)} />}
                    label="Prefer last-used device on startup"
                />
            </DialogContent>
        </Dialog>
        </>
    );
};

export default React.memo(Sidebar);
