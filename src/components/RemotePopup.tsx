import React, { useState, useEffect } from 'react';
import { listen, emit } from '@tauri-apps/api/event';
import { Box, Typography, Paper } from '@mui/material';
import RemoteControl from './RemoteControl';
import { RokuDevice } from '../store';
import { TvOff as TvOffIcon } from '@mui/icons-material';

const RemotePopup: React.FC = () => {
    const [selectedDevice, setSelectedDevice] = useState<RokuDevice | null>(null);

    useEffect(() => {
        let unlisten: (() => void) | undefined;

        const setupListener = async () => {
            unlisten = await listen<RokuDevice | null>('device-changed', (event) => {
                setSelectedDevice(event.payload);
            });
        };

        setupListener();
        emit('popup-ready');

        return () => {
            if (unlisten) {
                unlisten();
            }
        };
    }, []);

    return (
        <Paper 
            sx={{ 
                height: '100vh', 
                width: '100vw',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: 'background.default'
            }}
        >
            {selectedDevice ? (
                <RemoteControl device={selectedDevice} />
            ) : (
                <Box sx={{ textAlign: 'center', color: 'text.secondary', p: 2 }}>
                    <TvOffIcon sx={{ fontSize: 64, mb: 2 }} />
                    <Typography variant="h6">No Device Selected</Typography>
                    <Typography variant="body2">
                        Please select a Roku device from the main application window.
                    </Typography>
                </Box>
            )}
        </Paper>
    );
};

export default RemotePopup;