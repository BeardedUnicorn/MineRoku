// src/App.tsx
import React, { useState } from 'react';
import DeviceTabs from './components/DeviceTabs';
import RemoteControl from './components/RemoteControl';
import AppLauncher from './components/AppLauncher';
import { Box, Typography, Paper, Tabs, Tab } from '@mui/material';
import './App.css';

interface RokuDevice {
    name: string;
    ip: string;
    port: number;
    url: string;
}

interface TabPanelProps {
    children?: React.ReactNode;
    index: number;
    value: number;
}

function TabPanel(props: TabPanelProps) {
    const { children, value, index, ...other } = props;

    return (
        <div
            role="tabpanel"
            hidden={value !== index}
            id={`simple-tabpanel-${index}`}
            aria-labelledby={`simple-tab-${index}`}
            {...other}
        >
            {value === index && (
                <Box sx={{ p: 3 }}>
                    {children}
                </Box>
            )}
        </div>
    );
}

function a11yProps(index: number) {
    return {
        id: `simple-tab-${index}`,
        'aria-controls': `simple-tabpanel-${index}`,
    };
}

const App: React.FC = () => {
    const [selectedDevice, setSelectedDevice] = useState<RokuDevice | null>(null);
    const [tabValue, setTabValue] = useState(0);

    const handleDeviceSelect = (device: RokuDevice) => {
        setSelectedDevice(device);
    };

    const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
        setTabValue(newValue);
    };

    return (
        <Box sx={{ 
            minHeight: '100vh', 
            backgroundColor: 'background.default',
            color: 'text.primary',
            p: 2
        }}>
            <Typography variant="h4" component="h1" sx={{ mb: 3, textAlign: 'center' }}>
                Roku Controller
            </Typography>
            
            <DeviceTabs onDeviceSelect={handleDeviceSelect} />
            
            {selectedDevice ? (
                <Paper sx={{ mt: 3, backgroundColor: 'background.paper' }}>
                    <Tabs 
                        value={tabValue} 
                        onChange={handleTabChange} 
                        aria-label="control tabs"
                        centered
                    >
                        <Tab label="Remote Control" {...a11yProps(0)} />
                        <Tab label="Apps" {...a11yProps(1)} />
                    </Tabs>
                    
                    <TabPanel value={tabValue} index={0}>
                        <RemoteControl device={selectedDevice} />
                    </TabPanel>
                    
                    <TabPanel value={tabValue} index={1}>
                        <AppLauncher device={selectedDevice} />
                    </TabPanel>
                </Paper>
            ) : (
                <Paper sx={{ mt: 3, p: 3, textAlign: 'center', backgroundColor: 'background.paper' }}>
                    <Typography variant="h6" color="text.secondary">
                        Select a Roku device to control
                    </Typography>
                </Paper>
            )}
        </Box>
    );
};

export default App;
