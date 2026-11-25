import React, { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { Box, CircularProgress, IconButton, InputAdornment, TextField, Tooltip, Typography } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import SearchOffIcon from '@mui/icons-material/SearchOff';
import WifiOffIcon from '@mui/icons-material/WifiOff';
import { useAppStore, type RokuDevice } from '../store';
import type { RokuApp } from '../services/rokuClient';
import { useDeviceApps } from '../hooks/useDeviceApps';
import { useLaunchApp } from '../hooks/useLaunchApp';
import AppTile from './AppTile';
import EmptyState from './EmptyState';
import FavoritesRow from './FavoritesRow';

interface AppLauncherProps {
  device: RokuDevice;
}

// Stable reference: zustand re-renders whenever a selector returns a new value.
const NO_FAVORITES: string[] = [];

/**
 * Every app on the device in one grid that scrolls with its pane, under a search field that
 * stays in view. Favorites sit on top as one-tap launchers.
 */
const AppLauncher: React.FC<AppLauncherProps> = ({ device }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const deferredSearchTerm = useDeferredValue(searchTerm.trim().toLowerCase());
  const { apps, isLoading, refresh } = useDeviceApps(device, { reportErrors: true });
  const { launch, launchingId } = useLaunchApp(device);
  const isConnected = !device.status || device.status === 'connected';

  const favoriteApps = useAppStore((state) => state.favoriteApps[device.hardware_id] ?? NO_FAVORITES);
  const toggleFavoriteApp = useAppStore((state) => state.toggleFavoriteApp);
  const favoriteAppIds = useMemo(() => new Set(favoriteApps), [favoriteApps]);

  const filteredApps = useMemo(() => {
    if (!deferredSearchTerm) {
      return apps;
    }
    return apps.filter((app) => app.name.toLowerCase().includes(deferredSearchTerm));
  }, [apps, deferredSearchTerm]);

  const handleLaunch = useCallback((app: RokuApp) => void launch(app), [launch]);
  const handleToggleFavorite = useCallback(
    (appId: string) => toggleFavoriteApp(device.hardware_id, appId),
    [toggleFavoriteApp, device.hardware_id]
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pb: 1 }}>
      <Box
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          pt: { xs: 1.5, md: 3 },
          pb: 1,
          mb: -1.5,
          backgroundColor: 'background.default',
        }}
      >
        <TextField
          label="Search Apps"
          variant="outlined"
          size="small"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          sx={{ flexGrow: 1, maxWidth: { md: 360 } }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        <Tooltip title="Refresh apps">
          <span>
            <IconButton
              aria-label="Refresh apps"
              onClick={refresh}
              disabled={isLoading || !isConnected}
              sx={{ width: 48, height: 48, color: 'text.secondary' }}
            >
              {isLoading && apps.length > 0 ? <CircularProgress size={20} color="inherit" /> : <RefreshIcon />}
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {!deferredSearchTerm && <FavoritesRow device={device} wrap />}

      <Box component="section" aria-labelledby="all-apps-heading">
        <Typography id="all-apps-heading" variant="subtitle2" component="h2" color="textSecondary" sx={{ mb: 1 }}>
          All apps ({filteredApps.length})
        </Typography>

        {isLoading && apps.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }} role="status" aria-label="Loading apps">
            <CircularProgress />
          </Box>
        ) : filteredApps.length > 0 ? (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: 'repeat(auto-fill, minmax(104px, 1fr))',
                md: 'repeat(auto-fill, minmax(136px, 1fr))',
              },
              gap: 1.5,
            }}
          >
            {filteredApps.map((app) => (
              <AppTile
                key={app.id}
                device={device}
                app={app}
                isFavorite={favoriteAppIds.has(app.id)}
                isLaunching={launchingId === app.id}
                onLaunch={handleLaunch}
                onToggleFavorite={handleToggleFavorite}
              />
            ))}
          </Box>
        ) : apps.length === 0 && !isConnected ? (
          <EmptyState
            icon={<WifiOffIcon />}
            title="Device offline"
            description="Apps will load when the device is reachable again."
          />
        ) : (
          <EmptyState
            icon={<SearchOffIcon />}
            title="No matching apps found"
            description="Try clearing your search or refreshing the list."
          />
        )}
      </Box>
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
