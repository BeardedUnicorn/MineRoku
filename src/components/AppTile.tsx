import React from 'react';
import { Box, ButtonBase, IconButton, Tooltip, Typography } from '@mui/material';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import type { RokuApp } from '../services/rokuClient';
import { radius, tokens } from '../tokens';
import AppIcon from './AppIcon';

interface AppTileProps {
  device: { ip: string; port: number };
  app: RokuApp;
  isFavorite: boolean;
  isLaunching: boolean;
  onLaunch: (app: RokuApp) => void;
  onToggleFavorite: (appId: string) => void;
}

/** One app in the grid: the artwork and name launch it, the star keeps it as a favorite. */
const AppTile: React.FC<AppTileProps> = ({ device, app, isFavorite, isLaunching, onLaunch, onToggleFavorite }) => (
  <Box
    sx={{
      position: 'relative',
      borderRadius: radius.md,
      overflow: 'hidden',
      backgroundColor: tokens.surface2,
      transition: 'background-color 120ms',
      '&:hover': { backgroundColor: tokens.surface3 },
    }}
  >
    <ButtonBase
      aria-label={`Launch ${app.name}`}
      disabled={isLaunching}
      onClick={() => onLaunch(app)}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        width: '100%',
        textAlign: 'left',
        borderRadius: radius.md,
        touchAction: 'manipulation',
        // The ring is drawn inside: the tile clips anything outside it.
        '&.Mui-focusVisible': { outlineOffset: -2 },
      }}
    >
      <AppIcon device={device} appId={app.id} appName={app.name} busy={isLaunching} />
      <Tooltip title={app.name} enterDelay={600}>
        <Typography
          variant="body2"
          component="span"
          noWrap
          sx={{ display: 'block', fontWeight: 500, minHeight: 44, lineHeight: '44px', pl: 1.25, pr: 5.5 }}
        >
          {app.name}
        </Typography>
      </Tooltip>
    </ButtonBase>
    <Tooltip title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}>
      <IconButton
        aria-label={isFavorite ? `Remove ${app.name} from Favorites` : `Add ${app.name} to Favorites`}
        aria-pressed={isFavorite}
        onClick={() => onToggleFavorite(app.id)}
        sx={{ position: 'absolute', right: 0, bottom: 0, width: 44, height: 44, color: isFavorite ? 'primary.main' : 'text.secondary' }}
      >
        {isFavorite ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
      </IconButton>
    </Tooltip>
  </Box>
);

export default React.memo(AppTile);
