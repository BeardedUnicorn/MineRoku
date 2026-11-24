import { useEffect, useState } from 'react';
import { Alert, Box, Button, FormControlLabel, Stack, Switch, Typography } from '@mui/material';
import { getVersion } from '@tauri-apps/api/app';
import { useShallow } from 'zustand/react/shallow';
import { useUpdates, type UpdateState } from '../services/updates';

/** What the last check found, under the button. */
function Status({ update, onShow }: { update: UpdateState; onShow: () => void }) {
  switch (update.status) {
    case 'checking':
      return <Typography variant="body2" color="text.secondary">Checking for updates…</Typography>;
    case 'upToDate':
      return <Typography variant="body2" color="text.secondary">Roku Remote is up to date.</Typography>;
    case 'checkFailed':
      // An error can carry a long address, which would run past a phone's edge
      return (
        <Alert severity="error" sx={{ overflowWrap: 'anywhere' }}>
          Couldn't check for updates. {update.error}
        </Alert>
      );
    case 'available':
      return (
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <Typography variant="body2">Roku Remote {update.update.version} is available.</Typography>
          <Button size="small" onClick={onShow}>
            Update…
          </Button>
        </Stack>
      );
    case 'installing':
    case 'installFailed':
      return (
        <Typography variant="body2" color="text.secondary">
          Updating to Roku Remote {update.update.version}…
        </Typography>
      );
    default:
      return null;
  }
}

/** Settings → Updates: the version running, a check now, and whether checks run on their own. */
export default function UpdatesSection({ phone }: { phone: boolean }) {
  const { update, autoCheck, check, show, setAutoCheck } = useUpdates(
    useShallow((s) => ({
      update: s.update,
      autoCheck: s.autoCheck,
      check: s.check,
      show: s.show,
      setAutoCheck: s.setAutoCheck,
    }))
  );
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getVersion()
      .then((found) => live && setVersion(found))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  const busy = update.status === 'checking' || update.status === 'installing';

  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle2" color="textSecondary">
        Updates
      </Typography>
      {version && <Typography variant="body2">Version {version}</Typography>}
      <Box>
        <FormControlLabel
          control={<Switch checked={autoCheck} onChange={(event) => setAutoCheck(event.target.checked)} />}
          label="Check for updates automatically"
        />
        <Typography variant="caption" color="textSecondary" component="p">
          Roku Remote looks for a new release on GitHub when it starts and once a day, and asks before{' '}
          {phone ? 'downloading' : 'installing'} it.
        </Typography>
      </Box>
      <Box>
        <Button variant="outlined" onClick={() => void check({ manual: true })} disabled={busy}>
          Check for updates
        </Button>
      </Box>
      <Status update={update} onShow={show} />
    </Stack>
  );
}
