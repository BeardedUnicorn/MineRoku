import React from 'react';
import { Box, Tooltip } from '@mui/material';

interface StatusDotProps {
  online: boolean;
  size?: number;
}

/** Online is a filled dot, offline a hollow ring, so the state does not rest on color alone. */
const StatusDot: React.FC<StatusDotProps> = ({ online, size = 10 }) => (
  <Tooltip title={online ? 'Online' : 'Offline'}>
    <Box
      role="img"
      aria-label={online ? 'Device online' : 'Device offline'}
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        boxSizing: 'border-box',
        borderRadius: '50%',
        bgcolor: online ? 'success.main' : 'transparent',
        border: online ? 'none' : '2px solid',
        borderColor: 'text.disabled',
      }}
    />
  </Tooltip>
);

export default StatusDot;
