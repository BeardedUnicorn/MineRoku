import React, { useMemo } from 'react';
import { Box, ButtonBase, Tooltip, Typography } from '@mui/material';
import { useAppStore, type RokuDevice } from '../store';
import type { RokuApp } from '../services/rokuClient';
import { useDeviceApps } from '../hooks/useDeviceApps';
import { useLaunchApp } from '../hooks/useLaunchApp';
import { radius } from '../tokens';
import AppIcon from './AppIcon';

// Stable reference: zustand re-renders whenever a selector returns a new value.
const NO_FAVORITES: string[] = [];

interface FavoritesRowProps {
  device: RokuDevice;
  /** Wrap onto more lines instead of scrolling sideways. */
  wrap?: boolean;
}

/**
 * The device's starred apps as one-tap launchers. Renders nothing until there is a favorite
 * the device still has installed.
 */
const FavoritesRow: React.FC<FavoritesRowProps> = ({ device, wrap = false }) => {
  const favoriteIds = useAppStore((state) => state.favoriteApps[device.hardware_id] ?? NO_FAVORITES);
  const { apps } = useDeviceApps(device);
  const { launch, launchingId } = useLaunchApp(device);

  const favorites = useMemo(() => {
    if (favoriteIds.length === 0 || apps.length === 0) {
      return [] as RokuApp[];
    }
    const appById = new Map(apps.map((app) => [app.id, app]));
    return favoriteIds.map((id) => appById.get(id)).filter((app): app is RokuApp => Boolean(app));
  }, [favoriteIds, apps]);

  if (favorites.length === 0) {
    return null;
  }

  return (
    <Box component="section" aria-label="Favorites">
      <Typography variant="subtitle2" component="h2" color="textSecondary" sx={{ mb: 1 }}>
        Favorites
      </Typography>
      <Box
        sx={{
          display: 'flex',
          gap: 1.25,
          ...(wrap
            ? { flexWrap: 'wrap' }
            : {
                overflowX: 'auto',
                // Room for the focus ring, which the scroll container would clip.
                p: '4px',
                m: '-4px',
                scrollbarWidth: 'none',
                '&::-webkit-scrollbar': { display: 'none' },
              }),
        }}
      >
        {favorites.map((app) => (
          <Tooltip key={app.id} title={app.name}>
            <ButtonBase
              aria-label={`Launch ${app.name}`}
              disabled={launchingId === app.id}
              onClick={() => void launch(app)}
              sx={{
                width: 96,
                flexShrink: 0,
                borderRadius: radius.md,
                overflow: 'hidden',
                touchAction: 'manipulation',
                transition: 'opacity 120ms',
                '&:hover': { opacity: 0.88 },
              }}
            >
              <AppIcon device={device} appId={app.id} appName={app.name} busy={launchingId === app.id} />
            </ButtonBase>
          </Tooltip>
        ))}
      </Box>
    </Box>
  );
};

export default React.memo(FavoritesRow);
