import React, { useState, useEffect, useRef, useCallback, useDeferredValue, useMemo } from 'react';
import {
    Box,
    Typography,
    Card,
    CardActionArea,
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
import RefreshIcon from '@mui/icons-material/Refresh';
import LaunchIcon from '@mui/icons-material/Launch';
import SearchIcon from '@mui/icons-material/Search';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import { useAppStore, RokuDevice } from '../store';
import { iconCache, ICON_CACHE_TTL_MS, ICON_CACHE_LIMIT } from '../iconCache';
import {
    getAppIcon,
    getCachedApps,
    launchRokuApp,
    listRokuApps,
    type RokuApp,
} from '../services/rokuClient';

interface AppLauncherProps {
    device: RokuDevice;
}

// Card dimension constants for calculation
const CARD_MIN_WIDTH = 150;
const CARD_ESTIMATED_HEIGHT = 260; // CardMedia (120px) + CardContent (~140px)
const GRID_GAP = 16; // MUI spacing of 2
const MIN_ITEMS_PER_PAGE = 6;
const MAX_ITEMS_PER_PAGE = 60;

const AppIcon: React.FC<{ device: RokuDevice; appId: string; appName: string; size?: number }> = ({ device, appId, appName, size = 120 }) => {
    const cacheKey = `${device.ip}:${device.port}:${appId}`;
    const [icon, setIcon] = useState<string | null>(() => {
        const cached = iconCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < ICON_CACHE_TTL_MS) {
            return cached.data;
        }
        return null;
    });

    useEffect(() => {
        const cached = iconCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < ICON_CACHE_TTL_MS) {
            setIcon(cached.data);
            return;
        } else if (cached) {
            iconCache.delete(cacheKey);
        }

        let cancelled = false;

        const fetchIcon = async () => {
            try {
                const iconData = await getAppIcon(device.ip, device.port, appId);
                if (cancelled) {
                    return;
                }
                iconCache.set(cacheKey, { data: iconData, timestamp: Date.now() });
                if (iconCache.size > ICON_CACHE_LIMIT) {
                    const oldestKey = iconCache.keys().next().value as string;
                    iconCache.delete(oldestKey);
                }
                setIcon(iconData);
            } catch (error) {
                if (!cancelled) {
                    console.error(`Error fetching icon for ${appName}:`, error);
                }
            }
        };

        void fetchIcon();

        return () => {
            cancelled = true;
        };
    }, [device.ip, device.port, appId, cacheKey]);

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
                    width={size}
                    height={size}
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
    const [itemsPerPage, setItemsPerPage] = useState(12);
    
    const containerRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);

    // Use hardware_id for favorites
    const { favoriteApps, toggleFavoriteApp } = useAppStore((state) => ({
        favoriteApps: state.favoriteApps[device.hardware_id] || [],
        toggleFavoriteApp: state.toggleFavoriteApp,
    }));

    const favoriteAppDetails = useMemo(() => {
        if (favoriteApps.length === 0 || apps.length === 0) {
            return [] as RokuApp[];
        }
        const appById = new Map(apps.map((app) => [app.id, app]));
        return favoriteApps
            .map((favId) => appById.get(favId))
            .filter((app): app is RokuApp => Boolean(app));
    }, [favoriteApps, apps]);

    const favoriteAppIds = useMemo(() => new Set(favoriteApps), [favoriteApps]);
    const deferredSearchTerm = useDeferredValue(searchTerm.trim().toLowerCase());

    // Calculate responsive items per page based on container size
    const calculateItemsPerPage = useCallback(() => {
        const container = containerRef.current;
        const grid = gridRef.current;
        
        let availableWidth: number;
        let availableHeight: number;
        
        if (grid && container) {
            // Use the grid container's width for column calculation
            availableWidth = grid.clientWidth;
            
            // Calculate available height from the container
            // Subtract space for: favorites section, header, search, pagination
            const containerHeight = container.clientHeight;
            const favoritesHeight = favoriteAppDetails.length > 0 ? 180 : 0;
            const headerHeight = 80; // "All Applications" header + search
            const paginationHeight = 80;
            const margins = 48;
            
            availableHeight = Math.max(
                CARD_ESTIMATED_HEIGHT,
                containerHeight - favoritesHeight - headerHeight - paginationHeight - margins
            );
        } else {
            // Fallback: estimate based on window dimensions
            const sidebarWidth = 280;
            const padding = 64;
            availableWidth = Math.max(300, window.innerWidth - sidebarWidth - padding);
            availableHeight = Math.max(CARD_ESTIMATED_HEIGHT, window.innerHeight - 350);
        }
        
        // Calculate columns that fit
        const columns = Math.max(2, Math.floor((availableWidth + GRID_GAP) / (CARD_MIN_WIDTH + GRID_GAP)));
        
        // Calculate rows that fit
        const rows = Math.max(2, Math.floor((availableHeight + GRID_GAP) / (CARD_ESTIMATED_HEIGHT + GRID_GAP)));
        
        // Calculate items per page with min/max bounds
        const calculated = Math.min(MAX_ITEMS_PER_PAGE, Math.max(MIN_ITEMS_PER_PAGE, columns * rows));
        
        return calculated;
    }, [favoriteAppDetails.length]);

    // Set up resize observer for responsive pagination
    useEffect(() => {
        const updateItemsPerPage = () => {
            const newItemsPerPage = calculateItemsPerPage();
            setItemsPerPage(prev => {
                if (prev !== newItemsPerPage) {
                    return newItemsPerPage;
                }
                return prev;
            });
        };

        // Initial calculation with a small delay to allow layout
        const initialTimeout = setTimeout(updateItemsPerPage, 50);

        // Debounced resize handler
        let resizeTimeout: ReturnType<typeof setTimeout>;
        const debouncedUpdate = () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(updateItemsPerPage, 100);
        };

        // Window resize listener
        window.addEventListener('resize', debouncedUpdate);

        // ResizeObserver for container changes
        const resizeObserver = new ResizeObserver(debouncedUpdate);
        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }
        if (gridRef.current) {
            resizeObserver.observe(gridRef.current);
        }

        return () => {
            clearTimeout(initialTimeout);
            clearTimeout(resizeTimeout);
            window.removeEventListener('resize', debouncedUpdate);
            resizeObserver.disconnect();
        };
    }, [calculateItemsPerPage]);

    // Recalculate when favorites change (affects available height)
    useEffect(() => {
        const newItemsPerPage = calculateItemsPerPage();
        setItemsPerPage(newItemsPerPage);
    }, [favoriteAppDetails.length, calculateItemsPerPage]);

    const fetchApps = useCallback(async (retryCount = 0) => {
        setIsLoading(true);
        setCurrentPage(1);
        try {
            if (device.status && device.status !== 'connected') {
                return;
            }

            const rokuApps = await listRokuApps(device.ip, device.port);
            if (rokuApps.length === 0 && retryCount === 0) {
                console.log('No apps found, retrying in 2 seconds...');
                window.setTimeout(() => {
                    void fetchApps(1);
                }, 2000);
                return;
            }

            setApps([...rokuApps].sort((a, b) => a.name.localeCompare(b.name)));
        } catch (error) {
            console.error('Error fetching apps:', error);
            const errorMessage = typeof error === 'string' ? error : 'An unknown error occurred.';

            if (errorMessage.includes('parse') && retryCount === 0) {
                console.log('Parse error encountered, retrying in 2 seconds...');
                window.setTimeout(() => {
                    void fetchApps(1);
                }, 2000);
                return;
            }

            setFeedback({ message: `Error fetching apps: ${errorMessage}`, severity: 'error' });
        } finally {
            setIsLoading(false);
        }
    }, [device.ip, device.port, device.status]);

    const launchApp = async (appId: string, appName: string) => {
        if (device.status && device.status !== 'connected') {
            setFeedback({ message: 'Device appears offline', severity: 'error' });
            return;
        }
        setIsLaunching(appId);
        try {
            await launchRokuApp(device.ip, device.port, appId);
            setFeedback({ message: `Launched "${appName}"`, severity: 'success' });
        } catch (error) {
            console.error(`Error launching app:`, error);
            const errorMessage = typeof error === 'string' ? error : 'An unknown error occurred.';
            setFeedback({ message: `Error launching "${appName}": ${errorMessage}`, severity: 'error' });
        } finally {
            setIsLaunching(null);
        }
    };
    
    // Reset to page 1 when search term changes
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm]);

    const filteredApps = useMemo(() => {
        if (!deferredSearchTerm) {
            return apps;
        }
        return apps.filter((app) => app.name.toLowerCase().includes(deferredSearchTerm));
    }, [apps, deferredSearchTerm]);

    const pageCount = Math.max(1, Math.ceil(filteredApps.length / itemsPerPage));

    // Reset to a valid page when data shape changes
    useEffect(() => {
        if (currentPage > pageCount) {
            setCurrentPage(pageCount);
        }
    }, [itemsPerPage, currentPage, pageCount]);

    useEffect(() => {
        let cancelled = false;
        let liveSettled = false;

        const livePromise =
            !device.status || device.status === 'connected'
                ? fetchApps().finally(() => {
                      liveSettled = true;
                  })
                : null;

        const loadCached = async () => {
            try {
                const cached = await getCachedApps(device.ip);
                if (cancelled || liveSettled) {
                    return;
                }
                if (cached.length > 0) {
                    setApps([...cached].sort((a, b) => a.name.localeCompare(b.name)));
                } else {
                    setApps([]);
                }
            } catch {
                // Non-fatal; fall back to live fetch.
            }
        };

        void loadCached();
        void livePromise;

        return () => {
            cancelled = true;
        };
    }, [device.ip, device.status, fetchApps]);

    const paginatedApps = useMemo(
        () => filteredApps.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage),
        [filteredApps, currentPage, itemsPerPage]
    );
    
    const handlePageChange = (_event: React.ChangeEvent<unknown>, value: number) => {
        setCurrentPage(value);
    };

    const handleRefreshClick = () => {
        void fetchApps();
    };

    return (
        <Box 
            ref={containerRef} 
            sx={{ 
                height: '100%', 
                display: 'flex', 
                flexDirection: 'column',
                minHeight: 0, // Important for flex children to shrink properly
            }}
        >
            {favoriteAppDetails.length > 0 && (
                <Box sx={{ flexShrink: 0 }}>
                    <Typography variant="h6" sx={{ mb: 2 }}>Favorite Apps</Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 4 }}>
                        {favoriteAppDetails.map((app) => (
                            <Box key={`fav-${app.id}`}>
                                <Tooltip title={`Launch ${app.name}`}>
                                    <Card
                                        sx={{
                                            transition: 'transform 0.2s, box-shadow 0.2s',
                                            '&:hover': {
                                                transform: 'scale(1.05)',
                                                boxShadow: 3
                                            }
                                        }}
                                    >
                                        <CardActionArea
                                            onClick={() => launchApp(app.id, app.name)}
                                            aria-label={`Launch ${app.name}`}
                                            sx={{ p: 1, borderRadius: 1, touchAction: 'manipulation' }}
                                        >
                                            <AppIcon device={device} appId={app.id} appName={app.name} size={64} />
                                        </CardActionArea>
                                    </Card>
                                </Tooltip>
                            </Box>
                        ))}
                    </Box>
                    <Divider sx={{ mb: 4 }} />
                </Box>
            )}

            <Box sx={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between', 
                mb: 3, 
                flexWrap: 'wrap', 
                gap: 2,
                flexShrink: 0,
                paddingTop: 1
            }}>
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
                    <Button variant="outlined" size="medium" onClick={handleRefreshClick} disabled={isLoading} startIcon={<RefreshIcon />}>
                        Refresh
                    </Button>
                </Box>
            </Box>

            <Box sx={{ flexGrow: 1, minHeight: 0, overflow: 'auto' }}>
                {isLoading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
                ) : filteredApps.length > 0 ? (
                    <>
                        <Box 
                            ref={gridRef}
                            sx={{ 
                                display: 'grid', 
                                gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', 
                                gap: 2 
                            }}
                        >
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
                                                {isLaunching === app.id ? 'Launching…' : 'Launch'}
                                            </Button>
                                            <Tooltip title={favoriteAppIds.has(app.id) ? "Remove from favorites" : "Add to favorites"}>
                                                <IconButton
                                                    aria-label={favoriteAppIds.has(app.id)
                                                        ? `Remove ${app.name} from Favorites`
                                                        : `Add ${app.name} to Favorites`}
                                                    onClick={() => toggleFavoriteApp(device.hardware_id, app.id)}
                                                >
                                                    {favoriteAppIds.has(app.id) ? <StarIcon color="primary" /> : <StarBorderIcon />}
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
                                    showFirstButton
                                    showLastButton
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
            </Box>

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

export default React.memo(AppLauncher, (prev, next) => (
  prev.device.hardware_id === next.device.hardware_id &&
  prev.device.ip === next.device.ip &&
  prev.device.port === next.device.port &&
  prev.device.name === next.device.name &&
  prev.device.url === next.device.url &&
  prev.device.status === next.device.status
));
