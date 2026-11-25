import { alpha, createTheme } from '@mui/material/styles';
import { floatingShadow, motion, radius, tokens } from './tokens';

const fontFamily =
  '"Inter Variable", system-ui, -apple-system, "Segoe UI", "Roboto", "Helvetica Neue", sans-serif';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: tokens.primary,
      light: tokens.primaryLight,
      dark: tokens.primaryDark,
      contrastText: tokens.onPrimary,
    },
    secondary: { main: tokens.textSecondary },
    success: { main: tokens.success },
    warning: { main: tokens.warning },
    error: { main: tokens.error, dark: tokens.errorFill },
    background: { default: tokens.bg, paper: tokens.surface1 },
    text: { primary: tokens.text, secondary: tokens.textSecondary, disabled: tokens.textMuted },
    divider: tokens.outlineVariant,
    action: {
      hover: alpha(tokens.primary, 0.08),
      selected: alpha(tokens.primary, 0.16),
      focus: alpha(tokens.primary, 0.16),
    },
  },
  // Kept at the default on purpose: numeric `borderRadius` values in `sx` (the remote uses
  // several) are multiples of this. Use the `radius` tokens for anything new.
  shape: { borderRadius: 4 },
  typography: {
    fontFamily,
    h4: { fontWeight: 700, letterSpacing: '-0.01em' },
    h5: { fontWeight: 650, letterSpacing: '-0.01em' },
    h6: { fontWeight: 600, letterSpacing: '-0.005em' },
    subtitle1: { fontWeight: 600 },
    subtitle2: { fontWeight: 600 },
    button: { fontWeight: 600, letterSpacing: 0 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        'html, body, #root': {
          height: '100%',
          margin: 0,
          padding: 0,
          // Containers scroll, the page does not.
          overflow: 'hidden',
        },
        body: {
          backgroundColor: tokens.bg,
          fontFeatureSettings: '"cv11", "ss01"',
        },
        '@media (prefers-reduced-motion: reduce)': {
          '*, *::before, *::after': {
            animationDuration: '0.01ms !important',
            animationIterationCount: '1 !important',
            transitionDuration: '0.01ms !important',
            scrollBehavior: 'auto !important',
          },
        },
      },
    },
    MuiButtonBase: {
      styleOverrides: {
        root: {
          '&.Mui-focusVisible': {
            outline: `2px solid ${tokens.primaryLight}`,
            outlineOffset: 2,
          },
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: radius.md,
          minHeight: 40,
          paddingInline: 18,
          transition: `background-color ${motion.press} ${motion.easing}, border-color ${motion.press} ${motion.easing}`,
        },
        outlined: { borderColor: tokens.outline },
      },
      variants: [
        {
          // error.main is tuned for text on dark; a filled button needs the deeper red.
          props: { variant: 'contained', color: 'error' },
          style: {
            backgroundColor: tokens.errorFill,
            color: '#ffffff',
            '&:hover': { backgroundColor: '#B3303A' },
          },
        },
      ],
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        // Depth comes from the surface tiers, not from MUI's overlay gradient.
        root: { backgroundImage: 'none' },
      },
    },
    MuiCard: {
      styleOverrides: { root: { borderRadius: radius.lg, backgroundColor: tokens.surface2 } },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: radius.xl,
          backgroundColor: tokens.surface2,
          boxShadow: floatingShadow,
        },
        paperFullScreen: { borderRadius: 0, backgroundColor: tokens.bg },
      },
    },
    MuiDialogTitle: { styleOverrides: { root: { fontWeight: 600 } } },
    MuiDialogActions: { styleOverrides: { root: { padding: '12px 20px 20px' } } },
    MuiDrawer: {
      styleOverrides: { paper: { backgroundColor: tokens.surface1, backgroundImage: 'none' } },
    },
    MuiMenu: {
      styleOverrides: {
        paper: { borderRadius: radius.md, backgroundColor: tokens.surface2, boxShadow: floatingShadow },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: tokens.surface4,
          color: tokens.text,
          borderRadius: radius.sm,
          fontSize: '0.75rem',
        },
        arrow: { color: tokens.surface4 },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: radius.md,
          '& .MuiOutlinedInput-notchedOutline': { borderColor: tokens.outline },
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: radius.md,
          '&.Mui-selected': { backgroundColor: tokens.surface3 },
          '&.Mui-selected:hover': { backgroundColor: tokens.surface4 },
        },
      },
    },
    MuiAlert: { styleOverrides: { root: { borderRadius: radius.md } } },
    MuiChip: { styleOverrides: { root: { borderRadius: radius.sm, fontWeight: 600 } } },
    MuiLinearProgress: {
      styleOverrides: { root: { borderRadius: radius.pill, backgroundColor: alpha(tokens.primary, 0.14) } },
    },
    MuiSnackbarContent: { styleOverrides: { root: { borderRadius: radius.md } } },
  },
});

export default theme;
