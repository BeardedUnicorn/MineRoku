import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Window } from "@tauri-apps/api/window";
import { platform } from "@tauri-apps/plugin-os";
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
import MediaPlayerModal from './MediaPlayerModal';

export interface RokuDevice {
  name: string;
  ip: string;
  port: number;
  url: string;
  status?: 'connected' | 'connecting' | 'disconnected';
}

interface ActiveApp {
  name: string;
  id: string;
}

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

const ActiveAppIcon: React.FC<{ device: RokuDevice; app: ActiveApp }> = ({ device, app }) => {
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

        const loadIcon = async () => {
            const cached = iconCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < ICON_CACHE_TTL_MS) {
                setIcon(cached.data);
                lastKeyRef.current = cacheKey;
                return;
            } else if (cached) {
                iconCache.delete(cacheKey);
            }

            setIcon(null);
            try {
                const iconData: string = await invoke('get_app_icon', { ip: device.ip, port: device.port, appId: app.id });
                iconCache.set(cacheKey, { data: iconData, timestamp: Date.now() });
                if (iconCache.size > ICON_CACHE_LIMIT) {
                    const oldestKey = iconCache.keys().next().value as string;
                    iconCache.delete(oldestKey);
                }
                setIcon(iconData);
                lastKeyRef.current = cacheKey;
            } catch (error) {
                console.error(`Error fetching icon for ${app.name}:`, error);
            }
        };

        loadIcon();
    }, [device.ip, app.id]);

    if (!app || app.id === 'roku' || !icon) return null;

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
  const hasLoadedRef = useRef(false);
  const lastDeviceKeyRef = useRef<string | null>(null);
  const busyRef = useRef<Set<string>>(new Set());
  const abortControllerRef = useRef<AbortController | null>(null);
  const [currentPlatform, setCurrentPlatform] = useState<string | null>(null);
  const [mediaModalOpen, setMediaModalOpen] = useState(false);


  useEffect(() => {
    const fetchPlatform = async () => {
      try {
        const p = await platform();
        setCurrentPlatform(p);
      } catch {
        // If permission is not granted (e.g., in popup window) or plugin unavailable,
        // fall back gracefully without breaking the UI.
        setCurrentPlatform(null);
      }
    };
    fetchPlatform();
  }, []);

  useEffect(() => {
    if (!device) return;
    
    // Cancel any previous fetch
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    const currentKey = `${device.ip}:${device.port}`;
    const isSameDevice = lastDeviceKeyRef.current === currentKey;
    lastDeviceKeyRef.current = currentKey;

    const initialFetch = async () => {
      // Create new abort controller for this fetch
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      if (!isSameDevice) {
        setIsAppLoading(true);
        hasLoadedRef.current = false;
      }

      const timeoutId = window.setTimeout(() => {
        if (!abortController.signal.aborted) {
          setIsAppLoading(false);
        }
      }, 6500);

      try {
        if (device.status && device.status !== 'connected') {
          setActiveApp(null);
          return;
        }
        
        const appInfo: ActiveApp = await invoke('get_active_app', {
          ip: device.ip,
          port: device.port,
        });
        
        // Check if this fetch was aborted
        if (abortController.signal.aborted) {
          return;
        }
        
        setActiveApp(appInfo);
        hasLoadedRef.current = true;
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

    // Cleanup function
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [device.ip, device.port, device.status]);

  useEffect(() => {
    if (!device) return;

    let intervalId: number | undefined;

    const fetchActiveApp = async () => {
      if (device.status && device.status !== 'connected') {
        return;
      }
      try {
        const appInfo: ActiveApp = await invoke('get_active_app', {
          ip: device.ip,
          port: device.port
        });
        setActiveApp(appInfo);
      } catch (error) {
        // Avoid spamming logs when device briefly unreachable; ignore here.
      }
    };

    const startPolling = () => {
      if (intervalId) return;
      fetchActiveApp();
      intervalId = window.setInterval(fetchActiveApp, 5000);
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
  }, [device]);

  const sendCommand = useCallback(
    async (command: string) => {
      if (!device) return;
      if (device.status && device.status !== 'connected') {
        setFeedback({ message: 'Device appears offline', severity: 'error' });
        return;
      }
      if (busyRef.current.has(command)) return;
      busyRef.current.add(command);
      try {
        await invoke('send_roku_command', {
          ip: device.ip,
          port: device.port,
          command,
        });
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
    [device]
  );

  useEffect(() => {
    // Skip keyboard shortcuts on mobile
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
      // Do not intercept keys while typing in inputs/text areas.
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

  const systemButtons = useMemo<CommandSpec[]>(() => systemButtonSpecs, []);
  const volumeButtons = useMemo<CommandSpec[]>(() => volumeButtonSpecs, []);
  const playbackButtons = useMemo<CommandSpec[]>(() => playbackButtonSpecs, []);
  const powerButtons = useMemo<CommandSpec[]>(() => powerButtonSpecs, []);

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
        background: `linear-gradient(145deg, ${theme.palette.background.paper}, ${theme.palette.background.default})`,
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

      <Box sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1.5,
          minHeight: 40,
          width: '100%',
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
                  <ActiveAppIcon device={device} app={activeApp} />
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

      <Snackbar open={!!feedback} autoHideDuration={3000} onClose={() => setFeedback(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} >
        <Alert onClose={() => setFeedback(null)} severity={feedback?.severity} sx={{ width: '100%' }} >
          {feedback?.message}
        </Alert>
      </Snackbar>
      <MediaPlayerModal
          open={mediaModalOpen}
          onClose={() => setMediaModalOpen(false)}
          device={device}
      />
    </Paper>
  );
};

function devicesEqual(a: RokuDevice, b: RokuDevice) {
  return (
    a.ip === b.ip &&
    a.port === b.port &&
    a.name === b.name &&
    a.url === b.url &&
    a.status === b.status
  );
}

export default React.memo(RemoteControl, (prev, next) => devicesEqual(prev.device, next.device));