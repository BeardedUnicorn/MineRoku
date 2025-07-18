import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { 
    Box, 
    Button, 
    Typography, 
    IconButton,
    Snackbar,
    Alert,
    GridLegacy as Grid
} from '@mui/material';
import {
    Home as HomeIcon,
    ArrowBack as BackIcon,
    Info as InfoIcon,
    PlayArrow as PlayIcon,
    FastRewind as RewindIcon,
    FastForward as ForwardIcon,
    KeyboardArrowUp as UpIcon,
    KeyboardArrowDown as DownIcon,
    KeyboardArrowLeft as LeftIcon,
    KeyboardArrowRight as RightIcon,
    RadioButtonChecked as SelectIcon,
} from '@mui/icons-material';

interface RokuDevice {
    name: string;
    ip: string;
    port: number;
    url: string;
}

interface RemoteControlProps {
    device: RokuDevice;
}

const RemoteControl: React.FC<RemoteControlProps> = ({ device }) => {
    const [feedback, setFeedback] = useState<{ message: string; severity: 'success' | 'error' } | null>(null);

    const sendCommand = async (command: string) => {
        try {
            const response = await invoke('send_roku_command', {
                ip: device.ip,
                port: device.port,
                command: command,
            });
            console.log(`Command sent: ${command}, Response: ${response}`);
            setFeedback({ message: `Command '${command}' sent successfully`, severity: 'success' });
        } catch (error) {
            console.error(`Error sending command ${command}:`, error);
            setFeedback({ message: `Error sending command '${command}': ${error}`, severity: 'error' });
        }
    };

    const handleCloseFeedback = () => {
        setFeedback(null);
    };

    const buttonStyle = {
        minWidth: 60,
        minHeight: 60,
        backgroundColor: 'background.paper',
        border: '1px solid',
        borderColor: 'primary.main',
        color: 'primary.main',
        '&:hover': {
            backgroundColor: 'primary.main',
            color: 'primary.contrastText',
        },
    };

    const navButtonStyle = {
        ...buttonStyle,
        borderRadius: '50%',
        width: 60,
        height: 60,
    };

    return (
        <Box sx={{ maxWidth: 400, mx: 'auto', p: 2 }}>
            <Typography variant="h6" sx={{ mb: 3, textAlign: 'center' }}>
                Controlling: {device.name}
            </Typography>

            {/* Navigation Section */}
            <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle1" sx={{ mb: 2, textAlign: 'center' }}>
                    Navigation
                </Typography>
                <Grid container spacing={1} justifyContent="center">
                    <Grid xs={12} sx={{ display: 'flex', justifyContent: 'center' }}>
                        <IconButton sx={navButtonStyle} onClick={() => sendCommand('up')}>
                            <UpIcon />
                        </IconButton>
                    </Grid>
                    <Grid xs={12} sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 1 }}>
                        <IconButton sx={navButtonStyle} onClick={() => sendCommand('left')}>
                            <LeftIcon />
                        </IconButton>
                        <IconButton 
                            sx={{ ...navButtonStyle, backgroundColor: 'primary.main', color: 'primary.contrastText' }} 
                            onClick={() => sendCommand('select')}
                        >
                            <SelectIcon />
                        </IconButton>
                        <IconButton sx={navButtonStyle} onClick={() => sendCommand('right')}>
                            <RightIcon />
                        </IconButton>
                    </Grid>
                    <Grid xs={12} sx={{ display: 'flex', justifyContent: 'center' }}>
                        <IconButton sx={navButtonStyle} onClick={() => sendCommand('down')}>
                            <DownIcon />
                        </IconButton>
                    </Grid>
                </Grid>
            </Box>

            {/* Control Buttons */}
            <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle1" sx={{ mb: 2, textAlign: 'center' }}>
                    Control
                </Typography>
                <Grid container spacing={2} justifyContent="center">
                    <Grid xs={4}>
                        <Button
                            fullWidth
                            variant="outlined"
                            sx={buttonStyle}
                            onClick={() => sendCommand('home')}
                            startIcon={<HomeIcon />}
                        >
                            Home
                        </Button>
                    </Grid>
                    <Grid xs={4}>
                        <Button
                            fullWidth
                            variant="outlined"
                            sx={buttonStyle}
                            onClick={() => sendCommand('back')}
                            startIcon={<BackIcon />}
                        >
                            Back
                        </Button>
                    </Grid>
                    <Grid xs={4}>
                        <Button
                            fullWidth
                            variant="outlined"
                            sx={buttonStyle}
                            onClick={() => sendCommand('info')}
                            startIcon={<InfoIcon />}
                        >
                            Info
                        </Button>
                    </Grid>
                </Grid>
            </Box>

            {/* Playback Controls */}
            <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle1" sx={{ mb: 2, textAlign: 'center' }}>
                    Playback
                </Typography>
                <Grid container spacing={2} justifyContent="center">
                    <Grid xs={4}>
                        <Button
                            fullWidth
                            variant="outlined"
                            sx={buttonStyle}
                            onClick={() => sendCommand('rev')}
                            startIcon={<RewindIcon />}
                        >
                            Rev
                        </Button>
                    </Grid>
                    <Grid xs={4}>
                        <Button
                            fullWidth
                            variant="outlined"
                            sx={buttonStyle}
                            onClick={() => sendCommand('play')}
                            startIcon={<PlayIcon />}
                        >
                            Play
                        </Button>
                    </Grid>
                    <Grid xs={4} component="div">
                        <Button
                            fullWidth
                            variant="outlined"
                            sx={buttonStyle}
                            onClick={() => sendCommand('fwd')}
                            startIcon={<ForwardIcon />}
                        >
                            Fwd
                        </Button>
                    </Grid>
                </Grid>
            </Box>

            {/* Additional Controls */}
            <Box>
                <Typography variant="subtitle1" sx={{ mb: 2, textAlign: 'center' }}>
                    Additional
                </Typography>
                <Grid container spacing={2} justifyContent="center">
                    <Grid xs={6} component="div">
                        <Button
                            fullWidth
                            variant="outlined"
                            sx={buttonStyle}
                            onClick={() => sendCommand('search')}
                        >
                            Search
                        </Button>
                    </Grid>
                    <Grid xs={6} component="div">
                        <Button
                            fullWidth
                            variant="outlined"
                            sx={buttonStyle}
                            onClick={() => sendCommand('enter')}
                        >
                            Enter
                        </Button>
                    </Grid>
                </Grid>
            </Box>

            {/* Feedback Snackbar */}
            <Snackbar
                open={!!feedback}
                autoHideDuration={3000}
                onClose={handleCloseFeedback}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert onClose={handleCloseFeedback} severity={feedback?.severity} sx={{ width: '100%' }}>
                    {feedback?.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default RemoteControl;
