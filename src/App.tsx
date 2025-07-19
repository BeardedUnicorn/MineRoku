// src/App.tsx (Corrected)
import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import RemoteControl from './components/RemoteControl';
import AppLauncher from './components/AppLauncher';
import { Box, Typography, Paper, CircularProgress } from '@mui/material';
import { motion, AnimatePresence } from 'framer-motion';
import { Tv as TvIcon, SearchOff as SearchOffIcon } from '@mui/icons-material';
import './App.css';
import { RokuDevice } from './store';

const App: React.FC = () => {
    const [selectedDevice, setSelectedDevice] = useState<RokuDevice | null>(null);
    const [isSearching, setIsSearching] = useState(true);
    const [devicesFound, setDevicesFound] = useState(true);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false); 

    const handleDeviceSelect = (device: RokuDevice | null) => {
        setSelectedDevice(device);
    };

    const contentVariants = {
        hidden: { opacity: 0, y: 20 },
        visible: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -20 },
    };

    const MainContent = () => {
        if (isSearching) {
            return (
                <Paper sx={{ p: 4, textAlign: 'center', backgroundColor: 'transparent', boxShadow: 'none' }}>
                    <CircularProgress sx={{ mb: 2 }} />
                    <Typography variant="h6" color="text.secondary">
                        Searching for Roku devices...
                    </Typography>
                </Paper>
            );
        }

        if (!devicesFound) {
             return (
                <Paper sx={{ p: 4, textAlign: 'center', backgroundColor: 'background.paper' }}>
                    <SearchOffIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                    <Typography variant="h6" color="text.secondary">No Roku Devices Found</Typography>
                    <Typography variant="body1" color="text.secondary" sx={{ mt: 1, maxWidth: 400, mx: 'auto' }}>
                       Please ensure your Roku is powered on and on the same network. You can refresh the list from the sidebar.
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
                    transition={{ duration: 0.3 }}
                    style={{ width: '100%' }}
                >
                    <Typography variant="h4" component="h1" sx={{ mb: 3, textAlign: 'center', color: 'primary.main', fontWeight: 'bold' }}>
                        {selectedDevice.name}
                    </Typography>
                    
                    {/* Corrected Flexbox Layout */}
                    <Box sx={{ display: 'flex', alignItems: 'flex-start' }}>
                        {/* Column 1: Fixed-width container for the remote */}
                        <Box sx={{ width: 320, flexShrink: 0, marginRight: 5 }}>
                            <RemoteControl device={selectedDevice} />
                        </Box>
                        
                        {/* Column 2: Fluid container for AppLauncher with margin-left to prevent overlap */}
                        <Box sx={{ flexGrow: 1, minWidth: 0, ml: 4 }}>
                           <AppLauncher device={selectedDevice} />
                        </Box>
                    </Box>
                </motion.div>
            );
        }

        return (
            <Paper sx={{ p: 4, textAlign: 'center', backgroundColor: 'background.paper' }}>
                <TvIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                <Typography variant="h6" color="text.secondary">
                    Select a device from the sidebar to begin
                </Typography>
            </Paper>
        );
    };

    return (
        <Box className="app-container">
            <Sidebar 
                isOpen={isSidebarOpen}
                onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
                onDeviceSelect={handleDeviceSelect}
                setIsSearching={setIsSearching}
                setDevicesFound={setDevicesFound}
            />
            <main className="main-content">
                <AnimatePresence mode="wait">
                    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', minHeight: '100%', width: '100%' }}>
                        {MainContent()}
                    </Box>
                </AnimatePresence>
            </main>
        </Box>
    );
};

export default App;