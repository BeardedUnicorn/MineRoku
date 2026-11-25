import React from 'react';
import HomeIcon from '@mui/icons-material/Home';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import InfoIcon from '@mui/icons-material/Info';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import FastRewindIcon from '@mui/icons-material/FastRewind';
import FastForwardIcon from '@mui/icons-material/FastForward';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeDownIcon from '@mui/icons-material/VolumeDown';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import { POWER_TOGGLE_COMMAND } from '../services/rokuClient';

export interface CommandSpec {
  key: string;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
}

export const systemButtonSpecs: CommandSpec[] = [
  { key: 'back', icon: <ArrowBackIcon />, label: 'Back', shortcut: 'Backspace/Esc' },
  { key: 'home', icon: <HomeIcon />, label: 'Home', shortcut: 'H' },
  { key: 'info', icon: <InfoIcon />, label: 'Info', shortcut: 'I' },
];

export const volumeButtonSpecs: CommandSpec[] = [
  { key: 'VolumeDown', icon: <VolumeDownIcon />, label: 'Volume Down', shortcut: '-' },
  { key: 'VolumeMute', icon: <VolumeOffIcon />, label: 'Mute', shortcut: 'M' },
  { key: 'VolumeUp', icon: <VolumeUpIcon />, label: 'Volume Up', shortcut: '+' },
];

export const playbackButtonSpecs: CommandSpec[] = [
  { key: 'rev', icon: <FastRewindIcon />, label: 'Rewind' },
  { key: 'play', icon: <PlayArrowIcon />, label: 'Play / Pause', shortcut: 'Space' },
  { key: 'fwd', icon: <FastForwardIcon />, label: 'Fast Forward' },
];

export const powerButtonSpecs: CommandSpec[] = [
  { key: POWER_TOGGLE_COMMAND, icon: <PowerSettingsNewIcon />, label: 'Power' },
];
