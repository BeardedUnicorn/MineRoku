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
    TextField,
    InputAdornment,
    Pagination,
    Tooltip,
    IconButton,
    Divider
} from '@mui/material';
import {
    Refresh as RefreshIcon,
    Launch as LaunchIcon,
    Search as SearchIcon,
    Star as StarIcon,
    StarBorder as StarBorderIcon,
} from '@mui/icons-material';
import { useAppStore, RokuDevice } from '../store';

// Updated interface: `app_type` has been removed to match the backend struct.
interface RokuApp {
    id: string;
    name: string;
    version: string;
}

interface AppLauncherProps {
    device: RokuDevice;
}

// Cache to store loaded app icons and avoid refetching
const iconCache = new Map<string, string>();

const AppIcon: React.FC<{ device: RokuDevice; appId: string; appName: string; size?: number }> = ({ device, appId, appName, size = 120 }) => {
    const [icon, setIcon] = useState<string | null>(iconCache.get(appId) ?? null);

    useEffect(() => {
        if (iconCache.has(appId)) {
            setIcon(iconCache.get(appId) as string);
            return;
        }

        const fetchIcon = async () => {
            try {
                const iconData: string = await invoke('get_app_icon', { ip: device.ip, port: device.port, app_id: appId });
                iconCache.set(appId, iconData);
                setIcon(iconData);
            } catch (error) {
                console.error(`Error fetching icon for ${appName}:`, error);
            }
        };

        fetchIcon();
    }, [device, appId, appName]);

    const sxProps = {
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...(size !== 120 ? { width: size } : { p: 1, backgroundColor: 'action.hover' }),
    } as const;

    return (
        <CardMedia sx={sxProps}>
            {icon ? (
                <img
                    src={icon}
                    alt={appName}
                    style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }}
                    loading="lazy"
                />
            ) : (
                <CircularProgress size={24} />
            )}
        </CardMedia>
    );
};

const AppLauncher: React.FC<AppLauncherProps> = ({ device }) => {
    const [apps, setApps] = useState<RokuApp[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isLaunching, setIsLaunching] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<{ message: string; severity: 'success' | 'error' } | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 4; // Increased items per page for a better grid view

    const { favoriteApps, toggleFavoriteApp } = useAppStore((state) => ({
        favoriteApps: state.favoriteApps[device.ip] || [],
        toggleFavoriteApp: state.toggleFavoriteApp,
    }));

    const fetchApps = async () => {
        setIsLoading(true);
        setCurrentPage(1);
        try {
            const rokuApps: RokuApp[] = await invoke('list_roku_apps', {
                ip: device.ip,
                port: device.port,
            });
            // Sort apps alphabetically by name
            setApps(rokuApps.sort((a, b) => a.name.localeCompare(b.name)));
        } catch (error) {
            console.error('Error fetching apps:', error);
            const errorMessage = typeof error === 'string' ? error : 'An unknown error occurred.';
            setFeedback({ message: `Error fetching apps: ${errorMessage}`, severity: 'error' });
        } finally {
            setIsLoading(false);
        }
    };

    const launchApp = async (appId: string, appName: string) => {
        setIsLaunching(appId);
        try {
            await invoke('launch_roku_app', {
                ip: device.ip,
                port: device.port,
                app_id: appId,
            });
            setFeedback({ message: `Launched "${appName}"`, severity: 'success' });
        } catch (error) {
            console.error(`Error launching app:`, error);
            const errorMessage = typeof error === 'string' ? error : 'An unknown error occurred.';
            setFeedback({ message: `Error launching "${appName}": ${errorMessage}`, severity: 'error' });
        } finally {
            setIsLaunching(null);
        }
    };
    
    // Reset page number when search term changes
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm]);

    useEffect(() => {
        if (device) {
            fetchApps();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [device]);

    // Filtering is now based only on the search term
    const filteredApps = apps.filter(app =>
        app.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const pageCount = Math.ceil(filteredApps.length / ITEMS_PER_PAGE);
    const paginatedApps = filteredApps.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);
    const handlePageChange = (_event: React.ChangeEvent<unknown>, value: number) => {
        setCurrentPage(value);
    };

    const favoriteAppDetails = favoriteApps
        .map(favId => apps.find(app => app.id === favId))
        .filter((app): app is RokuApp => !!app); // Type guard to filter out undefined

    return (
        <Box>
            {favoriteAppDetails.length > 0 && (
                <>
                    <Typography variant="h6" sx={{ mb: 2 }}>Favorite Apps</Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 4 }}>
                        {favoriteAppDetails.map((app) => (
                            <Box key={`fav-${app.id}`}>
                                <Tooltip title={`Launch ${app.name}`}>
                                    <Card 
                                        onClick={() => launchApp(app.id, app.name)}
                                        sx={{ 
                                            p: 1, 
                                            cursor: 'pointer', 
                                            transition: 'transform 0.2s, box-shadow 0.2s',
                                            '&:hover': {
                                                transform: 'scale(1.05)',
                                                boxShadow: 3
                                            }
                                        }}
                                    >
                                        <AppIcon device={device} appId={app.id} appName={app.name} size={64} />
                                    </Card>
                                </Tooltip>
                            </Box>
                        ))}
                    </Box>
                    <Divider sx={{ mb: 4 }} />
                </>
            )}

            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 2 }}>
                <Typography variant="h6">All Applications ({filteredApps.length})</Typography>
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                    <TextField
                        label="Search Apps"
                        variant="outlined"
                        size="small"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        sx={{ minWidth: '250px' }}
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <SearchIcon />
                                </InputAdornment>
                            ),
                        }}
                    />
                    <Button variant="outlined" size="medium" onClick={fetchApps} disabled={isLoading} startIcon={<RefreshIcon />}>
                        Refresh
                    </Button>
                </Box>
            </Box>

            {isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
            ) : filteredApps.length > 0 ? (
                <>
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 2 }}>
                        {paginatedApps.map((app) => (
                             <Card key={app.id} sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                                <AppIcon device={device} appId={app.id} appName={app.name} />
                                <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                                    <Tooltip title={app.name}>
                                        <Typography variant="h6" sx={{ fontSize: '1rem', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {app.name}
                                        </Typography>
                                    </Tooltip>
                                    <Typography variant="caption" color="text.secondary">ID: {app.id}</Typography>
                                    <Box sx={{ mt: 'auto', pt: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Button
                                            fullWidth
                                            variant="contained"
                                            onClick={() => launchApp(app.id, app.name)}
                                            disabled={isLaunching === app.id}
                                            startIcon={isLaunching === app.id ? <CircularProgress color="inherit" size={16} /> : <LaunchIcon />}
                                        >
                                            {isLaunching === app.id ? 'Launching...' : 'Launch'}
                                        </Button>
                                        <Tooltip title={favoriteApps.includes(app.id) ? "Remove from favorites" : "Add to favorites"}>
                                            <IconButton onClick={() => toggleFavoriteApp(device.ip, app.id)}>
                                                {favoriteApps.includes(app.id) ? <StarIcon color="primary" /> : <StarBorderIcon />}
                                            </IconButton>
                                        </Tooltip>
                                    </Box>
                                </CardContent>
                            </Card>
                        ))}
                    </Box>
                    {pageCount > 1 && (
                        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4, mb: 2 }}>
                            <Pagination
                                count={pageCount}
                                page={currentPage}
                                onChange={handlePageChange}
                                color="primary"
                            />
                        </Box>
                    )}
                </>
            ) : (
                <Box sx={{ textAlign: 'center', p: 4, mt: 4, border: '1px dashed', borderColor: 'divider', borderRadius: 2 }}>
                    <SearchIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                    <Typography variant="h6" color="text.secondary">No matching apps found</Typography>
                    <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
                        Try clearing your search or refreshing the list.
                    </Typography>
                </Box>
            )}

            <Snackbar 
                open={!!feedback} 
                autoHideDuration={4000} 
                onClose={() => setFeedback(null)} 
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert 
                    onClose={() => setFeedback(null)} 
                    severity={feedback?.severity} 
                    sx={{ width: '100%' }}
                    variant="filled"
                >
                    {feedback?.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default AppLauncher;
