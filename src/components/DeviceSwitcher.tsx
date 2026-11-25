import React from 'react';
import { Box, ButtonBase, Drawer, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useBackHandler } from '../hooks/useBackHandler';
import { radius } from '../tokens';
import StatusDot from './StatusDot';

interface DeviceSwitcherProps {
  /** The selected device's name, or the app name when there is none. */
  title: string;
  /** null when no device is selected. */
  online: boolean | null;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** The device panel shown in the sheet. */
  children: React.ReactNode;
}

/**
 * Phones: the app bar title is the way to the device list. Tapping it opens a bottom sheet,
 * within thumb reach, in place of the old side drawer behind a menu icon.
 */
const DeviceSwitcher: React.FC<DeviceSwitcherProps> = ({ title, online, open, onOpen, onClose, children }) => {
  useBackHandler(open, onClose);

  return (
    <>
      <ButtonBase
        aria-label={`${title}. Change device`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={onOpen}
        sx={{
          minWidth: 0,
          maxWidth: '100%',
          minHeight: 48,
          gap: 1,
          pl: 1.5,
          pr: 0.75,
          borderRadius: radius.md,
          justifyContent: 'flex-start',
          touchAction: 'manipulation',
          '&:hover': { backgroundColor: 'action.hover' },
        }}
      >
        {online !== null && <StatusDot online={online} />}
        <Typography variant="subtitle1" component="span" noWrap sx={{ minWidth: 0 }}>
          {title}
        </Typography>
        <ExpandMoreIcon
          aria-hidden
          sx={{
            color: 'text.secondary',
            flexShrink: 0,
            transition: 'transform 200ms',
            transform: open ? 'rotate(180deg)' : 'none',
          }}
        />
      </ButtonBase>

      <Drawer
        anchor="bottom"
        open={open}
        onClose={onClose}
        slotProps={{
          paper: {
            'aria-label': 'Devices',
            sx: {
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              maxHeight: '80dvh',
              pb: 'env(safe-area-inset-bottom)',
            },
          },
        }}
      >
        {/* Grab handle: decoration only, the backdrop and Back close the sheet. */}
        <Box
          aria-hidden
          sx={{ width: 36, height: 4, borderRadius: radius.pill, bgcolor: 'text.disabled', mx: 'auto', mt: 1, opacity: 0.6 }}
        />
        {children}
      </Drawer>
    </>
  );
};

export default DeviceSwitcher;
