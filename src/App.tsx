import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  AppBar,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import TvIcon from '@mui/icons-material/Tv';
import SearchOffIcon from '@mui/icons-material/SearchOff';
import WifiOffIcon from '@mui/icons-material/WifiOff';
import RadarIcon from '@mui/icons-material/Radar';
import SettingsIcon from '@mui/icons-material/Settings';
import { useShallow } from 'zustand/react/shallow';
import BottomNavBar from './components/BottomNavBar';
import DevicePanel, { useVisibleDevices } from './components/DevicePanel';
import DeviceSwitcher from './components/DeviceSwitcher';
import EmptyState from './components/EmptyState';
import RemoteControl from './components/RemoteControl';
import SettingsDialog from './components/SettingsDialog';
import StatusDot from './components/StatusDot';
import { useToast } from './components/ToastProvider';
import UpdatePrompt from './components/UpdatePrompt';
import { usePlatform } from './hooks/usePlatform';
import { DEVICE_RAIL_WIDTH } from './layout';
import { dismissSplash } from './splash';
import { useAppStore, type RokuDevice } from './store';
import { motion as motionTokens, tokens } from './tokens';
import {
  checkAndroidLocalNetworkAccess,
  checkDeviceConnectivity,
  discoverRokuDevices,
  ensureAndroidDiscoveryPermissions,
  ensureAndroidLocalNetworkAccess,
  getCachedDevices,
  hideMediaNotification,
  openAndroidAppSettings,
  type RokuDeviceEvent,
} from './services/rokuClient';

const LazyAppLauncher = lazy(() => import('./components/AppLauncher'));

const CONNECTIVITY_POLL_INTERVAL = 10000;

// Android 17+ blocks all LAN traffic until the user grants local network access.
type NetworkAccess = 'unknown' | 'granted' | 'denied';
let discoveryListenersReady: Promise<void> | null = null;

const ensureDiscoveryListeners = () => {
  if (discoveryListenersReady) {
    return discoveryListenersReady;
  }

  discoveryListenersReady = Promise.all([
    listen<RokuDeviceEvent>('device_discovered', (event) => {
      const device = event.payload;
      const state = useAppStore.getState();
      state.upsertDevice({ ...device, status: 'connected' });

      if (!state.selectedDevice) {
        if (!state.preferLastUsed) {
          state.setSelectedDevice({ ...device, status: 'connected' });
        }
        return;
      }

      if (
        !state.preferLastUsed &&
        state.selectedDevice.status === 'disconnected' &&
        state.selectedDevice.hardware_id !== device.hardware_id
      ) {
        state.setSelectedDevice({ ...device, status: 'connected' });
      }
    }),
    listen<RokuDeviceEvent>('device_lost', (event) => {
      useAppStore.getState().markDeviceDisconnected(event.payload.hardware_id);
    }),
  ])
    .then(() => undefined)
    .catch((error) => {
      discoveryListenersReady = null;
      throw error;
    });

  return discoveryListenersReady;
};

const App: React.FC = () => {
  const {
    selectedDevice,
    devices,
    addDiscoveredDevices,
    setSelectedDevice,
    upsertDevice,
    markDeviceDisconnected,
    updateDeviceStatus,
  } = useAppStore(
    useShallow((s) => ({
      selectedDevice: s.selectedDevice,
      devices: s.devices,
      addDiscoveredDevices: s.addDiscoveredDevices,
      setSelectedDevice: s.setSelectedDevice,
      upsertDevice: s.upsertDevice,
      markDeviceDisconnected: s.markDeviceDisconnected,
      updateDeviceStatus: s.updateDeviceStatus,
    }))
  );

  const [isSearching, setIsSearching] = useState(true);
  const [networkAccess, setNetworkAccess] = useState<NetworkAccess>('unknown');
  const [isRequestingAccess, setIsRequestingAccess] = useState(false);
  const [isDeviceSheetOpen, setIsDeviceSheetOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The apps list is loaded on first visit and then kept, so its scroll position survives.
  const [appsVisited, setAppsVisited] = useState(false);
  const [mobileView, setMobileView] = useState<'remote' | 'apps'>('remote');
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState('');
  const [scanFailed, setScanFailed] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const scanPromiseRef = useRef<Promise<void> | null>(null);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const showToast = useToast();
  const visibleDevices = useVisibleDevices();
  const currentPlatform = usePlatform();
  const isAndroid = currentPlatform === 'android';
  const hasDevices = devices.length > 0;
  // Until access is granted every request to a Roku would only time out, so nothing that talks
  // to a device is mounted or polled while this is true.
  const networkBlocked = isAndroid && networkAccess !== 'granted';

  useEffect(dismissSplash, []);

  const requestNetworkAccess = useCallback(async () => {
    setIsRequestingAccess(true);
    try {
      const granted = await ensureAndroidLocalNetworkAccess();
      setNetworkAccess(granted ? 'granted' : 'denied');
      return granted;
    } catch (error) {
      console.error('Failed to request local network access:', error);
      setNetworkAccess('denied');
      return false;
    } finally {
      setIsRequestingAccess(false);
    }
  }, []);

  // Saved devices are used without a scan, so ask as soon as there is one to talk to.
  useEffect(() => {
    if (isAndroid && hasDevices && networkAccess === 'unknown') {
      void requestNetworkAccess();
    }
  }, [isAndroid, hasDevices, networkAccess, requestNetworkAccess]);

  // The Android media notification belongs to the selected device: drop it whenever the
  // selection changes or is cleared. The remote posts a fresh one for the new device.
  const selectedHardwareId = selectedDevice?.hardware_id;
  useEffect(() => {
    if (isAndroid) {
      void hideMediaNotification().catch(() => undefined);
    }
  }, [isAndroid, selectedHardwareId]);

  // Granting access in system Settings does not come back through the prompt: look again
  // whenever the app returns to the foreground, without prompting.
  useEffect(() => {
    if (!isAndroid || networkAccess !== 'denied') {
      return;
    }

    const recheck = () => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      void checkAndroidLocalNetworkAccess()
        .then((granted) => {
          if (granted) {
            setNetworkAccess('granted');
          }
        })
        .catch(() => undefined);
    };
    document.addEventListener('visibilitychange', recheck);
    return () => document.removeEventListener('visibilitychange', recheck);
  }, [isAndroid, networkAccess]);

  // The sheet only exists on the phone layout.
  useEffect(() => {
    if (!isMobile) {
      setIsDeviceSheetOpen(false);
    }
  }, [isMobile]);

  useEffect(() => {
    if (mobileView === 'apps') {
      setAppsVisited(true);
    }
  }, [mobileView]);

  useEffect(() => {
    if (!selectedDevice || networkBlocked) {
      return;
    }

    let cancelled = false;
    const device = selectedDevice;

    const checkConnectivity = async () => {
      try {
        const isOnline = await checkDeviceConnectivity(device.ip, device.port);
        if (cancelled) {
          return;
        }

        const newStatus: RokuDevice['status'] = isOnline ? 'connected' : 'disconnected';
        const state = useAppStore.getState();
        const current =
          state.selectedDevice?.hardware_id === device.hardware_id
            ? state.selectedDevice
            : state.devices.find((d) => d.hardware_id === device.hardware_id);

        if (current && current.status !== newStatus) {
          updateDeviceStatus(device.hardware_id, newStatus);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.error('Connectivity check failed:', error);
        const state = useAppStore.getState();
        const current =
          state.selectedDevice?.hardware_id === device.hardware_id
            ? state.selectedDevice
            : state.devices.find((d) => d.hardware_id === device.hardware_id);
        if (current && current.status !== 'disconnected') {
          updateDeviceStatus(device.hardware_id, 'disconnected');
        }
      }
    };

    void checkConnectivity();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void checkConnectivity();
      }
    }, CONNECTIVITY_POLL_INTERVAL);

    // Coming back to the app: refresh now instead of showing a stale status for up to 10 s.
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void checkConnectivity();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [
    selectedDevice?.hardware_id,
    selectedDevice?.ip,
    selectedDevice?.port,
    networkBlocked,
    updateDeviceStatus,
  ]);

  // `announce` reports the outcome in a toast: for scans started from the device list, where the
  // empty state's own status line is not on screen.
  const scanForDevices = useCallback(async ({ announce = false }: { announce?: boolean } = {}) => {
    if (scanPromiseRef.current) {
      return scanPromiseRef.current;
    }

    const report = (message: string, failed = false) => {
      setScanStatus(message);
      if (announce) {
        showToast({ message, severity: failed ? 'error' : 'info' });
      }
    };

    const scanPromise = (async () => {
      setIsScanning(true);
      setIsSearching(true);
      setScanFailed(false);

      try {
        if (isAndroid) {
          setScanStatus('Checking permissions…');
          const hasPermissions = await ensureAndroidDiscoveryPermissions();
          if (!hasPermissions) {
            setScanFailed(true);
            report(
              'Permission is required to find Roku devices on your network. Allow nearby devices (local network) access, then scan again.',
              true
            );
            return;
          }
          setNetworkAccess('granted');
        }

        setScanStatus('Scanning network…');
        setHasScanned(true);
        const foundDevices = await discoverRokuDevices();
        const devicesWithStatus: RokuDevice[] = foundDevices.map((device) => ({
          ...device,
          status: 'connected',
        }));

        addDiscoveredDevices(devicesWithStatus);

        const discoveredIds = new Set(foundDevices.map((device) => device.hardware_id));
        const state = useAppStore.getState();

        state.devices.forEach((device) => {
          // The selected device's status belongs to the connectivity poll. A device can miss
          // one SSDP sweep and still be reachable, and marking it offline here would flip the
          // remote and app list for no reason.
          const isSelected = state.selectedDevice?.hardware_id === device.hardware_id;
          if (!discoveredIds.has(device.hardware_id) && !isSelected) {
            markDeviceDisconnected(device.hardware_id);
          }
        });

        const anyDevicesFound = foundDevices.length > 0;
        report(
          anyDevicesFound
            ? `Found ${foundDevices.length} ${foundDevices.length === 1 ? 'device' : 'devices'}`
            : 'No devices found'
        );

        if (!state.selectedDevice && anyDevicesFound) {
          setSelectedDevice({ ...foundDevices[0], status: 'connected' });
        }
      } catch (error) {
        console.error('Discovery error:', error);
        setScanFailed(true);
        report(`Scan failed: ${String(error)}`, true);
      } finally {
        setIsScanning(false);
        setIsSearching(false);
      }
    })();

    scanPromiseRef.current = scanPromise;
    await scanPromise.finally(() => {
      if (scanPromiseRef.current === scanPromise) {
        scanPromiseRef.current = null;
      }
    });
  }, [addDiscoveredDevices, isAndroid, markDeviceDisconnected, setSelectedDevice, showToast]);

  useEffect(() => {
    let active = true;

    const bootstrapCachedDevices = async () => {
      try {
        const cached = await getCachedDevices();
        if (!active || cached.length === 0) {
          return;
        }

        // Only devices the store has not seen start as offline: a discovery event may already
        // have marked a known one online, and this must not downgrade it.
        const known = new Set(useAppStore.getState().devices.map((d) => d.hardware_id));
        cached.forEach((device) =>
          upsertDevice(known.has(device.hardware_id) ? device : { ...device, status: 'disconnected' })
        );

        const state = useAppStore.getState();
        if (state.preferLastUsed && !state.selectedDevice) {
          setSelectedDevice({ ...cached[0], status: 'disconnected' });
        }
      } catch (error) {
        console.warn('Failed to load cached devices', error);
      }
    };

    void Promise.all([bootstrapCachedDevices(), ensureDiscoveryListeners()]).catch((error) => {
      if (active) {
        console.error('Failed to initialize discovery listeners:', error);
      }
    });
    if (currentPlatform === null) {
      // Not known yet. Android must never scan on its own, so wait rather than guess.
    } else if (isAndroid) {
      setIsSearching(false);
    } else {
      void scanForDevices();
    }

    return () => {
      active = false;
    };
  }, [currentPlatform, isAndroid, scanForDevices, upsertDevice, setSelectedDevice]);

  const openAppSettings = useCallback(() => {
    void openAndroidAppSettings().catch((error) => {
      console.error('Failed to open Android app settings:', error);
    });
  }, []);
  const scanFromPanel = useCallback(() => void scanForDevices({ announce: true }), [scanForDevices]);
  const closeDeviceSheet = useCallback(() => setIsDeviceSheetOpen(false), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  const loadingFallback = (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 280 }}>
      <CircularProgress size={26} />
    </Box>
  );

  const showRemote = Boolean(selectedDevice) && !networkBlocked;

  const renderStatus = () => {
    if (selectedDevice && networkBlocked) {
      if (networkAccess === 'unknown') {
        return (
          <Box
            sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
            role="status"
            aria-live="polite"
          >
            <CircularProgress />
            <Typography variant="body1" color="textSecondary">
              Checking network access…
            </Typography>
          </Box>
        );
      }

      return (
        <EmptyState
          icon={<WifiOffIcon />}
          title="Local network access needed"
          description={
            <>
              Roku Remote controls your Roku over Wi-Fi. Allow access to nearby devices so it can
              reach {selectedDevice.name}.
            </>
          }
          actions={
            <>
              <Button
                variant="contained"
                disabled={isRequestingAccess}
                onClick={() => void requestNetworkAccess()}
              >
                Allow access
              </Button>
              <Button variant="outlined" onClick={openAppSettings}>
                Open Settings
              </Button>
            </>
          }
        />
      );
    }

    if (isSearching && !hasDevices) {
      return (
        <Box
          sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
          role="status"
          aria-live="polite"
        >
          <CircularProgress />
          <Typography variant="h6" component="p" color="textSecondary">
            Searching for Roku devices…
          </Typography>
          {scanStatus && (
            <Typography variant="body2" color="textSecondary">
              {scanStatus}
            </Typography>
          )}
        </Box>
      );
    }

    const scanButton = (label: string, variant: 'contained' | 'text' = 'contained') => (
      <Button
        variant={variant}
        startIcon={isScanning ? <CircularProgress size={16} color="inherit" /> : <RadarIcon />}
        onClick={() => void scanForDevices()}
        disabled={isScanning}
      >
        {isScanning ? 'Scanning…' : label}
      </Button>
    );

    if (!hasDevices) {
      const discoveryPermissionBlocked =
        isAndroid && scanFailed && scanStatus.toLowerCase().includes('permission');
      // Android never scans on its own, so the first visit is an invitation, not a failure.
      const neverScanned = isAndroid && !hasScanned;
      return (
        <EmptyState
          icon={neverScanned ? <TvIcon /> : <SearchOffIcon />}
          title={neverScanned ? 'Find your Roku' : 'No Roku Devices Found'}
          description={
            neverScanned
              ? 'Make sure your Roku is powered on and on the same Wi-Fi network as this device, then scan.'
              : 'Please ensure your Roku is powered on and connected to the same WiFi network, then scan again.'
          }
          error={scanFailed && scanStatus ? scanStatus : undefined}
          actions={
            <>
              {scanButton(neverScanned ? 'Scan for devices' : 'Scan again')}
              {discoveryPermissionBlocked && (
                <Button variant="outlined" onClick={openAppSettings}>
                  Open Settings
                </Button>
              )}
            </>
          }
        />
      );
    }

    // Devices are known but none is selected: offer them right here, one tap each.
    return (
      <EmptyState
        icon={<TvIcon />}
        title="Choose a Roku"
        description={visibleDevices.length ? undefined : 'No connected devices right now.'}
        error={scanFailed && scanStatus ? scanStatus : undefined}
        actions={scanButton('Scan again', 'text')}
      >
        <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {visibleDevices.map((device) => (
            <Button
              key={device.hardware_id}
              variant="outlined"
              fullWidth
              onClick={() => setSelectedDevice(device)}
              startIcon={<StatusDot online={device.status === 'connected'} />}
              sx={{ justifyContent: 'flex-start', minHeight: 48, gap: 0.5, overflowWrap: 'anywhere', textAlign: 'left' }}
            >
              {device.name}
            </Button>
          ))}
        </Box>
      </EmptyState>
    );
  };

  const renderRemote = (device: RokuDevice) => {
    const apps = (
      <Suspense fallback={loadingFallback}>
        <LazyAppLauncher device={device} />
      </Suspense>
    );
    // Fades in when the device changes. Keyed on the device, so both panes remount with it.
    const enter = {
      animation: `content-in ${motionTokens.enter} ${motionTokens.easing}`,
      '@keyframes content-in': { from: { opacity: 0, transform: 'translateY(8px)' } },
    };

    if (isMobile) {
      const pane = (visible: boolean) => ({
        display: visible ? 'block' : 'none',
        flexGrow: 1,
        minHeight: 0,
        overflowY: 'auto',
        p: { xs: 1.5, sm: 2 },
      });
      return (
        <Box key={device.hardware_id} sx={{ ...enter, display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
          {/* Hidden, not unmounted, on the Apps tab: keyboard shortcuts and the Android media
              notification keep working there. */}
          <Box sx={pane(mobileView === 'remote')}>
            <RemoteControl device={device} />
          </Box>
          {appsVisited && <Box sx={pane(mobileView === 'apps')}>{apps}</Box>}
        </Box>
      );
    }

    return (
      <Box key={device.hardware_id} sx={{ ...enter, display: 'flex', flexGrow: 1, minHeight: 0 }}>
        {/* Scrolls on its own, so a short window never cuts the remote off. */}
        <Box sx={{ width: 368, flexShrink: 0, overflowY: 'auto', px: 3, py: 3, boxSizing: 'border-box' }}>
          <RemoteControl device={device} />
        </Box>
        <Box sx={{ flexGrow: 1, minWidth: 0, overflowY: 'auto', py: 3, pr: 3 }}>{apps}</Box>
      </Box>
    );
  };

  const title = selectedDevice ? selectedDevice.name : 'Roku Remote';
  const online = selectedDevice ? selectedDevice.status === 'connected' : null;
  const devicePanel = (
    <DevicePanel
      onScan={scanFromPanel}
      isScanning={isScanning}
      onSelected={isMobile ? closeDeviceSheet : undefined}
    />
  );

  return (
    <Box sx={{ display: 'flex', height: '100dvh', bgcolor: 'background.default', color: 'text.primary' }}>
      {/* The device list is always on screen on desktop. On phones it is a sheet opened from
          the app bar title. */}
      {!isMobile && (
        <Box
          component="nav"
          aria-label="device navigation"
          sx={{
            width: DEVICE_RAIL_WIDTH,
            flexShrink: 0,
            bgcolor: 'background.paper',
            borderRight: '1px solid',
            borderColor: 'divider',
          }}
        >
          {devicePanel}
        </Box>
      )}
      <UpdatePrompt />
      <SettingsDialog open={settingsOpen} onClose={closeSettings} />

      <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, height: '100dvh', overflow: 'hidden' }}>
        <AppBar
          position="static"
          color="transparent"
          elevation={0}
          sx={{
            flexShrink: 0,
            borderBottom: '1px solid',
            borderColor: 'divider',
            backgroundColor: { xs: alpha(tokens.surfaceLowest, 0.88), md: 'transparent' },
            backdropFilter: { xs: 'blur(10px)', md: 'none' },
          }}
        >
          <Toolbar disableGutters sx={{ minHeight: { xs: 52, md: 60 }, pl: { xs: 0.5, md: 3 }, pr: { xs: 0.5, md: 1.5 }, gap: 1 }}>
            <Box component="h1" sx={{ m: 0, display: 'flex', alignItems: 'center', gap: 1.25, flexGrow: 1, minWidth: 0 }}>
              {isMobile ? (
                <DeviceSwitcher
                  title={title}
                  online={online}
                  open={isDeviceSheetOpen}
                  onOpen={() => setIsDeviceSheetOpen(true)}
                  onClose={closeDeviceSheet}
                >
                  {devicePanel}
                </DeviceSwitcher>
              ) : (
                <>
                  <Typography variant="h6" component="span" noWrap sx={{ minWidth: 0 }}>
                    {title}
                  </Typography>
                  {online !== null && <StatusDot online={online} />}
                </>
              )}
            </Box>
            <Tooltip title="Settings">
              <IconButton
                aria-label="Settings"
                onClick={() => setSettingsOpen(true)}
                sx={{ width: 48, height: 48, color: 'text.secondary' }}
              >
                <SettingsIcon />
              </IconButton>
            </Tooltip>
          </Toolbar>
        </AppBar>

        <Box
          component="main"
          id="main-content"
          tabIndex={-1}
          sx={{
            flexGrow: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            '&:focus-visible': { outline: `2px solid ${tokens.primaryLight}`, outlineOffset: -2 },
          }}
        >
          {showRemote && selectedDevice ? (
            renderRemote(selectedDevice)
          ) : (
            <Box
              sx={{
                flexGrow: 1,
                minHeight: 0,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                p: 2,
              }}
            >
              {renderStatus()}
            </Box>
          )}
        </Box>

        {isMobile && showRemote && (
          <Box component="nav" aria-label="bottom navigation" sx={{ flexShrink: 0 }}>
            <BottomNavBar view={mobileView} setView={setMobileView} />
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default App;
