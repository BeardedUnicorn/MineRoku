import React from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useShallow } from 'zustand/react/shallow';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Tooltip,
  Typography,
} from '@mui/material';
import RadarIcon from '@mui/icons-material/Radar';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { useAppStore, type RokuDevice } from '../store';
import { iconCache } from '../iconCache';
import { useBackHandler } from '../hooks/useBackHandler';
import { forgetDevice, hideMediaNotification } from '../services/rokuClient';
import StatusDot from './StatusDot';

export const PROJECT_URL = 'https://github.com/BeardedUnicorn/MineRoku';

/** The devices the list shows: all of them, or only online ones plus the selected one. */
export function useVisibleDevices(): RokuDevice[] {
  const { devices, selectedDevice, showAllDevices } = useAppStore(
    useShallow((s) => ({
      devices: s.devices,
      selectedDevice: s.selectedDevice,
      showAllDevices: s.showAllDevices,
    }))
  );

  return React.useMemo(() => {
    if (showAllDevices) {
      return devices;
    }

    const connected = devices.filter((device) => device.status === 'connected');
    if (selectedDevice && !connected.some((d) => d.hardware_id === selectedDevice.hardware_id)) {
      return [selectedDevice, ...connected];
    }
    return connected;
  }, [devices, selectedDevice, showAllDevices]);
}

interface DevicePanelProps {
  onScan: () => void;
  isScanning: boolean;
  /** Called after a device is picked, so a sheet showing the panel can close. */
  onSelected?: () => void;
}

/**
 * The device list with its scan and forget actions. It is the always-visible rail on desktop
 * and the content of the device sheet on phones.
 */
const DevicePanel: React.FC<DevicePanelProps> = ({ onScan, isScanning, onSelected }) => {
  const selectedDevice = useAppStore((s) => s.selectedDevice);
  const showAllDevices = useAppStore((s) => s.showAllDevices);
  const setSelectedDevice = useAppStore((s) => s.setSelectedDevice);
  const removeDevice = useAppStore((s) => s.removeDevice);
  const visibleDevices = useVisibleDevices();
  const [deviceToForget, setDeviceToForget] = React.useState<RokuDevice | null>(null);
  const [isForgetting, setIsForgetting] = React.useState(false);
  const [forgetError, setForgetError] = React.useState<string | null>(null);

  useBackHandler(deviceToForget !== null, () => !isForgetting && setDeviceToForget(null));

  const handleSelect = (device: RokuDevice) => {
    setSelectedDevice(device);
    onSelected?.();
  };

  const handleForgetDevice = async () => {
    if (!deviceToForget) {
      return;
    }

    const device = deviceToForget;
    setIsForgetting(true);
    setForgetError(null);
    try {
      // Backend first: the device list is re-seeded from its cache on every launch.
      await forgetDevice(device.hardware_id);
    } catch (error) {
      console.error('Failed to forget device:', error);
      setForgetError(`Could not forget this device: ${String(error)}`);
      setIsForgetting(false);
      return;
    }

    const wasSelected = useAppStore.getState().selectedDevice?.hardware_id === device.hardware_id;
    removeDevice(device.hardware_id);

    const iconKeyPrefix = `${device.ip}:${device.port}:`;
    for (const key of Array.from(iconCache.keys())) {
      if (key.startsWith(iconKeyPrefix)) {
        iconCache.delete(key);
      }
    }

    if (wasSelected) {
      void hideMediaNotification().catch(() => undefined);
    }

    setIsForgetting(false);
    setDeviceToForget(null);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          pl: 2.5,
          pr: 1.5,
          minHeight: 60,
          flexShrink: 0,
        }}
      >
        <Typography variant="subtitle1" component="h2">
          Devices
        </Typography>
        <Button
          size="small"
          variant="outlined"
          aria-label="Scan for devices"
          startIcon={<RadarIcon />}
          onClick={onScan}
          disabled={isScanning}
          sx={{ minHeight: 36 }}
        >
          {isScanning ? 'Scanning…' : 'Scan'}
        </Button>
      </Box>
      {/* Always in the layout so the list does not move when a scan starts. */}
      <LinearProgress
        aria-label="Scanning for devices"
        aria-hidden={!isScanning}
        sx={{ height: 2, flexShrink: 0, visibility: isScanning ? 'visible' : 'hidden' }}
      />

      <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', px: 1 }}>
        <List sx={{ py: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {visibleDevices.map((device) => {
            const isSelected = selectedDevice?.hardware_id === device.hardware_id;
            const isOnline = device.status === 'connected';
            return (
              <ListItem
                key={device.hardware_id}
                disablePadding
                secondaryAction={
                  <Tooltip title="Forget device">
                    <IconButton
                      edge="end"
                      aria-label={`Forget ${device.name}`}
                      onClick={() => {
                        setForgetError(null);
                        setDeviceToForget(device);
                      }}
                      sx={{ width: 48, height: 48, color: 'text.secondary' }}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                }
              >
                <ListItemButton
                  selected={isSelected}
                  aria-current={isSelected ? 'true' : undefined}
                  onClick={() => handleSelect(device)}
                  sx={{ minHeight: 56, gap: 1.5, pl: 1.5, pr: 7 }}
                >
                  <StatusDot online={isOnline} />
                  <ListItemText
                    primary={device.name}
                    secondary={device.ip}
                    slotProps={{
                      primary: { sx: { overflowWrap: 'anywhere', fontWeight: isSelected ? 600 : 500 } },
                      secondary: { sx: { fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums' } },
                    }}
                  />
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>
        {!visibleDevices.length && (
          <Typography variant="body2" color="textSecondary" sx={{ px: 1.5, pb: 2 }} role="status" aria-live="polite">
            {isScanning
              ? 'Scanning for devices…'
              : showAllDevices
                ? 'No devices discovered yet.'
                : 'No connected devices. Enable "Show all discovered devices" in Settings to view offline devices.'}
          </Typography>
        )}
      </Box>

      <Box sx={{ px: 1, py: 0.5, display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
        <Tooltip title="About">
          <IconButton
            aria-label="About"
            onClick={() => void openUrl(PROJECT_URL)}
            sx={{ width: 48, height: 48, color: 'text.secondary' }}
          >
            <InfoOutlinedIcon />
          </IconButton>
        </Tooltip>
      </Box>

      <Dialog
        open={deviceToForget !== null}
        onClose={() => !isForgetting && setDeviceToForget(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Forget {deviceToForget?.name ?? 'device'}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            This removes the device from the list along with its favorites and cached apps and
            icons. It will be listed again if a later scan finds it on your network.
          </Typography>
          {forgetError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {forgetError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeviceToForget(null)} disabled={isForgetting}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleForgetDevice()}
            color="error"
            variant="contained"
            disabled={isForgetting}
            startIcon={isForgetting ? <CircularProgress size={16} color="inherit" /> : <DeleteOutlineIcon />}
          >
            {isForgetting ? 'Forgetting…' : 'Forget'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default React.memo(DevicePanel);
