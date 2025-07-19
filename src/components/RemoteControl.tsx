import React, { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
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
  CircularProgress, // Import CircularProgress
} from '@mui/material';
import { motion } from 'framer-motion';
import {
  Home,
  ArrowBack,
  Info,
  PlayArrow,
  FastRewind,
  FastForward,
  KeyboardArrowUp,
  KeyboardArrowDown,
  KeyboardArrowLeft,
  KeyboardArrowRight,
  RadioButtonChecked,
  VolumeUp,
  VolumeDown,
  VolumeMute,
  PowerSettingsNew,
} from '@mui/icons-material';

//
// Types
//
export interface RokuDevice {
  name: string;
  ip: string;
  port: number;
  url: string;
}

// New interface for ActiveApp
interface ActiveApp {
  name: string;
  id: string;
  icon_url?: string;
}

interface RemoteControlProps {
  device: RokuDevice;
}

type FeedbackState = { message: string; severity: 'success' | 'error' } | null;

interface CommandSpec {
  key: string;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
}

interface RemoteButtonProps {
  cmd: string;
  label: string;
  icon: React.ReactNode;
  color?: 'default' | 'primary' | 'info' | 'warning' | 'error';
  variant?: 'flat' | 'filled';
  onSend: (cmd: string) => void;
  size?: number;
  ring?: boolean;
  center?: boolean;
  shortcut?: string;
}

/**
 * Animated button used throughout the remote.
 */
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
}) => {
  const theme = useTheme();

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

  return (
    <motion.div
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.92 }}
      style={{ display: 'inline-flex' }}
    >
      <Tooltip
        arrow
        title={
          shortcut ? (
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
              width: size,
              height: size,
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

//
// Mapping helper for backend commands (frontend symbolic -> backend expected).
//
const normalizeCommand = (raw: string): string => {
  return raw;
};

const RemoteControl: React.FC<RemoteControlProps> = ({ device }) => {
  const theme = useTheme();
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [activeApp, setActiveApp] = useState<ActiveApp | null>(null);
  const [isAppLoading, setIsAppLoading] = useState<boolean>(true);
  const busyRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Effect to fetch the active app periodically
  useEffect(() => {
    if (!device) return;

    let isMounted = true;

    const fetchActiveApp = async () => {
      if (!isMounted) return;
      try {
        const appInfo: ActiveApp = await invoke('get_active_app', {
          ip: device.ip,
          port: device.port
        });
        if (isMounted) {
          setActiveApp(appInfo);
        }
      } catch (error) {
        console.error("Could not fetch active app:", error);
        if (isMounted) {
          setActiveApp(null); // Clear on error
        }
      } finally {
        if (isMounted) {
            setIsAppLoading(false);
        }
      }
    };

    // Fetch immediately and then set an interval
    setIsAppLoading(true);
    fetchActiveApp();
    const intervalId = setInterval(fetchActiveApp, 5000); // Poll every 5 seconds

    // Cleanup function
    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [device]);


  const sendCommand = useCallback(
    async (command: string) => {
      if (!device) return;
      const norm = normalizeCommand(command);
      if (busyRef.current.has(norm)) return;
      busyRef.current.add(norm);
      try {
        await invoke('send_roku_command', {
          ip: device.ip,
          port: device.port,
          command: norm,
        });
      } catch (error) {
        console.error(`Error sending command ${norm}:`, error);
        if (mountedRef.current) {
          setFeedback({
            message: `Error: ${String(error)}`,
            severity: 'error',
          });
        }
      } finally {
        busyRef.current.delete(norm);
      }
    },
    [device]
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      switch (key) {
        case 'arrowup': sendCommand('up'); break;
        case 'arrowdown': sendCommand('down'); break;
        case 'arrowleft': sendCommand('left'); break;
        case 'arrowright': sendCommand('right'); break;
        case 'enter': case 'return': sendCommand('select'); break;
        case ' ': e.preventDefault(); sendCommand('play'); break;
        case 'backspace': case 'escape': sendCommand('back'); break;
        case 'h': sendCommand('home'); break;
        case 'i': sendCommand('info'); break;
        case 'm': sendCommand('VolumeMute'); break;
        case '+': case '=': sendCommand('VolumeUp'); break;
        case '-': case '_': sendCommand('VolumeDown'); break;
        default: return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [sendCommand]);

  //
  // Layout sections config
  //
  const systemButtons: CommandSpec[] = [
    { key: 'back', icon: <ArrowBack />, label: 'Back', shortcut: 'Backspace/Esc' },
    { key: 'home', icon: <Home />, label: 'Home', shortcut: 'H' },
    { key: 'info', icon: <Info />, label: 'Info', shortcut: 'I' },
  ];

  const volumeButtons: CommandSpec[] = [
    { key: 'VolumeDown', icon: <VolumeDown />, label: 'Volume Down', shortcut: '-' },
    { key: 'VolumeMute', icon: <VolumeMute />, label: 'Mute', shortcut: 'M' },
    { key: 'VolumeUp', icon: <VolumeUp />, label: 'Volume Up', shortcut: '+' },
  ];

  const playbackButtons: CommandSpec[] = [
    { key: 'rev', icon: <FastRewind />, label: 'Rewind' },
    { key: 'play', icon: <PlayArrow />, label: 'Play / Pause', shortcut: 'Space' },
    { key: 'fwd', icon: <FastForward />, label: 'Fast Forward' },
  ];

  const powerButtons: CommandSpec[] = [
    { key: 'home', icon: <PowerSettingsNew />, label: 'Wake / Home', shortcut: 'H' },
  ];

  return (
    <Paper
      elevation={8}
      sx={{
        mx: 'auto',
        width: 320,
        maxWidth: '100%',
        borderRadius: '42px',
        px: 3,
        py: 4,
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2, // Adjusted gap
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

      {/* Active App Display */}
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
        backgroundColor: 'action.hover'
      }}>
          {isAppLoading ? (
              <CircularProgress size={20} />
          ) : activeApp && activeApp.id !== 'roku' ? (
              <>
                  <Box
                      component="img"
                      src={activeApp.icon_url}
                      sx={{ width: 24, height: 24, borderRadius: 1 }}
                      alt={`${activeApp.name} icon`}
                  />
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

      {/* System Row */}
      <Stack
        direction="row"
        spacing={2}
        alignItems="center"
        justifyContent="center"
        sx={{ width: '100%', mt: 1 }} // Added margin top
      >
        {systemButtons.map((b) => (
          <RemoteButton
            key={b.key}
            cmd={b.key}
            label={b.label}
            icon={b.icon}
            onSend={sendCommand}
            shortcut={b.shortcut}
            size={56}
          />
        ))}
      </Stack>

      {/* D-Pad */}
      <Box
        sx={{
          position: 'relative',
          width: 200,
          height: 200,
          mt: 1 // Added margin top
        }}
      >
        {/* Outer Ring */}
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
          {/* Grid for directional buttons */}
          <Box
            sx={{
              position: 'relative',
              width: '100%',
              height: '100%',
            }}
          >
            <Box sx={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)' }} >
              <RemoteButton cmd="up" label="Up" icon={<KeyboardArrowUp />} onSend={sendCommand} ring shortcut="↑" />
            </Box>
            <Box sx={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)' }} >
              <RemoteButton cmd="down" label="Down" icon={<KeyboardArrowDown />} onSend={sendCommand} ring shortcut="↓" />
            </Box>
            <Box sx={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} >
              <RemoteButton cmd="left" label="Left" icon={<KeyboardArrowLeft />} onSend={sendCommand} ring shortcut="←" />
            </Box>
            <Box sx={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }} >
              <RemoteButton cmd="right" label="Right" icon={<KeyboardArrowRight />} onSend={sendCommand} ring shortcut="→" />
            </Box>

            {/* Center Select */}
            <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} >
              <RemoteButton
                cmd="select"
                label="Select / OK"
                icon={<RadioButtonChecked />}
                onSend={sendCommand}
                variant="filled"
                color="primary"
                shortcut="Enter"
                size={72}
                center
              />
            </Box>
          </Box>
        </Box>
      </Box>

      {/* Playback */}
      <Stack direction="row" spacing={2} justifyContent="center" alignItems="center" sx={{ width: '100%', mt: 1 }} >
        {playbackButtons.map((b) => (
          <RemoteButton key={b.key} cmd={b.key} label={b.label} icon={b.icon} onSend={sendCommand} shortcut={b.shortcut} size={56} />
        ))}
      </Stack>

      <Divider flexItem variant="middle" sx={{ opacity: 0.3, width: '80%', my: 1 }} />

      {/* Volume + Power */}
      <Stack direction="row" spacing={2} justifyContent="center" alignItems="center" sx={{ width: '100%' }} >
        {volumeButtons.map((b) => (
          <RemoteButton key={b.key} cmd={b.key} label={b.label} icon={b.icon} onSend={sendCommand} shortcut={b.shortcut} size={52} />
        ))}
        {powerButtons.map((b) => (
            <RemoteButton key={b.key} cmd={b.key} label={b.label} icon={b.icon} onSend={sendCommand} shortcut={b.shortcut} size={52} color="primary" variant="filled" />
        ))}
      </Stack>

      <Typography variant="caption" sx={{ opacity: 0.6, textAlign: 'center', mt: 1, maxWidth: 260 }} >
        Use arrow keys / Enter / Space / +/- / Backspace (or Esc) for quick keyboard control.
      </Typography>

      <Snackbar open={!!feedback} autoHideDuration={3000} onClose={() => setFeedback(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} >
        <Alert onClose={() => setFeedback(null)} severity={feedback?.severity} sx={{ width: '100%' }} >
          {feedback?.message}
        </Alert>
      </Snackbar>
    </Paper>
  );
};

export default RemoteControl;