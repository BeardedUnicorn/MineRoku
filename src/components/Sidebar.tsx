import React from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { remoteStylePresets, type RemoteStylePreset, useAppStore, RokuDevice } from '../store';
import { iconCache } from '../iconCache';
import { useShallow } from 'zustand/react/shallow';
import {
    Drawer, List, ListItemButton, ListItemText,
    Typography, Box, IconButton, Divider, CircularProgress, Tooltip, useTheme, useMediaQuery,
    Dialog, DialogTitle, DialogContent, DialogActions, FormControlLabel, Switch, Stack, Button,
    FormControl, InputLabel, Select, MenuItem
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import SettingsIcon from '@mui/icons-material/Settings';
import InfoIcon from '@mui/icons-material/Info';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import { usePlatform } from '../hooks/usePlatform';
import { clearAllData, restartApp } from '../services/rokuClient';
import { remoteStyleLabels } from './remoteStyleTokens';

interface SidebarProps {
    isOpen: boolean;
    onToggle: () => void;
    scanForDevices: () => Promise<void>;
    isScanning: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onToggle, scanForDevices, isScanning }) => {
    const { devices, selectedDevice } = useAppStore(
        useShallow((s) => ({ devices: s.devices, selectedDevice: s.selectedDevice }))
    );
    const setSelectedDevice = useAppStore((s) => s.setSelectedDevice);
    const preferLastUsed = useAppStore((s) => s.preferLastUsed);
    const setPreferLastUsed = useAppStore((s) => s.setPreferLastUsed);
    const showAllDevices = useAppStore((s) => s.showAllDevices);
    const setShowAllDevices = useAppStore((s) => s.setShowAllDevices);
    const remoteStyle = useAppStore((s) => s.remoteStyle);
    const setRemoteStyle = useAppStore((s) => s.setRemoteStyle);
    const resetState = useAppStore((s) => s.resetState);
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const [settingsOpen, setSettingsOpen] = React.useState(false);
    const [confirmDeleteOpen, setConfirmDeleteOpen] = React.useState(false);
    const [isDeleting, setIsDeleting] = React.useState(false);
    const currentPlatform = usePlatform();
    const visibleDevices = React.useMemo(() => {
        if (showAllDevices) {
            return devices;
        }

        const connectedDevices = devices.filter((device) => device.status === 'connected');
        if (
            selectedDevice &&
            !connectedDevices.some((device) => device.hardware_id === selectedDevice.hardware_id)
        ) {
            return [selectedDevice, ...connectedDevices];
        }

        return connectedDevices;
    }, [devices, selectedDevice, showAllDevices]);

    const handleDeviceSelect = (device: RokuDevice) => {
        setSelectedDevice(device);
        if (isMobile) {
            onToggle();
        }
    };

    const handleDeleteAllData = async () => {
        setIsDeleting(true);
        try {
            // Clear backend database
            await clearAllData();
        } catch (error) {
            console.error('Failed to delete data:', error);
        }
        
        // Clear frontend localStorage
        localStorage.removeItem('roku-remote-storage');
        
        // Clear any other localStorage items that might exist
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('roku')) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));

        iconCache.clear();
        useAppStore.persist.clearStorage();
        resetState();
        setConfirmDeleteOpen(false);
        setSettingsOpen(false);

        if (currentPlatform === 'android' || currentPlatform === 'ios') {
            setIsDeleting(false);
            return;
        }

        try {
            // Restart the app (desktop)
            await restartApp();
        } catch (error) {
            console.error('Failed to restart app:', error);
            setIsDeleting(false);
        }
    };

    const drawerWidth = 280;

    return (
        <>
        <Drawer
            variant={isMobile ? 'temporary' : 'permanent'}
            open={isOpen}
            onClose={onToggle}
            ModalProps={{ keepMounted: true }}
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
                height: '64px'
            }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 1 }}>
                    <Typography variant="h6" sx={{ color: 'text.primary' }}>Roku Devices</Typography>
                    {isScanning && <CircularProgress size={16} />}
                </Box>
            </Box>
            <Divider />
            <Box sx={{ flexGrow: 1, overflowY: 'auto' }}>
                <List>
                    {visibleDevices.map((device: RokuDevice) => (
                        <ListItemButton
                            key={device.hardware_id}
                            selected={selectedDevice?.hardware_id === device.hardware_id}
                            onClick={() => handleDeviceSelect(device)}
                        >
                            <ListItemText 
                                primary={device.name} 
                                secondary={device.ip}
                                slotProps={{
                                    secondary: {
                                        sx: {
                                            fontSize: '0.75rem',
                                            opacity: device.status === 'connected' ? 1 : 0.6
                                        }
                                    }
                                }}
                            />
                            <Tooltip title={device.status === 'connected' ? 'Online' : 'Offline'}>
                                <Box
                                    aria-label={device.status === 'connected' ? 'Device online' : 'Device offline'}
                                    sx={{
                                        width: 10,
                                        height: 10,
                                        borderRadius: '50%',
                                        bgcolor: device.status === 'connected' ? 'success.main' : 'text.disabled',
                                    }}
                                />
                            </Tooltip>
                        </ListItemButton>
                    ))}
                    {!visibleDevices.length && (
                        <Typography variant="body2" color="textSecondary" sx={{ p: 2 }} role="status" aria-live="polite">
                            {isScanning
                                ? 'Scanning for devices…'
                                : showAllDevices
                                    ? 'No devices discovered yet.'
                                    : 'No connected devices. Enable "Show all discovered devices" in Settings to view offline devices.'}
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

        {/* Settings Dialog */}
        <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} maxWidth="xs" fullWidth>
            <DialogTitle>Settings</DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    <FormControlLabel
                        control={
                            <Switch 
                                checked={preferLastUsed} 
                                onChange={(e) => setPreferLastUsed(e.target.checked)} 
                            />
                        }
                        label="Prefer last-used device on startup"
                    />
                    <FormControlLabel
                        control={
                            <Switch 
                                checked={showAllDevices} 
                                onChange={(e) => setShowAllDevices(e.target.checked)} 
                            />
                        }
                        label="Show all discovered devices"
                    />
                    <Typography variant="caption" color="textSecondary">
                        When disabled, only connected devices are shown. Your selected device stays visible even if it goes offline.
                    </Typography>
                    <FormControl fullWidth size="small">
                        <InputLabel id="remote-style-label">Remote style</InputLabel>
                        <Select
                            labelId="remote-style-label"
                            id="remote-style"
                            label="Remote style"
                            value={remoteStyle}
                            onChange={(e) => setRemoteStyle(e.target.value as RemoteStylePreset)}
                        >
                            {remoteStylePresets.map((style) => (
                                <MenuItem key={style} value={style}>
                                    {remoteStyleLabels[style]}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <Typography variant="caption" color="textSecondary">
                        Applies to the remote on mobile and desktop.
                    </Typography>
                    
                    <Divider sx={{ my: 2 }} />
                    
                    <Typography variant="subtitle2" color="textSecondary">
                        Data Management
                    </Typography>
                    <Button
                        variant="outlined"
                        color="error"
                        startIcon={<DeleteForeverIcon />}
                        onClick={() => setConfirmDeleteOpen(true)}
                        fullWidth
                    >
                        Delete All Data
                    </Button>
                    <Typography variant="caption" color="textSecondary">
                        This will remove all saved devices, favorites, cached icons, and settings. The app will restart afterward.
                    </Typography>
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={() => setSettingsOpen(false)}>Close</Button>
            </DialogActions>
        </Dialog>

        {/* Confirm Delete Dialog */}
        <Dialog 
            open={confirmDeleteOpen} 
            onClose={() => !isDeleting && setConfirmDeleteOpen(false)}
            maxWidth="xs"
            fullWidth
        >
            <DialogTitle sx={{ color: 'error.main' }}>
                Delete All Data?
            </DialogTitle>
            <DialogContent>
                <Typography variant="body1" sx={{ mb: 2 }}>
                    This action cannot be undone. The following will be permanently deleted:
                </Typography>
                <Box component="ul" sx={{ pl: 2, m: 0 }}>
                    <li><Typography variant="body2">All saved Roku devices</Typography></li>
                    <li><Typography variant="body2">Favorite apps</Typography></li>
                    <li><Typography variant="body2">Cached app icons</Typography></li>
                    <li><Typography variant="body2">All settings and preferences</Typography></li>
                </Box>
                <Typography variant="body2" sx={{ mt: 2, fontWeight: 500 }}>
                    The app will restart after deletion.
                </Typography>
            </DialogContent>
            <DialogActions>
                <Button 
                    onClick={() => setConfirmDeleteOpen(false)} 
                    disabled={isDeleting}
                >
                    Cancel
                </Button>
                <Button 
                    onClick={handleDeleteAllData} 
                    color="error" 
                    variant="contained"
                    disabled={isDeleting}
                    startIcon={isDeleting ? <CircularProgress size={16} color="inherit" /> : <DeleteForeverIcon />}
                >
                    {isDeleting ? 'Deleting…' : 'Delete All & Restart'}
                </Button>
            </DialogActions>
        </Dialog>
        </>
    );
};

export default React.memo(Sidebar);
