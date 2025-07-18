import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { 
    Box, 
    Typography, 
    Card,
    CardContent,
    CardMedia,
    CircularProgress,
    Button,
    Snackbar,
    Alert,
    Chip,
    GridLegacy as Grid
} from '@mui/material';
import {
    Refresh as RefreshIcon,
    Launch as LaunchIcon,
    Apps as AppsIcon,
} from '@mui/icons-material';

interface RokuDevice {
    name: string;
    ip: string;
    port: number;
    url: string;
}

interface RokuApp {
    id: string;
    name: string;
    app_type: string;
    version: string;
    icon_url?: string;
}

interface AppLauncherProps {
    device: RokuDevice;
}

const AppLauncher: React.FC<AppLauncherProps> = ({ device }) => {
    const [apps, setApps] = useState<RokuApp[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isLaunching, setIsLaunching] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<{ message: string; severity: 'success' | 'error' } | null>(null);

    const fetchApps = async () => {
        setIsLoading(true);
        try {
            const rokuApps: RokuApp[] = await invoke('list_roku_apps', {
                ip: device.ip,
                port: device.port,
            });
            setApps(rokuApps);
            setFeedback({ message: `Found ${rokuApps.length} apps`, severity: 'success' });
        } catch (error) {
            console.error('Error fetching apps:', error);
            setFeedback({ message: `Error fetching apps: ${error}`, severity: 'error' });
        } finally {
            setIsLoading(false);
        }
    };

    const launchApp = async (appId: string, appName: string) => {
        setIsLaunching(appId);
        try {
            const response = await invoke('launch_roku_app', {
                ip: device.ip,
                port: device.port,
                appId: appId,
            });
            console.log(`App launched: ${appName}, Response: ${response}`);
            setFeedback({ message: `Launched "${appName}" successfully`, severity: 'success' });
        } catch (error) {
            console.error(`Error launching app:`, error);
            setFeedback({ message: `Error launching "${appName}": ${error}`, severity: 'error' });
        } finally {
            setIsLaunching(null);
        }
    };

    const handleCloseFeedback = () => {
        setFeedback(null);
    };

    useEffect(() => {
        fetchApps();
    }, [device]);

    const getAppTypeColor = (type: string) => {
        switch (type.toLowerCase()) {
            case 'appl':
                return 'primary';
            case 'menu':
                return 'secondary';
            default:
                return 'default';
        }
    };

    return (
        <Box sx={{ p: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
                <Typography variant="h6">
                    Apps on {device.name}
                </Typography>
                <Button
                    variant="outlined"
                    size="small"
                    onClick={fetchApps}
                    disabled={isLoading}
                    startIcon={isLoading ? <CircularProgress size={16} /> : <RefreshIcon />}
                >
                    {isLoading ? 'Loading...' : 'Refresh'}
                </Button>
            </Box>

            {isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 200 }}>
                    <CircularProgress />
                </Box>
            ) : apps.length > 0 ? (
                <Grid container spacing={2}>
                    {apps.map((app) => (
                        <Grid xs={12} sm={6} md={4} key={app.id}>
                            <Card 
                                sx={{ 
                                    height: '100%',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    backgroundColor: 'background.paper',
                                    transition: 'transform 0.2s',
                                    '&:hover': {
                                        transform: 'translateY(-2px)',
                                        boxShadow: 3,
                                    }
                                }}
                            >
                                <CardMedia
                                    sx={{ 
                                        height: 80,
                                        backgroundColor: 'action.hover',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}
                                >
                                    {app.icon_url ? (
                                        <img
                                            src={app.icon_url}
                                            alt={app.name}
                                            style={{
                                                maxWidth: '100%',
                                                maxHeight: '100%',
                                                objectFit: 'contain'
                                            }}
                                            onError={(e) => {
                                                // Fallback to icon if image fails to load
                                                e.currentTarget.style.display = 'none';
                                                e.currentTarget.parentElement!.innerHTML = '<svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12.5v-9l6 4.5-6 4.5z"/></svg>';
                                            }}
                                        />
                                    ) : (
                                        <AppsIcon sx={{ fontSize: 40, color: 'text.secondary' }} />
                                    )}
                                </CardMedia>
                                
                                <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                                    <Typography variant="h6" component="h3" sx={{ 
                                        fontSize: '1rem', 
                                        fontWeight: 'bold', 
                                        mb: 1,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap'
                                    }}>
                                        {app.name}
                                    </Typography>
                                    
                                    <Box sx={{ mb: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                        <Chip 
                                            label={app.app_type}
                                            size="small"
                                            color={getAppTypeColor(app.app_type)}
                                            variant="outlined"
                                        />
                                        {app.version && (
                                            <Chip 
                                                label={`v${app.version}`}
                                                size="small"
                                                variant="outlined"
                                            />
                                        )}
                                    </Box>
                                    
                                    <Box sx={{ mt: 'auto', pt: 2 }}>
                                        <Button
                                            fullWidth
                                            variant="contained"
                                            color="primary"
                                            onClick={() => launchApp(app.id, app.name)}
                                            disabled={isLaunching === app.id}
                                            startIcon={
                                                isLaunching === app.id ? 
                                                    <CircularProgress size={16} /> : 
                                                    <LaunchIcon />
                                            }
                                        >
                                            {isLaunching === app.id ? 'Launching...' : 'Launch'}
                                        </Button>
                                    </Box>
                                </CardContent>
                            </Card>
                        </Grid>
                    ))}
                </Grid>
            ) : (
                <Box sx={{ textAlign: 'center', mt: 4 }}>
                    <AppsIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                    <Typography variant="h6" color="text.secondary">
                        No apps found
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        Make sure your Roku device is properly connected and try refreshing.
                    </Typography>
                </Box>
            )}

            {/* Feedback Snackbar */}
            <Snackbar
                open={!!feedback}
                autoHideDuration={4000}
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

export default AppLauncher;
