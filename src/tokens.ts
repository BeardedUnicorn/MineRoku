// The app's design tokens. src/theme.ts builds the MUI theme from these and
// src/components/remoteStyleTokens.ts reads them directly.
//
// `bg` is also written out by hand where no bundle is loaded yet: index.html (first paint and
// splash), src-tauri/tauri.conf.json (window background) and the Android colors.xml (window and
// system bars). src/tokens.test.ts fails when one of them drifts.

export const tokens = {
  /** Page and window background: the app icon's deep purple. */
  bg: '#150F26',
  /** Under the app bar and bottom navigation, used translucent over scrolling content. */
  surfaceLowest: '#0F0A1C',
  /** Device rail, cards, sheets. */
  surface1: '#1C1530',
  /** Dialogs, menus, app tiles. */
  surface2: '#241C3D',
  /** Selected rows, chips. */
  surface3: '#2E2550',
  /** Hover on a surface3 element. */
  surface4: '#3A3063',
  /** Borders of controls. */
  outline: '#7A6FA3',
  /** Dividers and hairlines. */
  outlineVariant: 'rgba(182, 157, 248, 0.14)',

  text: '#F1ECFA',
  textSecondary: '#B9B0CF',
  textMuted: '#8E86A6',

  /** Accent for text, icons and filled buttons. 8:1 on `bg`. */
  primary: '#B69DF8',
  primaryLight: '#D3C4FF',
  primaryDark: '#9A7DEB',
  onPrimary: '#150F26',

  /** The brand purple pair: the remote's OK button and the splash. Too dark for text. */
  brandPurpleLight: '#8e65cf',
  brandPurple: '#673ab7',
  brandPurpleDark: '#512da8',

  success: '#5FD39A',
  warning: '#F2B866',
  error: '#FF8A8A',
  errorFill: '#C93B45',
} as const;

/** Corner radii. Written as px strings: numbers in `sx` are multiplied by theme.shape. */
export const radius = {
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  pill: '999px',
} as const;

export const motion = {
  press: '120ms',
  enter: '200ms',
  sheet: '280ms',
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
} as const;

/** The one shadow, for surfaces that float above the page: dialogs, menus, sheets. */
export const floatingShadow = '0 12px 32px rgba(8, 4, 20, 0.5)';
