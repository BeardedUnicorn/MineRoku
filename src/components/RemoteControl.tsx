import React, { lazy, Suspense, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Window } from "@tauri-apps/api/window";
import { iconCache, ICON_CACHE_TTL_MS, ICON_CACHE_LIMIT } from '../iconCache';
import {
  Box,
  Paper,
  Typography,
  IconButton,
  Snackbar,
  Alert,
  useTheme,
  Tooltip,
  Stack,
  Divider,
  CircularProgress,
  LinearProgress,
} from '@mui/material';
import { motion, useReducedMotion } from 'framer-motion';
import {
  KeyboardArrowUp,
  KeyboardArrowDown,
  KeyboardArrowLeft,
  KeyboardArrowRight,
  RadioButtonChecked,
} from '@mui/icons-material';
import {
  CommandSpec,
  systemButtonSpecs,
  volumeButtonSpecs,
  playbackButtonSpecs,
  powerButtonSpecs,
} from './RemoteButtonSpecs';
import { RokuDevice } from '../store';
import { usePlatform } from '../hooks/usePlatform';
import {
  getActiveApp,
  getAppIcon,
  getMediaPlayer,
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
}) => {
  const theme = useTheme();
  const prefersReducedMotion = useReducedMotion();

  const contrast =
    color === 'primary'
      ? theme.palette.primary.contrastText
      : theme.palette.text.primary;

  const bg =
    variant === 'filled'
        ? `linear-gradient(145deg, ${theme.palette.primary.light}, ${theme.palette.primary.main})`
        : ring
        ? 'transparent'
        : theme.palette.background.paper;

  const ringStyle =
    ring && !center
      ? {
          border: `2px solid ${
            color === 'primary'
              ? theme.palette.primary.main
              : theme.palette.divider
          }`,
        }
      : {};

  const finalSize = typeof size === 'number' ? { xs: size, sm: size } : size;

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
              background: bg,
              color: contrast,
              boxShadow:
                variant === 'filled'
                  ? `0 6px 12px rgba(0,0,0,0.5), inset 0 1px 1px rgba(255,255,255,0.1)`
                  : 'none',
              transition: 'background .25s, box-shadow .25s',
              '&:hover': {
                background:
                  variant === 'filled'
                    ? `linear-gradient(145deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark})`
                    : theme.palette.action.hover,
              },
              '&:active': {
                boxShadow:
                  variant === 'filled'
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

const ARROW_SIZE = 64;
const CENTER_SIZE = 72;
const GAP = 12;
const DPAD_SIZE = CENTER_SIZE + ARROW_SIZE * 2 + GAP * 4;

const useActiveAppIcon = (device: RokuDevice, app: ActiveApp | null) => {
  const [icon, setIcon] = useState<string | null>(null);
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!app || app.id === 'roku') {
      setIcon(null);
      lastKeyRef.current = null;
      return;
    }

    const cacheKey = `${device.ip}:${app.id}`;
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
  const [activeApp, setActiveApp] = useState<ActiveApp | null>(null);
  const [isAppLoading, setIsAppLoading] = useState<boolean>(true);
  const [mediaInfo, setMediaInfo] = useState<MediaPlayerInfo | null>(null);
  const [mediaModalOpen, setMediaModalOpen] = useState(false);
  const lastDeviceKeyRef = useRef<string | null>(null);
  const busyRef = useRef<Set<string>>(new Set());
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentPlatform = usePlatform();
  const activeAppIcon = useActiveAppIcon(device, activeApp);

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
        if (device.status && device.status !== 'connected') {
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
  }, [device.hardware_id, device.ip, device.port, device.status]);

  useEffect(() => {
    let intervalId: number | undefined;

    const fetchActiveApp = async () => {
      if (device.status && device.status !== 'connected') {
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
      if (device.status && device.status !== 'connected') {
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

    const unlistenFocusPromise = Window.getCurrent().onFocusChanged(({ payload: focused }: { payload: boolean }) => {
      if (focused) {
        startPolling();
      } else {
        stopPolling();
      }
    });

    Window.getCurrent().isFocused().then((focused: boolean) => {
        if (focused) {
            startPolling();
        }
    });

    return () => {
      stopPolling();
      unlistenFocusPromise.then((unlisten: () => void) => unlisten());
    };
  }, [device.hardware_id, device.ip, device.port, device.status]);

  const sendCommand = useCallback(
    async (command: string) => {
      if (device.status && device.status !== 'connected') {
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
    [device.ip, device.port, device.status]
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
        const iconUrl =
          activeApp.id !== 'roku'
            ? `http://${device.ip}:${device.port}/query/icon/${activeApp.id}`
            : undefined;
        const mediaState = mediaInfo?.state?.toLowerCase();
        const playing = mediaState === 'play' || mediaState === 'playing';

        await updateMediaNotification({
          deviceName: device.name,
          deviceIp: device.ip,
          devicePort: device.port,
          appName: activeApp.name,
          isPlaying: playing,
          appIconUrl: iconUrl,
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
  const baseBackground = `linear-gradient(145deg, ${theme.palette.background.paper}, ${theme.palette.background.default})`;
  const remoteBackground = activeAppIcon
    ? `linear-gradient(145deg, rgba(12,12,12,0.7), rgba(12,12,12,0.92)), url(${activeAppIcon})`
    : baseBackground;

  return (
    <Paper
      elevation={8}
      sx={{
        mx: 'auto',
        width: '100%',
        maxWidth: 320,
        borderRadius: '42px',
        px: { xs: 2, sm: 3 },
        py: { xs: 3, sm: 4 },
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: { xs: 1.5, sm: 2 },
        backgroundImage: remoteBackground,
        backgroundSize: activeAppIcon ? 'cover' : 'auto',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        boxShadow: `
          inset 0 1px 2px rgba(255,255,255,0.06),
          0 6px 18px rgba(0,0,0,0.6)
        `,
      }}
    >
      <Typography
        variant="subtitle1"
        sx={{ fontWeight: 600, letterSpacing: 0.5 }}
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
        <Box sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1.5,
          minHeight: 40,
          px: 2,
          py: 1,
          borderRadius: 2,
          backgroundColor: 'action.hover',
          cursor: 'pointer',
          transition: 'background-color 0.2s',
          '&:hover': {
            backgroundColor: 'action.selected',
          }
        }}
          onClick={() => setMediaModalOpen(true)}
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
        </Box>

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
          />
        ))}
      </Stack>

      <Box
        sx={{
          position: 'relative',
          width: DPAD_SIZE,
          height: DPAD_SIZE,
          mt: 1
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: `radial-gradient(circle at 30% 30%, ${theme.palette.grey[900]} 0%, ${theme.palette.grey[800]} 60%, ${theme.palette.grey[900]} 100%)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow:
              '0 4px 10px rgba(0,0,0,0.6), inset 0 2px 4px rgba(255,255,255,0.05)',
          }}
        >
          <Box
            sx={{
              position: 'relative',
              width: '100%',
              height: '100%',
            }}
          >
            <Box sx={{ position: 'absolute', top: GAP, left: '50%', transform: 'translateX(-50%)' }}>
              <RemoteButton cmd="up" label="Up" icon={<KeyboardArrowUp />} onSend={sendCommand} ring shortcut="↑" size={ARROW_SIZE} />
            </Box>
            <Box sx={{ position: 'absolute', bottom: GAP, left: '50%', transform: 'translateX(-50%)' }}>
              <RemoteButton cmd="down" label="Down" icon={<KeyboardArrowDown />} onSend={sendCommand} ring shortcut="↓" size={ARROW_SIZE} />
            </Box>
            <Box sx={{ position: 'absolute', left: GAP, top: '50%', transform: 'translateY(-50%)' }}>
              <RemoteButton cmd="left" label="Left" icon={<KeyboardArrowLeft />} onSend={sendCommand} ring shortcut="←" size={ARROW_SIZE} />
            </Box>
            <Box sx={{ position: 'absolute', right: GAP, top: '50%', transform: 'translateY(-50%)' }}>
              <RemoteButton cmd="right" label="Right" icon={<KeyboardArrowRight />} onSend={sendCommand} ring shortcut="→" size={ARROW_SIZE} />
            </Box>
            <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>
              <RemoteButton
                cmd="select"
                label="Select / OK"
                icon={<RadioButtonChecked />}
                onSend={sendCommand}
                variant="filled"
                color="primary"
                shortcut="Enter"
                size={CENTER_SIZE}
                center
              />
            </Box>
          </Box>
        </Box>
      </Box>

      <Stack direction="row" spacing={{ xs: 1, sm: 2 }} justifyContent="center" alignItems="center" sx={{ width: '100%', mt: 1 }} >
        {playbackButtons.map((b) => (
          <RemoteButton key={b.key} cmd={b.key} label={b.label} icon={b.icon} onSend={sendCommand} shortcut={b.shortcut} size={{ xs: 48, sm: 56 }} currentPlatform={currentPlatform} />
        ))}
      </Stack>

      <Divider flexItem variant="middle" sx={{ opacity: 0.3, width: '80%', my: 1 }} />

      <Stack direction="row" spacing={{ xs: 1, sm: 2 }} justifyContent="center" alignItems="center" sx={{ width: '100%' }} >
        {volumeButtons.map((b) => (
          <RemoteButton key={b.key} cmd={b.key} label={b.label} icon={b.icon} onSend={sendCommand} shortcut={b.shortcut} size={{ xs: 44, sm: 52 }} currentPlatform={currentPlatform} />
        ))}
        {powerButtons.map((b) => (
            <RemoteButton key={b.key} cmd={b.key} label={b.label} icon={b.icon} onSend={sendCommand} size={{ xs: 44, sm: 52 }} color="error" />
        ))}
      </Stack>

      {currentPlatform !== 'android' && currentPlatform !== 'ios' && (
        <Typography variant="caption" sx={{ opacity: 0.6, textAlign: 'center', mt: 1, maxWidth: 260 }} >
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
        <Alert onClose={() => setFeedback(null)} severity={feedback?.severity} sx={{ width: '100%' }} >
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
