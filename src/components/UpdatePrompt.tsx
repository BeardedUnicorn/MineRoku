import { useEffect, useReducer } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
  Typography,
} from '@mui/material';
import { useShallow } from 'zustand/react/shallow';
import {
  automaticCheckDue,
  releasesSince,
  useUpdates,
  type AvailableUpdate,
  type UpdateProgress,
} from '../services/updates';
import { openSecuritySettings, sideloadingBlocked } from '../services/androidUpdate';
import { usePlatform } from '../hooks/usePlatform';
import { useBackHandler } from '../hooks/useBackHandler';
import UpdateNotes from './UpdateNotes';

/** The launch check waits this long, so it doesn't compete with startup. */
export const FIRST_CHECK_DELAY_MS = 10_000;
/**
 * How often to see whether the daily check is due. A timer in a window
 * hidden to the tray, or in an app in the background, can be held back, so
 * the daily check isn't one long timer: this one, and the window showing
 * again, catch up on it.
 */
export const DUE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Checks at launch and then daily, unless they're off. */
function useAutomaticChecks(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const { check } = useUpdates.getState();
    const checkIfOn = () => useUpdates.getState().autoCheck && void check({ manual: false });
    const checkIfDue = () => automaticCheckDue(Date.now()) && void check({ manual: false });
    const onVisible = () => document.visibilityState === 'visible' && checkIfDue();

    const first = window.setTimeout(checkIfOn, FIRST_CHECK_DELAY_MS);
    const hourly = window.setInterval(checkIfDue, DUE_CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(hourly);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);
}

const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

function Progress({ progress, phone }: { progress: UpdateProgress | null; phone: boolean }) {
  if (progress?.installing) {
    return (
      <>
        <LinearProgress aria-label="Installing the update" />
        <Typography variant="body2" sx={{ mt: 1 }}>
          Installing… Roku Remote restarts when it's done.
        </Typography>
      </>
    );
  }
  const total = progress?.total ?? null;
  const percent = progress && total ? Math.min(100, Math.round((progress.downloaded / total) * 100)) : null;
  const done = percent === 100 && phone;
  return (
    <>
      <LinearProgress
        aria-label="Downloading the update"
        variant={percent === null ? 'indeterminate' : 'determinate'}
        value={percent ?? undefined}
      />
      <Typography variant="body2" sx={{ mt: 1 }}>
        {progress === null
          ? 'Starting the download…'
          : done
            ? 'Downloaded. Opening Android’s installer…'
            : `Downloading… ${megabytes(progress.downloaded)}${total ? ` of ${megabytes(total)}` : ''}`}
      </Typography>
    </>
  );
}

/** "You have 0.1.0, 3 releases behind." */
function Behind({ update }: { update: AvailableUpdate }) {
  const since = releasesSince(update).length;
  return (
    <>
      You have {update.currentVersion}
      {since > 1 && `, ${since} releases behind`}.
    </>
  );
}

interface UpdatePromptProps {
  /** Checks at launch and daily; off in a development build. */
  automaticChecks?: boolean;
}

/**
 * The update dialog. It checks on its own at launch and daily, and asks
 * before installing what it finds, or on a phone, before downloading it. A
 * phone with Advanced Protection on won't install the download, so there it
 * says how to turn that off.
 */
export default function UpdatePrompt({ automaticChecks = !import.meta.env.DEV }: UpdatePromptProps) {
  useAutomaticChecks(automaticChecks);
  const { state, later, install, download, openInBrowser } = useUpdates(
    useShallow((s) => ({
      state: s.update,
      later: s.later,
      install: s.install,
      download: s.download,
      openInBrowser: s.openInBrowser,
    }))
  );
  // Advanced Protection is the phone's setting, so it's read again on each render
  const [, recheck] = useReducer((count: number) => count + 1, 0);
  const phone = usePlatform() === 'android';

  const open =
    (state.status === 'available' && state.open) ||
    state.status === 'installing' ||
    state.status === 'installFailed';
  const installing = state.status === 'installing';
  useBackHandler(open, () => !installing && later());
  if (!open) return null;

  const { update } = state;
  const blocked = phone && sideloadingBlocked();
  return (
    <Dialog
      open
      // Nothing closes it mid-install; otherwise closing is Later
      onClose={() => !installing && later()}
      maxWidth="sm"
      fullWidth
      aria-labelledby="update-dialog-title"
    >
      <DialogTitle id="update-dialog-title">Roku Remote {update.version} is available</DialogTitle>
      <DialogContent>
        <DialogContentText>
          <Behind update={update} />{' '}
          {phone
            ? 'Roku Remote downloads the update, and Android asks before installing it. Your devices and settings are kept.'
            : 'Roku Remote downloads the update, installs it and restarts.'}
        </DialogContentText>
        {blocked && (
          <Alert
            severity="warning"
            sx={{ mt: 2 }}
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  openSecuritySettings();
                  recheck();
                }}
              >
                Open settings
              </Button>
            }
          >
            Advanced Protection is on, so Android won't install apps from outside a store. Turn it off in Settings →
            Security to install this update.
          </Alert>
        )}
        <UpdateNotes update={update} />
        {installing && (
          <Box sx={{ mt: 3 }}>
            <Progress progress={state.progress} phone={phone} />
          </Box>
        )}
        {state.status === 'installFailed' && (
          <Alert severity="error" sx={{ mt: 2, overflowWrap: 'anywhere' }}>
            {phone ? "The update couldn't be downloaded." : "The update couldn't be installed."} {state.error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap' }}>
        <Button onClick={later} disabled={installing}>
          {state.status === 'installFailed' ? 'Close' : 'Later'}
        </Button>
        {phone && state.status === 'installFailed' && (
          <Button onClick={() => void openInBrowser()}>Download in browser</Button>
        )}
        <Button
          variant="contained"
          onClick={() => {
            recheck();
            void (phone ? download() : install());
          }}
          disabled={installing || blocked}
        >
          {state.status === 'installFailed' ? 'Try again' : phone ? 'Download' : 'Install and restart'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
