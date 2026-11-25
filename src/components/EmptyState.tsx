import React from 'react';
import { Box, Paper, Typography } from '@mui/material';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  /** Shown in the error color and announced. */
  error?: string;
  /** Buttons, laid out in a wrapping row. */
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

/** The centered card used whenever there is no remote to show. */
const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, error, actions, children }) => (
  <Paper
    sx={{
      p: { xs: 3, sm: 4 },
      textAlign: 'center',
      borderRadius: '16px',
      width: '100%',
      maxWidth: 450,
      mx: 'auto',
      boxSizing: 'border-box',
    }}
  >
    <Box sx={{ color: 'text.secondary', mb: 2, '& .MuiSvgIcon-root': { fontSize: 56 } }}>{icon}</Box>
    <Typography variant="h6" component="h2">
      {title}
    </Typography>
    {description && (
      <Typography variant="body1" color="textSecondary" sx={{ mt: 1 }}>
        {description}
      </Typography>
    )}
    {error && (
      <Typography variant="body2" color="error" sx={{ mt: 1 }} role="alert">
        {error}
      </Typography>
    )}
    {children}
    {actions && (
      <Box sx={{ mt: 2.5, display: 'flex', flexWrap: 'wrap', gap: 1.5, justifyContent: 'center' }}>
        {actions}
      </Box>
    )}
  </Paper>
);

export default EmptyState;
