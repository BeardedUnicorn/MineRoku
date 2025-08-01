import React, { useState, useEffect } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import Sidebar from './components/Sidebar';
import RemoteControl from './components/RemoteControl';
import AppLauncher from './components/AppLauncher';
import { Box, Typography, Paper, CircularProgress, AppBar, Toolbar, IconButton, useTheme, useMediaQuery } from '@mui/material';
import { motion, AnimatePresence } from 'framer-motion';
import { Tv as TvIcon, SearchOff as SearchOffIcon, Menu as MenuIcon } from '@mui/icons-material';
import BottomNavBar from './components/BottomNavBar';
import './App.css';
import { useAppStore } from './store';

const App: React.FC = () => {
    const { selectedDevice } = useAppStore();
    const [isSearching, setIsSearching] = useState(true);
    const [devicesFound, setDevicesFound] = useState(true);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [mobileView, setMobileView] = useState<'remote' | 'apps'>('remote');
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

    useEffect(() => {
        // Keep sidebar closed by default on mobile, open on desktop
        setIsSidebarOpen(!isMobile);
    }, [isMobile]);

    useEffect(() => {
        const unlistenPromise = listen('popup-ready', () => {
            emit('device-changed', selectedDevice);
        });

        // Always emit the latest device info. This handles initial load for the popup
        // and any subsequent changes to the selected device.
        emit('device-changed', selectedDevice);

        return () => {
            unlistenPromise.then(unlisten => unlisten());
        };
    }, [selectedDevice]);

    const handleToggleSidebar = () => {
        setIsSidebarOpen(!isSidebarOpen);
    };

    const contentVariants = prefersReducedMotion
        ? {
            hidden: { opacity: 1, y: 0 },
            visible: { opacity: 1, y: 0 },
            exit: { opacity: 1, y: 0 },
        }
        : {
            hidden: { opacity: 0, y: 20 },
            visible: { opacity: 1, y: 0, transition: { duration: 0.4 } },
            exit: { opacity: 0, y: -20, transition: { duration: 0.3 } },
        };

    const MainContentComponent: React.FC = () => {
        if (isSearching) {
            return (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 2 }}>
                    <CircularProgress />
                    <Typography variant="h6" color="text.secondary">
                        Searching for Roku devices...
                    </Typography>
                </Box>
            );
        }

        if (!devicesFound) {
            return (
                <Paper sx={{ p: 4, textAlign: 'center', backgroundColor: 'background.paper', borderRadius: 4, maxWidth: 450, mx: 'auto' }}>
                    <SearchOffIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                    <Typography variant="h6" color="text.secondary">No Roku Devices Found</Typography>
                    <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
                       Please ensure your Roku is powered on, connected to the same network, and refresh the list from the sidebar.
                    </Typography>
                </Paper>
            );
        }

        if (selectedDevice) {
            return (
                <motion.div
                    key={selectedDevice.ip}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    variants={contentVariants}
                    style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}
                >
                    {isMobile ? (
                        // On mobile, the content is one of two views.
                        <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 1 }}>
                            {mobileView === 'remote' && <RemoteControl device={selectedDevice} />}
                            {mobileView === 'apps' && <AppLauncher device={selectedDevice} />}
                        </Box>
                    ) : (
                        // On desktop, we show both side-by-side.
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

        return (
            <Paper sx={{ p: 4, textAlign: 'center', backgroundColor: 'background.paper', borderRadius: 4, maxWidth: 450, mx: 'auto' }}>
                <TvIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                <Typography variant="h6" color="text.secondary">
                    Select a device to begin
                </Typography>
            </Paper>
        );
    };

    return (
        <Box className="app-container">
            <Box component="nav" sx={{ flexShrink: 0 }} aria-label="device navigation">
                <Sidebar
                    isOpen={isSidebarOpen}
                    onToggle={handleToggleSidebar}
                    setIsSearching={setIsSearching}
                    setDevicesFound={setDevicesFound}
                />
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, height: '100vh', overflow: 'hidden' }}>
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
                            {selectedDevice ? selectedDevice.name : "Roku Controller"}
                        </Typography>
                    </Toolbar>
                </AppBar>

                <Box component="main" className={`main-content ${isMobile && selectedDevice ? 'main-content-mobile' : ''}`}>
                    <AnimatePresence mode="wait">
                        <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', flexGrow: 1, width: '100%' }}>
                            <MainContentComponent />
                        </Box>
                    </AnimatePresence>
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