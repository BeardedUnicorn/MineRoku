import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import Sidebar from './components/Sidebar';
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
import MenuIcon from '@mui/icons-material/Menu';
import RefreshIcon from '@mui/icons-material/Refresh';
import BottomNavBar from './components/BottomNavBar';
import './App.css';
import { useAppStore, type RokuDevice } from './store';
import { shallow } from 'zustand/shallow';
import { usePlatform } from './hooks/usePlatform';
import {
  checkDeviceConnectivity,
  discoverRokuDevices,
  getCachedDevices,
  type RokuDeviceEvent,
  updateMediaNotification,
} from './services/rokuClient';

const LazyAppLauncher = lazy(() => import('./components/AppLauncher'));

const CONNECTIVITY_POLL_INTERVAL = 10000;

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
    (s) => ({
      selectedDevice: s.selectedDevice,
      devices: s.devices,
      addDiscoveredDevices: s.addDiscoveredDevices,
      setSelectedDevice: s.setSelectedDevice,
      upsertDevice: s.upsertDevice,
      markDeviceDisconnected: s.markDeviceDisconnected,
      updateDeviceStatus: s.updateDeviceStatus,
    }),
    shallow
  );

  const [isSearching, setIsSearching] = useState(true);
  const [devicesFound, setDevicesFound] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [mobileView, setMobileView] = useState<'remote' | 'apps'>('remote');
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState('');
  const scanPromiseRef = useRef<Promise<void> | null>(null);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const currentPlatform = usePlatform();

  useEffect(() => {
    setIsSidebarOpen(!isMobile);
  }, [isMobile]);

  useEffect(() => {
    if (!selectedDevice) {
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
      void checkConnectivity();
    }, CONNECTIVITY_POLL_INTERVAL);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [selectedDevice?.hardware_id, selectedDevice?.ip, selectedDevice?.port, updateDeviceStatus]);

  useEffect(() => {
    if (currentPlatform !== 'android' || !selectedDevice) {
      return;
    }

    void updateMediaNotification({
      deviceName: selectedDevice.name,
      deviceIp: selectedDevice.ip,
      devicePort: selectedDevice.port,
      appName: 'Roku Remote',
      isPlaying: false,
    }).catch((error) => {
      console.log('Media notification update not available:', error);
    });
  }, [
    currentPlatform,
    selectedDevice?.hardware_id,
    selectedDevice?.name,
    selectedDevice?.ip,
    selectedDevice?.port,
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
      setScanStatus('Scanning network...');

      try {
        const foundDevices = await discoverRokuDevices();
        const devicesWithStatus: RokuDevice[] = foundDevices.map((device) => ({
          ...device,
          status: 'connected',
        }));

        addDiscoveredDevices(devicesWithStatus);

        const discoveredIds = new Set(foundDevices.map((device) => device.hardware_id));
        const state = useAppStore.getState();

        state.devices.forEach((device) => {
          if (!discoveredIds.has(device.hardware_id)) {
            markDeviceDisconnected(device.hardware_id);
          }
        });

        const anyDevicesFound = foundDevices.length > 0;
        setDevicesFound(anyDevicesFound);
        setScanStatus(
          anyDevicesFound ? `Found ${foundDevices.length} device(s)` : 'No devices found'
        );

        if (!state.selectedDevice && anyDevicesFound) {
          setSelectedDevice({ ...foundDevices[0], status: 'connected' });
        }
      } catch (error) {
        console.error('Discovery error:', error);
        setScanStatus(`Error: ${error}`);
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
  }, [addDiscoveredDevices, markDeviceDisconnected, setSelectedDevice]);

  useEffect(() => {
    let active = true;
    let unsubs: Array<() => void> = [];

    const bootstrapCachedDevices = async () => {
      try {
        const cached = await getCachedDevices();
        if (!active || cached.length === 0) {
          return;
        }

        cached.forEach((device) => upsertDevice({ ...device, status: 'disconnected' }));

        const state = useAppStore.getState();
        if (state.preferLastUsed && !state.selectedDevice) {
          setSelectedDevice({ ...cached[0], status: 'disconnected' });
        }
      } catch (error) {
        console.warn('Failed to load cached devices', error);
      }
    };

    const initListeners = async () => {
      try {
        const [u1, u2, u3, u4] = await Promise.all([
          listen('discovery_cycle_start', () => {
            setIsScanning(true);
            setIsSearching(true);
          }),
          listen('discovery_cycle_end', () => {
            setIsScanning(false);
            setIsSearching(false);
          }),
          listen<RokuDeviceEvent>('device_discovered', (event) => {
            const device = event.payload;
            upsertDevice({ ...device, status: 'connected' });
            setDevicesFound(true);

            const state = useAppStore.getState();
            if (!state.selectedDevice) {
              if (!state.preferLastUsed) {
                setSelectedDevice({ ...device, status: 'connected' });
              }
              return;
            }

            if (
              !state.preferLastUsed &&
              state.selectedDevice.status === 'disconnected' &&
              state.selectedDevice.hardware_id !== device.hardware_id
            ) {
              setSelectedDevice({ ...device, status: 'connected' });
            }
          }),
          listen<RokuDeviceEvent>('device_lost', (event) => {
            markDeviceDisconnected(event.payload.hardware_id);
          }),
        ]);

        if (!active) {
          u1();
          u2();
          u3();
          u4();
          return;
        }

        unsubs = [u1, u2, u3, u4];
      } catch (error) {
        console.error('Failed to initialize discovery listeners:', error);
      }
    };

    void Promise.all([bootstrapCachedDevices(), initListeners()]);
    void scanForDevices();

    return () => {
      active = false;
      unsubs.forEach((unsub) => unsub());
    };
  }, [scanForDevices, upsertDevice, markDeviceDisconnected, setSelectedDevice]);

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
            <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 1 }}>
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

    const hasAnyDevices = devices.length > 0 || devicesFound;

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
        >
          <CircularProgress />
          <Typography variant="h6" color="text.secondary">
            Searching for Roku devices...
          </Typography>
          {scanStatus && (
            <Typography variant="body2" color="text.secondary">
              {scanStatus}
            </Typography>
          )}
        </Box>
      );
    }

    if (!hasAnyDevices) {
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
          <Typography variant="h6" color="text.secondary">
            No Roku Devices Found
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
            Please ensure your Roku is powered on and connected to the same WiFi network. Tap
            refresh to scan again.
          </Typography>
          {scanStatus && (
            <Typography variant="body2" color="error" sx={{ mt: 1 }}>
              {scanStatus}
            </Typography>
          )}
          <Button
            variant="contained"
            startIcon={isScanning ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />}
            sx={{ mt: 2 }}
            onClick={scanForDevices}
            disabled={isScanning}
          >
            {isScanning ? 'Scanning...' : 'Refresh'}
          </Button>
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
        <Typography variant="h6" color="text.secondary">
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
    devices.length,
    devicesFound,
    isSearching,
    scanStatus,
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
          }}
        >
          <Toolbar>
            <IconButton edge="start" color="inherit" aria-label="menu" onClick={handleToggleSidebar} sx={{ mr: 2 }}>
              <MenuIcon />
            </IconButton>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexGrow: 1 }}>
              <Typography variant="h6" component="div" sx={{ color: 'primary.main', fontWeight: 'bold' }}>
                {selectedDevice ? selectedDevice.name : 'Roku Remote'}
              </Typography>
              {selectedDevice && (
                <Tooltip title={selectedDevice.status === 'connected' ? 'Online' : 'Offline'}>
                  <Box
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

        <Box component="main" className={`main-content ${isMobile && selectedDevice ? 'main-content-mobile' : ''}`}>
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

        {isMobile && selectedDevice && (
          <Box component="nav" aria-label="bottom navigation">
            <BottomNavBar view={mobileView} setView={setMobileView} />
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default App;
