import React from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import { remoteStylePresets, useAppStore } from '../store';
import { iconCache } from '../iconCache';
import { usePlatform } from '../hooks/usePlatform';
import { useBackHandler } from '../hooks/useBackHandler';
import { clearAllData, hideMediaNotification, restartApp } from '../services/rokuClient';
import { resetUpdates } from '../services/updates';
import { radius, tokens } from '../tokens';
import { getRemoteStyleTokens, remoteStyleLabels } from './remoteStyleTokens';
import { PROJECT_URL } from './DevicePanel';
import UpdatesSection from './UpdatesSection';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

const SectionTitle: React.FC<React.PropsWithChildren<{ id?: string }>> = ({ id, children }) => (
  <Typography id={id} variant="subtitle2" component="h3" color="textSecondary">
    {children}
  </Typography>
);

/** Remote style as four swatches. One tap picks a style and the remote behind updates at once. */
const RemoteStylePicker: React.FC = () => {
  const theme = useTheme();
  const remoteStyle = useAppStore((s) => s.remoteStyle);
  const setRemoteStyle = useAppStore((s) => s.setRemoteStyle);

  return (
    <Box
      role="radiogroup"
      aria-labelledby="remote-style-label"
      sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, 1fr)' }, gap: 1 }}
    >
      {remoteStylePresets.map((style) => {
        const styleTokens = getRemoteStyleTokens(style, theme);
        const selected = style === remoteStyle;
        return (
          <Box
            key={style}
            component="label"
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 1,
              p: 1.25,
              minHeight: 48,
              cursor: 'pointer',
              borderRadius: radius.md,
              border: '2px solid',
              borderColor: selected ? 'primary.main' : 'transparent',
              backgroundColor: selected ? tokens.surface3 : 'action.hover',
              transition: 'background-color 120ms, border-color 120ms',
              '&:hover': { backgroundColor: selected ? tokens.surface3 : 'action.selected' },
              '&:has(input:focus-visible)': { outline: `2px solid ${tokens.primaryLight}`, outlineOffset: 2 },
            }}
          >
            <Box
              component="input"
              type="radio"
              name="remote-style"
              value={style}
              checked={selected}
              onChange={() => setRemoteStyle(style)}
              sx={{ position: 'absolute', opacity: 0, width: 1, height: 1, m: 0 }}
            />
            {/* A thumbnail of the remote: its card and its OK button. */}
            <Box
              aria-hidden
              sx={{
                width: 36,
                height: 52,
                borderRadius: '12px',
                background: styleTokens.cardBackground,
                border: styleTokens.cardBorder,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Box sx={{ width: 16, height: 16, borderRadius: '50%', background: styleTokens.centerButtonBackground }} />
            </Box>
            <Typography variant="body2" sx={{ fontWeight: selected ? 600 : 500, textAlign: 'center' }}>
              {remoteStyleLabels[style]}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
};

const SettingsDialog: React.FC<SettingsDialogProps> = ({ open, onClose }) => {
  const preferLastUsed = useAppStore((s) => s.preferLastUsed);
  const setPreferLastUsed = useAppStore((s) => s.setPreferLastUsed);
  const showAllDevices = useAppStore((s) => s.showAllDevices);
  const setShowAllDevices = useAppStore((s) => s.setShowAllDevices);
  const resetState = useAppStore((s) => s.resetState);
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [confirmDeleteOpen, setConfirmDeleteOpen] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const currentPlatform = usePlatform();
  const isMobilePlatform = currentPlatform === 'android' || currentPlatform === 'ios';

  useBackHandler(open, onClose);
  useBackHandler(confirmDeleteOpen, () => !isDeleting && setConfirmDeleteOpen(false));

  const handleDeleteAllData = async () => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      // Clear backend database. If this fails the devices would simply come back from
      // the backend cache on the next launch, so stop and say so.
      await clearAllData();
    } catch (error) {
      console.error('Failed to delete data:', error);
      setDeleteError(`Could not delete saved data: ${String(error)}`);
      setIsDeleting(false);
      return;
    }

    void hideMediaNotification().catch(() => undefined);

    localStorage.removeItem('roku-remote-storage');
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('roku')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));

    iconCache.clear();
    useAppStore.persist.clearStorage();
    resetState();
    resetUpdates();
    setConfirmDeleteOpen(false);
    onClose();

    if (isMobilePlatform) {
      setIsDeleting(false);
      return;
    }

    try {
      await restartApp();
    } catch (error) {
      console.error('Failed to restart app:', error);
      setIsDeleting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth fullScreen={fullScreen}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 1.5 }}>
          Settings
          <IconButton aria-label="Close settings" onClick={onClose} sx={{ width: 48, height: 48, color: 'text.secondary' }}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={3} divider={<Divider flexItem />}>
            <Stack spacing={1.5}>
              <SectionTitle id="remote-style-label">Remote style</SectionTitle>
              <RemoteStylePicker />
            </Stack>

            <Stack spacing={1}>
              <SectionTitle>Devices</SectionTitle>
              <FormControlLabel
                control={<Switch checked={preferLastUsed} onChange={(e) => setPreferLastUsed(e.target.checked)} />}
                label="Prefer last-used device on startup"
              />
              <FormControlLabel
                control={<Switch checked={showAllDevices} onChange={(e) => setShowAllDevices(e.target.checked)} />}
                label="Show all discovered devices"
              />
              <Typography variant="caption" color="textSecondary">
                When disabled, only connected devices are shown. Your selected device stays visible even if it goes
                offline.
              </Typography>
            </Stack>

            <UpdatesSection phone={isMobilePlatform} />

            <Stack spacing={1.5}>
              <SectionTitle>Data</SectionTitle>
              <Box>
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<DeleteForeverIcon />}
                  onClick={() => {
                    setDeleteError(null);
                    setConfirmDeleteOpen(true);
                  }}
                >
                  Delete All Data
                </Button>
              </Box>
              <Typography variant="caption" color="textSecondary">
                This will remove all saved devices, favorites, cached icons, and settings.
                {isMobilePlatform ? '' : ' The app will restart afterward.'}
              </Typography>
            </Stack>

            <Stack spacing={1}>
              <SectionTitle>About</SectionTitle>
              <Box>
                <Button onClick={() => void openUrl(PROJECT_URL)} sx={{ ml: -1.5 }}>
                  Roku Remote on GitHub
                </Button>
              </Box>
            </Stack>
          </Stack>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmDeleteOpen}
        onClose={() => !isDeleting && setConfirmDeleteOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ color: 'error.main' }}>Delete All Data?</DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 2 }}>
            This action cannot be undone. The following will be permanently deleted:
          </Typography>
          <Box component="ul" sx={{ pl: 2, m: 0 }}>
            <li><Typography variant="body2">All saved Roku devices</Typography></li>
            <li><Typography variant="body2">Favorite apps</Typography></li>
            <li><Typography variant="body2">Cached app icons</Typography></li>
            <li><Typography variant="body2">All settings and preferences</Typography></li>
          </Box>
          {!isMobilePlatform && (
            <Typography variant="body2" sx={{ mt: 2, fontWeight: 500 }}>
              The app will restart after deletion.
            </Typography>
          )}
          {deleteError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {deleteError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDeleteOpen(false)} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleDeleteAllData()}
            color="error"
            variant="contained"
            disabled={isDeleting}
            startIcon={isDeleting ? <CircularProgress size={16} color="inherit" /> : <DeleteForeverIcon />}
          >
            {isDeleting ? 'Deleting…' : isMobilePlatform ? 'Delete All' : 'Delete All & Restart'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default React.memo(SettingsDialog);
