import React, { lazy, Suspense, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { iconCache, ICON_CACHE_TTL_MS, ICON_CACHE_LIMIT } from '../iconCache';
import {
  Button,
  ButtonBase,
  Box,
  Paper,
  Typography,
  IconButton,
  Snackbar,
  Alert,
  useTheme,
  useMediaQuery,
  Tooltip,
  Stack,
  Divider,
  CircularProgress,
  LinearProgress,
} from '@mui/material';
import { motion, useReducedMotion } from 'framer-motion';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowLeftIcon from '@mui/icons-material/KeyboardArrowLeft';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import RadioButtonCheckedIcon from '@mui/icons-material/RadioButtonChecked';
import {
  CommandSpec,
  systemButtonSpecs,
  volumeButtonSpecs,
  playbackButtonSpecs,
  powerButtonSpecs,
} from './RemoteButtonSpecs';
import { RokuDevice, useAppStore } from '../store';
import { usePlatform } from '../hooks/usePlatform';
import {
  getDpadMetrics,
  getDpadSize,
  getRemoteStyleTokens,
  type RemoteStyleTokens,
} from './remoteStyleTokens';
import {
  ensureAndroidNotificationPermission,
  getActiveApp,
  getAppIcon,
  getMediaPlayer,
  openAndroidAppSettings,
  sendRokuCommand,
  updateMediaNotification,
  type ActiveAppInfo,
  type MediaPlayerInfo,
} from '../services/rokuClient';

const LazyMediaPlayerModal = lazy(() => import('./MediaPlayerModal'));

type ActiveApp = ActiveAppInfo;

interface RemoteControlProps {
  device: RokuDevice;
}

type FeedbackState = { message: string; severity: 'success' | 'error' } | null;


interface RemoteButtonProps {
  cmd: string;
  label: string;
  icon: React.ReactNode;
  color?: 'default' | 'primary' | 'info' | 'warning' | 'error';
  variant?: 'flat' | 'filled';
  onSend: (cmd: string) => void;
  size?: number | { xs: number; sm: number };
  ring?: boolean;
  center?: boolean;
  shortcut?: string;
  currentPlatform?: string | null;
  styleTokens: RemoteStyleTokens;
}

const RemoteButton: React.FC<RemoteButtonProps> = ({
  cmd,
  label,
  icon,
  onSend,
  size = 56,
  ring = false,
  center = false,
  color = 'default',
  variant = 'flat',
  shortcut,
  currentPlatform,
  styleTokens,
}) => {
  const theme = useTheme();
  const prefersReducedMotion = useReducedMotion();
  const isFilled = variant === 'filled';
  const isError = color === 'error';

  const ringStyle =
    ring && !center
      ? {
          border: `2px solid ${
            color === 'primary'
              ? theme.palette.primary.main
              : color === 'error'
              ? theme.palette.error.main
              : styleTokens.ringBorderColor
          }`,
        }
      : {};

  const finalSize = typeof size === 'number' ? { xs: size, sm: size } : size;
  const iconScale = center ? 0.42 : 0.4;
  const iconFontSize = {
    xs: Math.max(20, Math.round(finalSize.xs * iconScale)),
    sm: Math.max(20, Math.round(finalSize.sm * iconScale)),
  };

  const contrast = isFilled
    ? styleTokens.centerButtonColor
    : isError
    ? theme.palette.error.contrastText
    : styleTokens.flatButtonColor;

  const background = isFilled
    ? styleTokens.centerButtonBackground
    : ring
    ? 'transparent'
    : isError
    ? theme.palette.error.dark
    : styleTokens.flatButtonBackground;

  const hoverBackground = isFilled
    ? styleTokens.centerButtonHoverBackground
    : isError
    ? theme.palette.error.main
    : styleTokens.flatButtonHoverBackground;

  return (
    <motion.div
      whileHover={prefersReducedMotion ? undefined : { scale: 1.08 }}
      whileTap={prefersReducedMotion ? undefined : { scale: 0.92 }}
      style={{ display: 'inline-flex' }}
    >
      <Tooltip
        arrow
        title={
          shortcut && currentPlatform !== 'android' && currentPlatform !== 'ios' ? (
            <Box component="span">
              {label} <Box component="span" sx={{ opacity: 0.6 }}>({shortcut})</Box>
            </Box>
          ) : (
            label
          )
        }
      >
        <IconButton
          aria-label={label}
          onClick={() => onSend(cmd)}
          sx={{
            width: finalSize,
            height: finalSize,
            borderRadius: '50%',
            background,
            color: contrast,
            boxShadow: isFilled ? styleTokens.centerButtonShadow : 'none',
            transition: 'background .25s, box-shadow .25s',
            touchAction: 'manipulation',
            '& .MuiSvgIcon-root': {
              fontSize: iconFontSize,
            },
            '&:hover': {
              background: hoverBackground,
            },
            '&:active': {
              boxShadow: isFilled
                ? `0 2px 5px rgba(0,0,0,0.7) inset, 0 1px 2px rgba(0,0,0,0.3)`
                : 'none',
            },
            ...ringStyle,
          }}
        >
          {icon}
        </IconButton>
      </Tooltip>
    </motion.div>
  );
};

const useActiveAppIcon = (device: RokuDevice, app: ActiveApp | null) => {
  const [icon, setIcon] = useState<string | null>(null);
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!app || app.id === 'roku') {
      setIcon(null);
      lastKeyRef.current = null;
      return;
    }

    const cacheKey = `${device.ip}:${device.port}:${app.id}`;
    if (lastKeyRef.current === cacheKey) return;

    const cached = iconCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < ICON_CACHE_TTL_MS) {
      setIcon(cached.data);
      lastKeyRef.current = cacheKey;
      return;
    } else if (cached) {
      iconCache.delete(cacheKey);
    }

    let cancelled = false;
    setIcon(null);

    const loadIcon = async () => {
      try {
        const iconData = await getAppIcon(device.ip, device.port, app.id);
        if (cancelled) return;
        iconCache.set(cacheKey, { data: iconData, timestamp: Date.now() });
        if (iconCache.size > ICON_CACHE_LIMIT) {
          const oldestKey = iconCache.keys().next().value as string;
          iconCache.delete(oldestKey);
        }
        setIcon(iconData);
        lastKeyRef.current = cacheKey;
      } catch (error) {
        if (!cancelled) {
          console.error(`Error fetching icon for ${app.name}:`, error);
        }
      }
    };

    loadIcon();
    return () => {
      cancelled = true;
    };
  }, [device.ip, device.port, app?.id]);

  return icon;
};

const ActiveAppIcon: React.FC<{ app: ActiveApp; icon: string | null }> = ({ app, icon }) => {
  if (app.id === 'roku' || !icon) return null;

  return (
    <Box
      component="img"
      src={icon}
      sx={{ width: 24, height: 24, borderRadius: 1 }}
      alt={`${app.name} icon`}
    />
  );
};

const RemoteControl: React.FC<RemoteControlProps> = ({ device }) => {
  const theme = useTheme();
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [showSettingsAction, setShowSettingsAction] = useState(false);
  const [activeApp, setActiveApp] = useState<ActiveApp | null>(null);
  const [isAppLoading, setIsAppLoading] = useState<boolean>(true);
  const [mediaInfo, setMediaInfo] = useState<MediaPlayerInfo | null>(null);
  const [mediaModalOpen, setMediaModalOpen] = useState(false);
  const lastDeviceKeyRef = useRef<string | null>(null);
  const busyRef = useRef<Set<string>>(new Set());
  const abortControllerRef = useRef<AbortController | null>(null);
  const deviceStatusRef = useRef<RokuDevice['status']>(device.status);
  const remoteStyle = useAppStore((s) => s.remoteStyle);
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'));
  const currentPlatform = usePlatform();
  const notificationPermissionReadyRef = useRef(currentPlatform !== 'android');
  const activeAppIcon = useActiveAppIcon(device, activeApp);
  const dpadMetrics = useMemo(() => getDpadMetrics(isPhone), [isPhone]);
  const dpadSize = useMemo(() => getDpadSize(dpadMetrics), [dpadMetrics]);
  const styleTokens = useMemo(
    () => getRemoteStyleTokens(remoteStyle, theme),
    [remoteStyle, theme]
  );

  useEffect(() => {
    notificationPermissionReadyRef.current = currentPlatform !== 'android';
  }, [currentPlatform]);

  useEffect(() => {
    deviceStatusRef.current = device.status;
  }, [device.status]);

  const parseTime = (timeStr?: string): number => {
    if (!timeStr) return 0;
    const match = timeStr.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  };

  const formatTime = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    const currentKey = `${device.hardware_id}`;
    const isSameDevice = lastDeviceKeyRef.current === currentKey;
    lastDeviceKeyRef.current = currentKey;

    const initialFetch = async () => {
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      if (!isSameDevice) {
        setIsAppLoading(true);
      }

      const timeoutId = window.setTimeout(() => {
        if (!abortController.signal.aborted) {
          setIsAppLoading(false);
        }
      }, 6500);

      try {
        if (deviceStatusRef.current && deviceStatusRef.current !== 'connected') {
          setActiveApp(null);
          setMediaInfo(null);
          return;
        }
        
        const appInfo = await getActiveApp(device.ip, device.port);
        
        if (abortController.signal.aborted) {
          return;
        }
        
        setActiveApp(appInfo);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }
        
        console.error('Could not fetch active app on initial load:', error);
        const fallbackApp = { name: 'Home Screen', id: 'roku' };
        setActiveApp(fallbackApp);
        setFeedback({ 
          message: `Could not fetch active app: ${error}`, 
          severity: 'error' 
        });
      } finally {
        clearTimeout(timeoutId);
        if (!abortController.signal.aborted) {
          setIsAppLoading(false);
        }
      }
    };

    initialFetch();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [device.hardware_id, device.ip, device.port]);

  useEffect(() => {
    let intervalId: number | undefined;

    const fetchActiveApp = async () => {
      if (deviceStatusRef.current && deviceStatusRef.current !== 'connected') {
        return;
      }
      try {
        const appInfo = await getActiveApp(device.ip, device.port);
        setActiveApp(appInfo);
      } catch {
        // Ignore errors during polling
      }
    };

    const fetchMediaInfo = async () => {
      if (deviceStatusRef.current && deviceStatusRef.current !== 'connected') {
        setMediaInfo(null);
        return;
      }
      try {
        const info = await getMediaPlayer(device.ip, device.port);
        setMediaInfo(info);
      } catch {
        setMediaInfo(null);
      }
    };

    const fetchAll = async () => {
      await Promise.all([fetchActiveApp(), fetchMediaInfo()]);
    };

    const startPolling = () => {
      if (intervalId) return;
      intervalId = window.setInterval(fetchAll, 2000);
    };

    const stopPolling = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = undefined;
      }
    };

    const onFocus = () => {
      startPolling();
    };

    const onBlur = () => {
      stopPolling();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && document.hasFocus()) {
        startPolling();
      } else {
        stopPolling();
      }
    };

    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);

    if (document.visibilityState === 'visible' && document.hasFocus()) {
      startPolling();
    }

    return () => {
      stopPolling();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [device.hardware_id, device.ip, device.port]);

  const sendCommand = useCallback(
    async (command: string) => {
      if (deviceStatusRef.current && deviceStatusRef.current !== 'connected') {
        setFeedback({ message: 'Device appears offline', severity: 'error' });
        return;
      }
      if (busyRef.current.has(command)) return;
      busyRef.current.add(command);
      try {
        await sendRokuCommand(device.ip, device.port, command);
      } catch (error) {
        console.error(`Error sending command ${command}:`, error);
        setFeedback({
          message: `Error: ${String(error)}`,
          severity: 'error',
        });
      } finally {
        busyRef.current.delete(command);
      }
    },
    [device.ip, device.port]
  );

  useEffect(() => {
    if (currentPlatform === 'android' || currentPlatform === 'ios') {
        return;
    }

    const isEditableTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || el.isContentEditable) return true;
      if (el.getAttribute?.('role') === 'textbox') return true;
      return false;
    };

    const handler = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const key = e.key.toLowerCase();
      switch (key) {
        case 'arrowup':
          e.preventDefault();
          sendCommand('up');
          break;
        case 'arrowdown':
          e.preventDefault();
          sendCommand('down');
          break;
        case 'arrowleft':
          e.preventDefault();
          sendCommand('left');
          break;
        case 'arrowright':
          e.preventDefault();
          sendCommand('right');
          break;
        case 'enter':
          sendCommand('select');
          break;
        case ' ':
          e.preventDefault();
          sendCommand('play');
          break;
        case 'backspace':
        case 'escape':
          sendCommand('back');
          break;
        case 'h':
          sendCommand('home');
          break;
        case 'i':
          sendCommand('info');
          break;
        case 'm':
          sendCommand('VolumeMute');
          break;
        case '+':
        case '=':
          sendCommand('VolumeUp');
          break;
        case '-':
        case '_':
          sendCommand('VolumeDown');
          break;
        default:
          return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [sendCommand, currentPlatform]);

  // Update Android media notification when app/media state changes
  useEffect(() => {
    if (currentPlatform !== 'android' || !activeApp) return;

    const updateNotification = async () => {
      try {
        if (!notificationPermissionReadyRef.current) {
          const hasPermission = await ensureAndroidNotificationPermission();
          if (!hasPermission) {
            setShowSettingsAction(true);
            setFeedback({
              message:
                'Notification permission is required for lock-screen controls. Grant permission and retry.',
              severity: 'error',
            });
            return;
          }
          notificationPermissionReadyRef.current = true;
          setShowSettingsAction(false);
        }

        const mediaState = mediaInfo?.state?.toLowerCase();
        const playing = mediaState === 'play' || mediaState === 'playing';

        await updateMediaNotification({
          deviceName: device.name,
          deviceIp: device.ip,
          devicePort: device.port,
          appName: activeApp.name,
          appId: activeApp.id === 'roku' ? undefined : activeApp.id,
          isPlaying: playing,
        });
      } catch (error) {
        console.log('Failed to update media notification:', error);
      }
    };

    void updateNotification();
  }, [
    currentPlatform,
    device.name,
    device.ip,
    device.port,
    activeApp?.id,
    activeApp?.name,
    mediaInfo?.state,
  ]);

  const systemButtons = useMemo<CommandSpec[]>(() => systemButtonSpecs, []);
  const volumeButtons = useMemo<CommandSpec[]>(() => volumeButtonSpecs, []);
  const playbackButtons = useMemo<CommandSpec[]>(() => playbackButtonSpecs, []);
  const powerButtons = useMemo<CommandSpec[]>(() => powerButtonSpecs, []);

  const position = parseTime(mediaInfo?.position);
  const duration = parseTime(mediaInfo?.duration);
  const progress = duration > 0 ? (position / duration) * 100 : 0;
  const mediaState = mediaInfo?.state?.toLowerCase() ?? '';
  const isPlaying = mediaState === 'play' || mediaState === 'playing';
  const showProgress = mediaInfo && !mediaInfo.is_live && duration > 0 && (mediaState === 'play' || mediaState === 'pause');
  const remoteBackground = activeAppIcon
    ? `${styleTokens.activeAppOverlay}, url(${activeAppIcon})`
    : styleTokens.cardBackground;

  return (
    <Paper
      elevation={8}
      data-testid="remote-control-shell"
      data-remote-style={remoteStyle}
      sx={{
        mx: 'auto',
        width: '100%',
        maxWidth: { xs: 380, sm: 340, md: 320 },
        borderRadius: '42px',
        px: { xs: 2.5, sm: 3 },
        py: { xs: 3, sm: 4 },
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: { xs: 1.5, sm: 2 },
        backgroundImage: remoteBackground,
        backgroundSize: activeAppIcon ? 'cover, cover' : 'auto',
        backgroundPosition: activeAppIcon ? 'center, center' : 'center',
        backgroundRepeat: activeAppIcon ? 'no-repeat, no-repeat' : 'no-repeat',
        backgroundClip: 'padding-box',
        border: styleTokens.cardBorder,
        backdropFilter: styleTokens.cardBackdropFilter,
        boxShadow: styleTokens.cardShadow,
        overflow: 'hidden',
      }}
    >
      <Typography
        variant="subtitle1"
        sx={{ fontWeight: 700, letterSpacing: 0.5, color: styleTokens.titleColor }}
      >
        Roku Remote
      </Typography>

      {device.status && device.status !== 'connected' && (
        <Box sx={{
          width: '100%',
          bgcolor: 'warning.light',
          color: 'warning.contrastText',
          borderRadius: 1,
          mb: 1,
          p: 1,
          textAlign: 'center',
          fontWeight: 500,
        }}>
          Device offline — waiting for discovery
        </Box>
      )}

      <Box sx={{ width: '100%' }}>
        <ButtonBase
          aria-label="Open Media Player Status"
          onClick={() => setMediaModalOpen(true)}
          sx={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1.5,
            minHeight: 40,
            px: 2,
            py: 1,
            borderRadius: 2,
            backgroundColor: styleTokens.appPillBackground,
            transition: 'background-color 0.2s',
            touchAction: 'manipulation',
            '&:hover': {
              backgroundColor: styleTokens.appPillHoverBackground,
            },
          }}
        >
          {isAppLoading ? (
            <CircularProgress size={20} />
          ) : activeApp && activeApp.id !== 'roku' ? (
            <>
              <ActiveAppIcon app={activeApp} icon={activeAppIcon} />
              <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
                {activeApp.name}
              </Typography>
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Home Screen
            </Typography>
          )}
        </ButtonBase>

        {showProgress && (
          <Box sx={{mt: 1.5 }}>
            <LinearProgress
              variant="determinate"
              value={progress}
              sx={{
                height: 6,
                borderRadius: 1,
                backgroundColor: 'action.hover',
                '& .MuiLinearProgress-bar': {
                  backgroundColor: isPlaying ? 'primary.main' : 'text.secondary',
                  transition: 'width 0.5s ease-in-out',
                }
              }}
            />
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
              <Typography variant="caption" sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>
                {formatTime(position)}
              </Typography>
              <Typography variant="caption" sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>
                {formatTime(duration)}
              </Typography>
            </Box>
          </Box>
        )}
      </Box>

      <Stack
        direction="row"
        spacing={2}
        alignItems="center"
        justifyContent="center"
        sx={{ width: '100%', mt: 1 }}
      >
        {systemButtons.map((b) => (
          <RemoteButton
            key={b.key}
            cmd={b.key}
            label={b.label}
            icon={b.icon}
            onSend={sendCommand}
            shortcut={b.shortcut}
            size={{ xs: 48, sm: 56 }}
            currentPlatform={currentPlatform}
            styleTokens={styleTokens}
          />
        ))}
      </Stack>

      <Box
        sx={{
          position: 'relative',
          width: dpadSize,
          height: dpadSize,
          mt: 1
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: styleTokens.dpadBackground,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: styleTokens.dpadShadow,
          }}
        >
          <Box
            sx={{
              position: 'relative',
              width: '100%',
              height: '100%',
            }}
          >
            <Box sx={{ position: 'absolute', top: dpadMetrics.gap, left: '50%', transform: 'translateX(-50%)' }}>
              <RemoteButton
                cmd="up"
                label="Up"
                icon={<KeyboardArrowUpIcon />}
                onSend={sendCommand}
                ring
                shortcut="↑"
                size={dpadMetrics.arrowSize}
                styleTokens={styleTokens}
              />
            </Box>
            <Box sx={{ position: 'absolute', bottom: dpadMetrics.gap, left: '50%', transform: 'translateX(-50%)' }}>
              <RemoteButton
                cmd="down"
                label="Down"
                icon={<KeyboardArrowDownIcon />}
                onSend={sendCommand}
                ring
                shortcut="↓"
                size={dpadMetrics.arrowSize}
                styleTokens={styleTokens}
              />
            </Box>
            <Box sx={{ position: 'absolute', left: dpadMetrics.gap, top: '50%', transform: 'translateY(-50%)' }}>
              <RemoteButton
                cmd="left"
                label="Left"
                icon={<KeyboardArrowLeftIcon />}
                onSend={sendCommand}
                ring
                shortcut="←"
                size={dpadMetrics.arrowSize}
                styleTokens={styleTokens}
              />
            </Box>
            <Box sx={{ position: 'absolute', right: dpadMetrics.gap, top: '50%', transform: 'translateY(-50%)' }}>
              <RemoteButton
                cmd="right"
                label="Right"
                icon={<KeyboardArrowRightIcon />}
                onSend={sendCommand}
                ring
                shortcut="→"
                size={dpadMetrics.arrowSize}
                styleTokens={styleTokens}
              />
            </Box>
            <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>
              <RemoteButton
                cmd="select"
                label="Select / OK"
                icon={<RadioButtonCheckedIcon />}
                onSend={sendCommand}
                variant="filled"
                color="primary"
                shortcut="Enter"
                size={dpadMetrics.centerSize}
                center
                styleTokens={styleTokens}
              />
            </Box>
          </Box>
        </Box>
      </Box>

      <Stack direction="row" spacing={{ xs: 1, sm: 2 }} justifyContent="center" alignItems="center" sx={{ width: '100%', mt: 1 }} >
        {playbackButtons.map((b) => (
          <RemoteButton
            key={b.key}
            cmd={b.key}
            label={b.label}
            icon={b.icon}
            onSend={sendCommand}
            shortcut={b.shortcut}
            size={{ xs: 48, sm: 56 }}
            currentPlatform={currentPlatform}
            styleTokens={styleTokens}
          />
        ))}
      </Stack>

      <Divider flexItem variant="middle" sx={{ opacity: styleTokens.dividerOpacity, width: '80%', my: 1 }} />

      <Stack direction="row" spacing={{ xs: 1, sm: 2 }} justifyContent="center" alignItems="center" sx={{ width: '100%' }} >
        {volumeButtons.map((b) => (
          <RemoteButton
            key={b.key}
            cmd={b.key}
            label={b.label}
            icon={b.icon}
            onSend={sendCommand}
            shortcut={b.shortcut}
            size={{ xs: 44, sm: 52 }}
            currentPlatform={currentPlatform}
            styleTokens={styleTokens}
          />
        ))}
        {powerButtons.map((b) => (
            <RemoteButton
              key={b.key}
              cmd={b.key}
              label={b.label}
              icon={b.icon}
              onSend={sendCommand}
              size={{ xs: 44, sm: 52 }}
              color="error"
              styleTokens={styleTokens}
            />
        ))}
      </Stack>

      {currentPlatform !== 'android' && currentPlatform !== 'ios' && (
        <Typography variant="caption" sx={{ opacity: styleTokens.helperTextOpacity, textAlign: 'center', mt: 1, maxWidth: 260 }} >
          Use arrow keys, Enter, Space, +/-, and Backspace/Esc for keyboard control.
        </Typography>
      )}

      {mediaModalOpen && (
        <Suspense fallback={null}>
          <LazyMediaPlayerModal
            open={mediaModalOpen}
            onClose={() => setMediaModalOpen(false)}
            device={device}
          />
        </Suspense>
      )}

      <Snackbar open={!!feedback} autoHideDuration={3000} onClose={() => setFeedback(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} >
        <Alert
          onClose={() => setFeedback(null)}
          severity={feedback?.severity}
          sx={{ width: '100%' }}
          action={
            showSettingsAction ? (
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  void openAndroidAppSettings().catch((error) => {
                    console.error('Failed to open Android app settings:', error);
                  });
                }}
              >
                Settings
              </Button>
            ) : undefined
          }
        >
          {feedback?.message}
        </Alert>
      </Snackbar>
    </Paper>
  );
};

function devicesEqual(a: RokuDevice, b: RokuDevice) {
  return (
    a.hardware_id === b.hardware_id &&
    a.ip === b.ip &&
    a.port === b.port &&
    a.name === b.name &&
    a.url === b.url &&
    a.status === b.status
  );
}

export default React.memo(RemoteControl, (prev, next) => devicesEqual(prev.device, next.device));
