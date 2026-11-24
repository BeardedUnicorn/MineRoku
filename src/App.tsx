import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import Sidebar from './components/Sidebar';
import UpdatePrompt from './components/UpdatePrompt';
import RemoteControl from './components/RemoteControl';
import {
  Box,
  Typography,
  Paper,
  CircularProgress,
  AppBar,
  Toolbar,
  IconButton,
  useTheme,
  useMediaQuery,
  Button,
  Tooltip,
} from '@mui/material';
import { motion } from 'framer-motion';
import TvIcon from '@mui/icons-material/Tv';
import SearchOffIcon from '@mui/icons-material/SearchOff';
import WifiOffIcon from '@mui/icons-material/WifiOff';
import MenuIcon from '@mui/icons-material/Menu';
import RefreshIcon from '@mui/icons-material/Refresh';
import BottomNavBar from './components/BottomNavBar';
import './App.css';
import { useAppStore, type RokuDevice } from './store';
import { useShallow } from 'zustand/react/shallow';
import { usePlatform } from './hooks/usePlatform';
import { dismissSplash } from './splash';
import {
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
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [mobileView, setMobileView] = useState<'remote' | 'apps'>('remote');
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState('');
  const [scanFailed, setScanFailed] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const scanPromiseRef = useRef<Promise<void> | null>(null);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
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

  useEffect(() => {
    setIsSidebarOpen(!isMobile);
  }, [isMobile]);

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

  const handleToggleSidebar = useCallback(() => {
    setIsSidebarOpen((v) => !v);
  }, []);

  const scanForDevices = useCallback(async () => {
    if (scanPromiseRef.current) {
      return scanPromiseRef.current;
    }

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
            setScanStatus(
              'Permission is required to find Roku devices on your network. Allow nearby devices (local network) access, then scan again.'
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
        setScanStatus(
          anyDevicesFound ? `Found ${foundDevices.length} device(s)` : 'No devices found'
        );

        if (!state.selectedDevice && anyDevicesFound) {
          setSelectedDevice({ ...foundDevices[0], status: 'connected' });
        }
      } catch (error) {
        console.error('Discovery error:', error);
        setScanFailed(true);
        setScanStatus(`Scan failed: ${String(error)}`);
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
  }, [addDiscoveredDevices, isAndroid, markDeviceDisconnected, setSelectedDevice]);

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

  const contentVariants = useMemo(
    () =>
      prefersReducedMotion
        ? {
            hidden: { opacity: 1, y: 0 },
            visible: { opacity: 1, y: 0 },
            exit: { opacity: 1, y: 0 },
          }
        : {
            hidden: { opacity: 0, y: 20 },
            visible: { opacity: 1, y: 0, transition: { duration: 0.4 } },
            exit: { opacity: 0, y: -20, transition: { duration: 0.3 } },
          },
    [prefersReducedMotion]
  );

  const appLauncherFallback = useMemo(
    () => (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 280 }}>
        <CircularProgress size={26} />
      </Box>
    ),
    []
  );

  const mainContent = useMemo(() => {
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
        <Paper
          sx={{
            p: 4,
            textAlign: 'center',
            backgroundColor: 'background.paper',
            borderRadius: 4,
            maxWidth: 450,
            mx: 'auto',
          }}
        >
          <WifiOffIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" component="h2">
            Local network access needed
          </Typography>
          <Typography variant="body1" color="textSecondary" sx={{ mt: 1 }}>
            Roku Remote controls your Roku over Wi-Fi. Allow access to nearby devices so it can
            reach {selectedDevice.name}.
          </Typography>
          <Button
            variant="contained"
            sx={{ mt: 2 }}
            disabled={isRequestingAccess}
            onClick={() => void requestNetworkAccess()}
          >
            Allow access
          </Button>
          <Button
            variant="outlined"
            sx={{ mt: 1.5, ml: 1 }}
            onClick={() => {
              void openAndroidAppSettings().catch((error) => {
                console.error('Failed to open Android app settings:', error);
              });
            }}
          >
            Open Settings
          </Button>
        </Paper>
      );
    }

    if (selectedDevice) {
      return (
        <motion.div
          key={selectedDevice.hardware_id}
          initial="hidden"
          animate="visible"
          exit="exit"
          variants={contentVariants}
          style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}
        >
          {isMobile ? (
            <Box sx={{ flexGrow: 1, overflowY: 'auto', p: { xs: 1.25, sm: 1.5 } }}>
              {mobileView === 'remote' && <RemoteControl device={selectedDevice} />}
              {mobileView === 'apps' && (
                <Suspense fallback={appLauncherFallback}>
                  <LazyAppLauncher device={selectedDevice} />
                </Suspense>
              )}
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'row', gap: 4, flex: 1, overflow: 'hidden' }}>
              <Box
                sx={{
                  width: 320,
                  flexShrink: 0,
                  mx: 'auto',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'flex-start',
                }}
              >
                <RemoteControl device={selectedDevice} />
              </Box>
              <Box sx={{ flexGrow: 1, minWidth: 0, overflowY: 'auto', pr: 2 }}>
                <Suspense fallback={appLauncherFallback}>
                  <LazyAppLauncher device={selectedDevice} />
                </Suspense>
              </Box>
            </Box>
          )}
        </motion.div>
      );
    }

    const hasAnyDevices = hasDevices;

    if (isSearching && !hasAnyDevices) {
      return (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            gap: 2,
          }}
          role="status"
          aria-live="polite"
        >
          <CircularProgress />
          <Typography variant="h6" color="textSecondary">
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

    if (!hasAnyDevices) {
      const discoveryPermissionBlocked =
        isAndroid && scanFailed && scanStatus.toLowerCase().includes('permission');
      // Android never scans on its own, so the first visit is an invitation, not a failure.
      const neverScanned = isAndroid && !hasScanned;
      return (
        <Paper
          sx={{
            p: 4,
            textAlign: 'center',
            backgroundColor: 'background.paper',
            borderRadius: 4,
            maxWidth: 450,
            mx: 'auto',
          }}
        >
          <SearchOffIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" component="h2" color="textSecondary">
            {neverScanned ? 'Find your Roku' : 'No Roku Devices Found'}
          </Typography>
          <Typography variant="body1" color="textSecondary" sx={{ mt: 1 }}>
            {neverScanned
              ? 'Make sure your Roku is powered on and on the same Wi-Fi network as this device, then scan.'
              : 'Please ensure your Roku is powered on and connected to the same WiFi network, then scan again.'}
          </Typography>
          {scanFailed && scanStatus && (
            <Typography variant="body2" color="error" sx={{ mt: 1 }} role="alert">
              {scanStatus}
            </Typography>
          )}
          <Box sx={{ mt: 2, display: 'flex', flexWrap: 'wrap', gap: 1.5, justifyContent: 'center' }}>
            <Button
              variant="contained"
              startIcon={isScanning ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />}
              onClick={() => void scanForDevices()}
              disabled={isScanning}
            >
              {isScanning ? 'Scanning…' : neverScanned ? 'Scan for devices' : 'Refresh'}
            </Button>
            {discoveryPermissionBlocked && (
              <Button
                variant="outlined"
                onClick={() => {
                  void openAndroidAppSettings().catch((error) => {
                    console.error('Failed to open Android app settings:', error);
                  });
                }}
              >
                Open Settings
              </Button>
            )}
          </Box>
        </Paper>
      );
    }

    return (
      <Paper
        sx={{
          p: 4,
          textAlign: 'center',
          backgroundColor: 'background.paper',
          borderRadius: 4,
          maxWidth: 450,
          mx: 'auto',
        }}
      >
        <TvIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
        <Typography variant="h6" color="textSecondary">
          Select a device to begin
        </Typography>
      </Paper>
    );
  }, [
    selectedDevice,
    contentVariants,
    isMobile,
    mobileView,
    appLauncherFallback,
    hasDevices,
    networkBlocked,
    networkAccess,
    isRequestingAccess,
    requestNetworkAccess,
    isSearching,
    scanStatus,
    scanFailed,
    hasScanned,
    isAndroid,
    isScanning,
    scanForDevices,
  ]);

  return (
    <Box className="app-container">
      <Box component="nav" sx={{ flexShrink: 0 }} aria-label="device navigation">
        <Sidebar
          isOpen={isSidebarOpen}
          onToggle={handleToggleSidebar}
          scanForDevices={scanForDevices}
          isScanning={isScanning}
        />
      </Box>
      <UpdatePrompt />
      <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, height: '100dvh', overflow: 'hidden' }}>
        <AppBar
          position="static"
          color="transparent"
          elevation={0}
          sx={{
            borderBottom: `1px solid ${theme.palette.divider}`,
            display: 'flex',
            alignItems: 'center',
            flexDirection: 'row',
            flexShrink: 0,
            backgroundColor: { xs: 'rgba(18,18,18,0.88)', md: 'transparent' },
            backdropFilter: { xs: 'blur(10px)', md: 'none' },
          }}
        >
          <Toolbar sx={{ minHeight: { xs: 58, sm: 62, md: 64 }, px: { xs: 1, sm: 2 }, width: '100%' }}>
            {/* The device list is always visible on desktop, so there is nothing to toggle. */}
            {isMobile && (
              <IconButton
                edge="start"
                color="inherit"
                aria-label="Open device list"
                onClick={handleToggleSidebar}
                sx={{ mr: { xs: 1, sm: 2 }, width: 48, height: 48 }}
              >
                <MenuIcon />
              </IconButton>
            )}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexGrow: 1, minWidth: 0 }}>
              <Typography
                variant={isMobile ? 'subtitle1' : 'h6'}
                component="h1"
                noWrap
                sx={{ color: 'primary.main', fontWeight: 'bold', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {selectedDevice ? selectedDevice.name : 'Roku Remote'}
              </Typography>
              {selectedDevice && (
                <Tooltip title={selectedDevice.status === 'connected' ? 'Online' : 'Offline'}>
                  <Box
                    role="img"
                    aria-label={selectedDevice.status === 'connected' ? 'Device online' : 'Device offline'}
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      bgcolor: selectedDevice.status === 'connected' ? 'success.main' : 'text.disabled',
                      flexShrink: 0,
                    }}
                  />
                </Tooltip>
              )}
            </Box>
          </Toolbar>
        </AppBar>

        <Box
          component="main"
          id="main-content"
          tabIndex={-1}
          className={`main-content ${isMobile && selectedDevice && !networkBlocked ? 'main-content-mobile' : ''}`}
        >
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              flexGrow: 1,
              width: '100%',
            }}
          >
            {mainContent}
          </Box>
        </Box>

        {isMobile && selectedDevice && !networkBlocked && (
          <Box component="nav" aria-label="bottom navigation">
            <BottomNavBar view={mobileView} setView={setMobileView} />
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default App;
