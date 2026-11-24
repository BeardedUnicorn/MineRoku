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
  Portal,
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
  hapticTap,
  openAndroidAppSettings,
  POWER_TOGGLE_COMMAND,
  sendRokuCommand,
  toggleRokuPower,
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

// Presses wait their turn instead of being dropped, up to this many.
const MAX_QUEUED_COMMANDS = 8;

// Asked once per app run: a denial must not re-prompt on every app or playback change.
let notificationPermission: 'unknown' | 'granted' | 'denied' = 'unknown';

/** Test hook: forget the remembered notification-permission answer. */
export const resetNotificationPermissionForTests = () => {
  notificationPermission = 'unknown';
};

// Keys that activate the focused control natively. Sending a remote command as well would fire
// two commands for one key press.
const isInteractiveTarget = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return Boolean(
    el?.closest?.('button, a[href], select, summary, [role="button"], [role="tab"], [role="combobox"], [role="switch"]')
  );
};

const isEditableTarget = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || el.isContentEditable) return true;
  return el.getAttribute?.('role') === 'textbox';
};

// An open dialog or menu owns the keyboard (Escape closes it, arrows move within it).
const isOverlayOpen = () =>
  document.querySelector('[role="dialog"], [role="listbox"], [role="menu"]') !== null;


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
  // Mounted on first open and kept, so the dialog's close animation can play.
  const [mediaModalMounted, setMediaModalMounted] = useState(false);
  const [resumeCount, setResumeCount] = useState(0);
  const lastDeviceKeyRef = useRef<string | null>(null);
  const commandQueueRef = useRef<Promise<void>>(Promise.resolve());
  const queuedCommandsRef = useRef(0);
  const queueGenerationRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const deviceStatusRef = useRef<RokuDevice['status']>(device.status);
  const remoteStyle = useAppStore((s) => s.remoteStyle);
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'));
  // The 300px phone D-pad needs 300 + 52 (page gutters) + 4 (card border) to avoid clipping.
  const fitsPhoneDpad = useMediaQuery('(min-width:356px)');
  const currentPlatform = usePlatform();
  const isConnected = device.status === 'connected';
  const activeAppIcon = useActiveAppIcon(device, activeApp);
  const dpadMetrics = useMemo(
    () => getDpadMetrics(isPhone && fitsPhoneDpad),
    [isPhone, fitsPhoneDpad]
  );
  const dpadSize = useMemo(() => getDpadSize(dpadMetrics), [dpadMetrics]);
  const styleTokens = useMemo(
    () => getRemoteStyleTokens(remoteStyle, theme),
    [remoteStyle, theme]
  );

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
    // isConnected: a device that was offline at mount is fetched as soon as it comes back.
  }, [device.hardware_id, device.ip, device.port, isConnected]);

  useEffect(() => {
    let intervalId: number | undefined;
    let inFlight = false;

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

    // A slow device must not pile up overlapping requests.
    const fetchAll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        await Promise.all([fetchActiveApp(), fetchMediaInfo()]);
      } finally {
        inFlight = false;
      }
    };

    const startPolling = (refreshNow: boolean) => {
      if (intervalId) return;
      if (refreshNow) {
        // Coming back to the app: do not show stale state until the next tick.
        void fetchAll();
      }
      intervalId = window.setInterval(fetchAll, 2000);
    };

    const stopPolling = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = undefined;
      }
    };

    // Desktop pauses while another window has focus. A phone WebView reports no focus until the
    // first touch, so requiring it there delayed the first poll and made the progress bar and
    // active app appear under the user's first tap; on touch platforms only visibility counts.
    const requireFocus = currentPlatform !== 'android' && currentPlatform !== 'ios';
    const canPoll = () =>
      document.visibilityState === 'visible' && (!requireFocus || document.hasFocus());

    const onFocus = () => {
      startPolling(true);
    };

    const onBlur = () => {
      if (requireFocus) {
        stopPolling();
      }
    };

    const onVisibilityChange = () => {
      if (canPoll()) {
        startPolling(true);
        setResumeCount((count) => count + 1);
      } else {
        stopPolling();
      }
    };

    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);

    if (canPoll()) {
      // Fetch straight away: media state only arrives through this poll.
      startPolling(true);
    }

    return () => {
      stopPolling();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [device.hardware_id, device.ip, device.port, currentPlatform]);

  // Commands go out one at a time, in the order pressed. Rapid presses (scrolling a list on the
  // TV) queue up instead of being dropped; a failure discards whatever is still waiting so a
  // dead device does not produce a string of timeouts.
  const sendCommand = useCallback(
    (command: string) => {
      if (currentPlatform === 'android') {
        hapticTap();
      }
      if (queuedCommandsRef.current >= MAX_QUEUED_COMMANDS) {
        return;
      }

      queuedCommandsRef.current += 1;
      const generation = queueGenerationRef.current;
      commandQueueRef.current = commandQueueRef.current.then(async () => {
        try {
          if (generation !== queueGenerationRef.current) {
            return;
          }
          if (command === POWER_TOGGLE_COMMAND) {
            // On or off, whichever the TV isn't.
            await toggleRokuPower(device.ip, device.port);
          } else {
            await sendRokuCommand(device.ip, device.port, command);
          }
        } catch (error) {
          console.error(`Error sending command ${command}:`, error);
          queueGenerationRef.current += 1;
          setFeedback({
            message: `Error: ${String(error)}`,
            severity: 'error',
          });
        } finally {
          queuedCommandsRef.current -= 1;
        }
      });
    },
    [device.ip, device.port, currentPlatform]
  );

  useEffect(() => {
    // Until the platform is known, assume a touch device rather than hijack its keys.
    if (currentPlatform === null || currentPlatform === 'android' || currentPlatform === 'ios') {
      return;
    }

    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditableTarget(e.target) || isOverlayOpen()) return;

      const key = e.key.toLowerCase();
      if ((key === 'enter' || key === ' ') && isInteractiveTarget(e.target)) return;

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
          e.preventDefault();
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

    // The notification is only refreshed while the app is on screen. A poll that was in flight
    // when the app was backgrounded must not bring it back.
    if (document.visibilityState !== 'visible') return;

    const updateNotification = async () => {
      try {
        if (notificationPermission === 'denied') {
          return;
        }
        if (notificationPermission === 'unknown') {
          const hasPermission = await ensureAndroidNotificationPermission();
          notificationPermission = hasPermission ? 'granted' : 'denied';
          if (!hasPermission) {
            setShowSettingsAction(true);
            setFeedback({
              message: 'Allow notifications to get lock-screen controls for your Roku.',
              severity: 'error',
            });
            return;
          }
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
    resumeCount,
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
  const showProgress = Boolean(
    mediaInfo && !mediaInfo.is_live && duration > 0 && (mediaState === 'play' || mediaState === 'pause')
  );
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
        boxSizing: 'border-box',
        maxWidth: { xs: 422, sm: 390, md: 320 },
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
      {/* One fixed-height slot for the title or the offline notice, so the buttons below never
          move when the device drops off or comes back. */}
      <Box
        sx={{
          width: '100%',
          height: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {isConnected ? (
          <Typography
            variant="subtitle1"
            sx={{ fontWeight: 700, letterSpacing: 0.5, color: styleTokens.titleColor }}
          >
            Roku Remote
          </Typography>
        ) : (
          <Typography
            role="status"
            variant="body2"
            noWrap
            sx={{
              maxWidth: '100%',
              px: 1.5,
              py: 0.5,
              bgcolor: 'warning.light',
              color: 'warning.contrastText',
              borderRadius: 1,
              fontWeight: 500,
            }}
          >
            Device offline — reconnecting…
          </Typography>
        )}
      </Box>

      <Box sx={{ width: '100%' }}>
        <ButtonBase
          aria-label="Open Media Player Status"
          onClick={() => {
            setMediaModalMounted(true);
            setMediaModalOpen(true);
          }}
          sx={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1.5,
            minHeight: 48,
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
            <Typography variant="body2" color="textSecondary">
              Home Screen
            </Typography>
          )}
        </ButtonBase>

        {/* Always in the layout, only hidden when there is nothing to show: the remote keeps the
            size it has with the progress bar, so buttons do not jump under the user's thumb
            when playback starts or stops. */}
        <Box
          data-testid="remote-progress"
          aria-hidden={!showProgress}
          sx={{ mt: 1.5, visibility: showProgress ? 'visible' : 'hidden' }}
        >
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
      </Box>

      <Stack
        direction="row"
        spacing={2}
        sx={{ alignItems: 'center', justifyContent: 'center', width: '100%', mt: 1 }}
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
        data-testid="remote-dpad"
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

      <Stack direction="row" spacing={{ xs: 1, sm: 2 }} sx={{ justifyContent: 'center', alignItems: 'center', width: '100%', mt: 1 }} >
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

      <Stack direction="row" spacing={{ xs: 1, sm: 2 }} sx={{ justifyContent: 'center', alignItems: 'center', width: '100%' }} >
        {volumeButtons.map((b) => (
          <RemoteButton
            key={b.key}
            cmd={b.key}
            label={b.label}
            icon={b.icon}
            onSend={sendCommand}
            shortcut={b.shortcut}
            size={{ xs: 48, sm: 52 }}
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
              size={{ xs: 48, sm: 52 }}
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

      {mediaModalMounted && (
        <Suspense fallback={null}>
          <LazyMediaPlayerModal
            open={mediaModalOpen}
            onClose={() => setMediaModalOpen(false)}
            device={device}
          />
        </Suspense>
      )}

      {/* Portaled out of the card: the Glass style's backdrop-filter would otherwise make the card
          the containing block and clip the message. Raised above the bottom nav on phones. */}
      <Portal>
      <Snackbar
        open={!!feedback}
        autoHideDuration={4000}
        onClose={() => setFeedback(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ bottom: { xs: 'calc(88px + env(safe-area-inset-bottom))', md: 24 } }}
      >
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
      </Portal>
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
