import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import Sidebar from './components/Sidebar';
import RemoteControl from './components/RemoteControl';
import AppLauncher from './components/AppLauncher';
import { Box, Typography, Paper, CircularProgress, AppBar, Toolbar, IconButton, useTheme, useMediaQuery, Button } from '@mui/material';
import { motion } from 'framer-motion';
import { Tv as TvIcon, SearchOff as SearchOffIcon, Menu as MenuIcon, Refresh as RefreshIcon } from '@mui/icons-material';
import BottomNavBar from './components/BottomNavBar';
import './App.css';
import { useAppStore, RokuDevice } from './store';
import { shallow } from 'zustand/shallow';

// Type for device events from backend (without status)
interface RokuDeviceEvent {
    name: string;
    ip: string;
    port: number;
    url: string;
    hardware_id: string;
}

const App: React.FC = () => {
    const {
        selectedDevice,
        devices,
        preferLastUsed,
        addDiscoveredDevices,
        setSelectedDevice,
        upsertDevice,
        markDeviceDisconnected,
    } = useAppStore(
        (s) => ({
            selectedDevice: s.selectedDevice,
            devices: s.devices,
            preferLastUsed: s.preferLastUsed,
            addDiscoveredDevices: s.addDiscoveredDevices,
            setSelectedDevice: s.setSelectedDevice,
            upsertDevice: s.upsertDevice,
            markDeviceDisconnected: s.markDeviceDisconnected,
        }),
        shallow
    );
    const [isSearching, setIsSearching] = useState(true);
    const [devicesFound, setDevicesFound] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [mobileView, setMobileView] = useState<'remote' | 'apps'>('remote');
    const [isScanning, setIsScanning] = useState(false);
    const [scanStatus, setScanStatus] = useState<string>('');
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

    useEffect(() => {
        setIsSidebarOpen(!isMobile);
    }, [isMobile]);

    useEffect(() => {
        const unlistenPromise = listen('popup-ready', () => {
            emit('device-changed', selectedDevice);
        });

        emit('device-changed', selectedDevice);

        return () => {
            unlistenPromise.then(unlisten => unlisten());
        };
    }, [selectedDevice]);

    const handleToggleSidebar = useCallback(() => {
        setIsSidebarOpen((v) => !v);
    }, []);

    const scanForDevices = useCallback(async () => {
        setIsScanning(true);
        setIsSearching(true);
        setScanStatus('Scanning network...');
        try {
            const foundDevices: RokuDeviceEvent[] = await invoke('discover_roku_devices');
            const devicesWithStatus: RokuDevice[] = foundDevices.map(d => ({
                ...d,
                status: 'connected' as const,
            }));
            addDiscoveredDevices(devicesWithStatus);
            
            // Mark devices not found in this scan as disconnected
            const discoveredIds = new Set(foundDevices.map((d) => d.hardware_id));
            useAppStore.getState().devices.forEach((device) => {
                if (!discoveredIds.has(device.hardware_id)) {
                    markDeviceDisconnected(device.hardware_id);
                }
            });
            
            const anyDevicesFound = foundDevices.length > 0;
            setDevicesFound(anyDevicesFound);
            setScanStatus(anyDevicesFound ? `Found ${foundDevices.length} device(s)` : 'No devices found');
            
            // Auto-select first device if nothing selected
            if (!useAppStore.getState().selectedDevice && anyDevicesFound) {
                const next: RokuDevice = { ...foundDevices[0], status: 'connected' };
                setSelectedDevice(next);
            }
        } catch (err) {
            console.error("Discovery error:", err);
            setScanStatus(`Error: ${err}`);
        } finally {
            setIsScanning(false);
            setIsSearching(false);
        }
    }, [addDiscoveredDevices, setSelectedDevice, markDeviceDisconnected]);

    useEffect(() => {
        // Bootstrap from cached devices
        (async () => {
            try {
                const cached: RokuDeviceEvent[] = await invoke('get_cached_devices');
                if (cached && cached.length) {
                    cached.forEach((d) => upsertDevice({ ...d, status: 'disconnected' }));
                    if (preferLastUsed && !useAppStore.getState().selectedDevice) {
                        setSelectedDevice({ ...cached[0], status: 'disconnected' });
                    }
                }
            } catch (e) {
                console.warn('Failed to load cached devices', e);
            }
        })();

        // Initial scan
        scanForDevices();

        // Listen for background discovery events
        let unsubs: Array<() => void> = [];
        const init = async () => {
            const u1 = await listen('discovery_cycle_start', () => {
                setIsScanning(true);
                setIsSearching(true);
            });
            const u2 = await listen<RokuDeviceEvent[]>('discovery_cycle_end', () => {
                setIsScanning(false);
                setIsSearching(false);
            });
            const u3 = await listen<RokuDeviceEvent>('device_discovered', (event) => {
                const dev = event.payload;
                upsertDevice({ ...dev, status: 'connected' });
                setDevicesFound(true);
                
                const state = useAppStore.getState();
                if (!state.selectedDevice) {
                    if (!state.preferLastUsed) {
                        setSelectedDevice({ ...dev, status: 'connected' });
                    }
                } else if (!state.preferLastUsed && state.selectedDevice.status === 'disconnected') {
                    if (state.selectedDevice.hardware_id !== dev.hardware_id) {
                        setSelectedDevice({ ...dev, status: 'connected' });
                    }
                }
            });
            const u4 = await listen<RokuDeviceEvent>('device_lost', (event) => {
                const device = event.payload;
                markDeviceDisconnected(device.hardware_id);
            });
            unsubs = [u1, u2, u3, u4];
        };
        init();
        return () => {
            unsubs.forEach((u) => u && u());
        };
    }, [scanForDevices, upsertDevice, markDeviceDisconnected, setSelectedDevice, preferLastUsed]);

    const contentVariants = useMemo(() => prefersReducedMotion
        ? {
            hidden: { opacity: 1, y: 0 },
            visible: { opacity: 1, y: 0 },
            exit: { opacity: 1, y: 0 },
        }
        : {
            hidden: { opacity: 0, y: 20 },
            visible: { opacity: 1, y: 0, transition: { duration: 0.4 } },
            exit: { opacity: 0, y: -20, transition: { duration: 0.3 } },
        }, [prefersReducedMotion]);

    const mainContent = useMemo(() => {
        if (selectedDevice) {
            return (
                <motion.div
                    key={selectedDevice.hardware_id}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    variants={contentVariants}
                    style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}
                >
                    {isMobile ? (
                        <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 1 }}>
                            {mobileView === 'remote' && <RemoteControl device={selectedDevice} />}
                            {mobileView === 'apps' && <AppLauncher device={selectedDevice} />}
                        </Box>
                    ) : (
                        <Box sx={{ display: 'flex', flexDirection: 'row', gap: 4, flex: 1, overflow: 'hidden' }}>
                            <Box sx={{ width: 320, flexShrink: 0, mx: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
                                <RemoteControl device={selectedDevice} />
                            </Box>
                            <Box sx={{ flexGrow: 1, minWidth: 0, overflowY: 'auto', pr: 2 }}>
                               <AppLauncher device={selectedDevice} />
                            </Box>
                        </Box>
                    )}
                </motion.div>
            );
        }
        const hasAnyDevices = devices.length > 0 || devicesFound;
        if (isSearching && !hasAnyDevices) {
            return (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 2 }}>
                    <CircularProgress />
                    <Typography variant="h6" color="text.secondary">
                        Searching for Roku devices...
                    </Typography>
                    {scanStatus && (
                        <Typography variant="body2" color="text.secondary">
                            {scanStatus}
                        </Typography>
                    )}
                </Box>
            );
        }
        if (!hasAnyDevices) {
            return (
                <Paper sx={{ p: 4, textAlign: 'center', backgroundColor: 'background.paper', borderRadius: 4, maxWidth: 450, mx: 'auto' }}>
                    <SearchOffIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                    <Typography variant="h6" color="text.secondary">No Roku Devices Found</Typography>
                    <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
                       Please ensure your Roku is powered on and connected to the same WiFi network. Tap refresh to scan again.
                    </Typography>
                    {scanStatus && (
                        <Typography variant="body2" color="error" sx={{ mt: 1 }}>
                            {scanStatus}
                        </Typography>
                    )}
                    <Button
                        variant="contained"
                        startIcon={isScanning ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />}
                        sx={{ mt: 2 }}
                        onClick={scanForDevices}
                        disabled={isScanning}
                    >
                        {isScanning ? 'Scanning...' : 'Refresh'}
                    </Button>
                </Paper>
            );
        }
        return (
            <Paper sx={{ p: 4, textAlign: 'center', backgroundColor: 'background.paper', borderRadius: 4, maxWidth: 450, mx: 'auto' }}>
                <TvIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                <Typography variant="h6" color="text.secondary">
                    Select a device to begin
                </Typography>
            </Paper>
        );
    }, [selectedDevice, isMobile, mobileView, contentVariants, devices.length, devicesFound, isSearching, scanForDevices, isScanning, scanStatus]);

    return (
        <Box className="app-container">
            <Box component="nav" sx={{ flexShrink: 0 }} aria-label="device navigation">
                <Sidebar
                    isOpen={isSidebarOpen}
                    onToggle={handleToggleSidebar}
                    scanForDevices={scanForDevices}
                    isScanning={isScanning}
                />
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, height: '100dvh', overflow: 'hidden' }}>
                <AppBar position="static" color="transparent" elevation={0} sx={{
                    borderBottom: `1px solid ${theme.palette.divider}`,
                    display: 'flex',
                    alignItems: 'center',
                    flexDirection: 'row',
                    flexShrink: 0
                }}>
                    <Toolbar>
                        <IconButton
                            edge="start"
                            color="inherit"
                            aria-label="menu"
                            onClick={handleToggleSidebar}
                            sx={{ mr: 2 }}
                        >
                            <MenuIcon />
                        </IconButton>
                        <Typography variant="h6" component="div" sx={{ flexGrow: 1, color: 'primary.main', fontWeight: 'bold' }}>
                            {selectedDevice ? selectedDevice.name : "Roku Remote"}
                        </Typography>
                    </Toolbar>
                </AppBar>

                <Box component="main" className={`main-content ${isMobile && selectedDevice ? 'main-content-mobile' : ''}`}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', flexGrow: 1, width: '100%' }}>
                        {mainContent}
                    </Box>
                </Box>

                {isMobile && selectedDevice && (
                    <Box component="nav" aria-label="bottom navigation">
                        <BottomNavBar view={mobileView} setView={setMobileView} />
                    </Box>
                )}
            </Box>
        </Box>
    );
};

export default App;