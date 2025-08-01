import React from 'react';
import {
  Home,
  ArrowBack,
  Info,
  PlayArrow,
  FastRewind,
  FastForward,
  VolumeUp,
  VolumeDown,
  VolumeMute,
  PowerSettingsNew,
} from '@mui/icons-material';

export interface CommandSpec {
  key: string;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
}

export const systemButtonSpecs: CommandSpec[] = [
  { key: 'back', icon: <ArrowBack />, label: 'Back', shortcut: 'Backspace/Esc' },
  { key: 'home', icon: <Home />, label: 'Home', shortcut: 'H' },
  { key: 'info', icon: <Info />, label: 'Info', shortcut: 'I' },
];

export const volumeButtonSpecs: CommandSpec[] = [
  { key: 'VolumeDown', icon: <VolumeDown />, label: 'Volume Down', shortcut: '-' },
  { key: 'VolumeMute', icon: <VolumeMute />, label: 'Mute', shortcut: 'M' },
  { key: 'VolumeUp', icon: <VolumeUp />, label: 'Volume Up', shortcut: '+' },
];

export const playbackButtonSpecs: CommandSpec[] = [
  { key: 'rev', icon: <FastRewind />, label: 'Rewind' },
  { key: 'play', icon: <PlayArrow />, label: 'Play / Pause', shortcut: 'Space' },
  { key: 'fwd', icon: <FastForward />, label: 'Fast Forward' },
];

export const powerButtonSpecs: CommandSpec[] = [
  { key: 'PowerOff', icon: <PowerSettingsNew />, label: 'Power Off' },
];

