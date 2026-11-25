import { alpha, type Theme } from '@mui/material/styles';
import { coerceRemoteStylePreset, type RemoteStylePreset } from '../store';
import { tokens } from '../tokens';

export interface DpadMetrics {
  arrowSize: number;
  centerSize: number;
  gap: number;
}

const TABLET_DPAD_METRICS: DpadMetrics = {
  arrowSize: 64,
  centerSize: 72,
  gap: 12,
};

const PHONE_DPAD_METRICS: DpadMetrics = {
  arrowSize: 82,
  centerSize: 96,
  gap: 10,
};

export const remoteStyleLabels: Record<RemoteStylePreset, string> = {
  classic: 'Classic',
  studio: 'Studio',
  glass: 'Glass',
  highContrast: 'High Contrast',
};

export const getDpadMetrics = (isPhone: boolean): DpadMetrics => {
  return isPhone ? PHONE_DPAD_METRICS : TABLET_DPAD_METRICS;
};

export const getDpadSize = ({ arrowSize, centerSize, gap }: DpadMetrics): number => {
  return centerSize + arrowSize * 2 + gap * 4;
};

export interface RemoteStyleTokens {
  cardBackground: string;
  activeAppOverlay: string;
  cardBorder: string;
  cardShadow: string;
  cardBackdropFilter: string;
  titleColor: string;
  appPillBackground: string;
  appPillHoverBackground: string;
  dpadBackground: string;
  dpadShadow: string;
  flatButtonBackground: string;
  flatButtonHoverBackground: string;
  flatButtonColor: string;
  ringBorderColor: string;
  centerButtonBackground: string;
  centerButtonHoverBackground: string;
  centerButtonColor: string;
  centerButtonShadow: string;
  powerButtonBackground: string;
  powerButtonHoverBackground: string;
  powerButtonColor: string;
  dividerOpacity: number;
  helperTextOpacity: number;
}

// The same red on every style, and independent of the app's error color.
const powerButton = {
  powerButtonBackground: '#d32f2f',
  powerButtonHoverBackground: '#f44336',
  powerButtonColor: '#ffffff',
} as const;

export const getRemoteStyleTokens = (
  style: RemoteStylePreset,
  theme: Theme
): RemoteStyleTokens => {
  const safeStyle = coerceRemoteStylePreset(style);

  switch (safeStyle) {
    case 'studio':
      return {
        cardBackground: `linear-gradient(165deg, ${alpha(theme.palette.grey[900], 0.94)}, ${alpha(
          theme.palette.grey[800],
          0.94
        )})`,
        activeAppOverlay: 'linear-gradient(165deg, rgba(14,16,20,0.64), rgba(14,16,20,0.88))',
        cardBorder: `1px solid ${alpha(theme.palette.common.white, 0.08)}`,
        cardShadow: '0 10px 24px rgba(0,0,0,0.52), inset 0 1px 0 rgba(255,255,255,0.04)',
        cardBackdropFilter: 'none',
        titleColor: '#ffffff',
        appPillBackground: alpha(theme.palette.common.white, 0.08),
        appPillHoverBackground: alpha(theme.palette.common.white, 0.14),
        dpadBackground: `radial-gradient(circle at 40% 28%, ${alpha(
          theme.palette.grey[700],
          0.9
        )} 0%, ${alpha(theme.palette.grey[900], 0.96)} 68%, ${alpha(
          theme.palette.grey[900],
          1
        )} 100%)`,
        dpadShadow: '0 6px 14px rgba(0,0,0,0.52), inset 0 1px 2px rgba(255,255,255,0.05)',
        flatButtonBackground: alpha(theme.palette.grey[700], 0.58),
        flatButtonHoverBackground: alpha(theme.palette.grey[600], 0.72),
        flatButtonColor: '#ffffff',
        ringBorderColor: alpha(theme.palette.common.white, 0.28),
        centerButtonBackground: 'linear-gradient(145deg, #7d5cd8, #5e41b6)',
        centerButtonHoverBackground: 'linear-gradient(145deg, #8664e0, #6749c0)',
        centerButtonColor: '#ffffff',
        centerButtonShadow: '0 6px 12px rgba(0,0,0,0.46), inset 0 1px 1px rgba(255,255,255,0.12)',
        ...powerButton,
        dividerOpacity: 0.36,
        helperTextOpacity: 0.64,
      };
    case 'glass':
      return {
        cardBackground: 'linear-gradient(160deg, rgba(68,85,115,0.74), rgba(18,22,30,0.9))',
        activeAppOverlay: 'linear-gradient(160deg, rgba(13,16,24,0.48), rgba(8,10,15,0.74))',
        cardBorder: `1px solid ${alpha(theme.palette.common.white, 0.22)}`,
        cardShadow: '0 12px 28px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.16)',
        cardBackdropFilter: 'blur(10px)',
        titleColor: '#f6f9ff',
        appPillBackground: alpha(theme.palette.common.white, 0.14),
        appPillHoverBackground: alpha(theme.palette.common.white, 0.2),
        dpadBackground: 'radial-gradient(circle at 34% 30%, rgba(246,252,255,0.2) 0%, rgba(34,40,56,0.86) 64%, rgba(18,20,30,0.94) 100%)',
        dpadShadow: '0 6px 16px rgba(0,0,0,0.5), inset 0 1px 2px rgba(255,255,255,0.16)',
        flatButtonBackground: alpha(theme.palette.common.white, 0.12),
        flatButtonHoverBackground: alpha(theme.palette.common.white, 0.2),
        flatButtonColor: '#f3f8ff',
        ringBorderColor: alpha(theme.palette.common.white, 0.46),
        centerButtonBackground: 'linear-gradient(150deg, #9982ff, #6d52d8)',
        centerButtonHoverBackground: 'linear-gradient(150deg, #a691ff, #7a60e4)',
        centerButtonColor: '#ffffff',
        centerButtonShadow: '0 7px 14px rgba(0,0,0,0.5), inset 0 1px 1px rgba(255,255,255,0.2)',
        ...powerButton,
        dividerOpacity: 0.44,
        helperTextOpacity: 0.78,
      };
    case 'highContrast':
      return {
        cardBackground: 'linear-gradient(180deg, #040404, #151515)',
        activeAppOverlay: 'linear-gradient(180deg, rgba(0,0,0,0.72), rgba(0,0,0,0.9))',
        cardBorder: '2px solid #ffffff',
        cardShadow: '0 8px 18px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.08)',
        cardBackdropFilter: 'none',
        titleColor: '#ffffff',
        appPillBackground: '#101010',
        appPillHoverBackground: '#1a1a1a',
        dpadBackground: 'radial-gradient(circle at 30% 30%, #1c1c1c 0%, #0f0f0f 72%, #050505 100%)',
        dpadShadow: '0 5px 12px rgba(0,0,0,0.75), inset 0 0 0 1px rgba(255,255,255,0.7)',
        flatButtonBackground: '#0e0e0e',
        flatButtonHoverBackground: '#1d1d1d',
        flatButtonColor: '#ffffff',
        ringBorderColor: '#ffffff',
        centerButtonBackground: 'linear-gradient(145deg, #ffffff, #d8d8d8)',
        centerButtonHoverBackground: 'linear-gradient(145deg, #f3f3f3, #c6c6c6)',
        centerButtonColor: '#000000',
        centerButtonShadow: '0 6px 12px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.95)',
        ...powerButton,
        dividerOpacity: 0.68,
        helperTextOpacity: 0.86,
      };
    case 'classic':
    default:
      // Fixed values, not theme lookups: the remote keeps its look when the app theme changes.
      return {
        cardBackground: `linear-gradient(145deg, ${tokens.surface2}, ${tokens.bg})`,
        activeAppOverlay: 'linear-gradient(145deg, rgba(21,15,38,0.72), rgba(21,15,38,0.92))',
        cardBorder: '1px solid rgba(255,255,255,0.06)',
        cardShadow: 'inset 0 1px 2px rgba(255,255,255,0.06), 0 6px 18px rgba(0,0,0,0.6)',
        cardBackdropFilter: 'none',
        titleColor: '#ffffff',
        appPillBackground: 'rgba(255,255,255,0.08)',
        appPillHoverBackground: 'rgba(255,255,255,0.16)',
        dpadBackground: `radial-gradient(circle at 30% 30%, #1a1430 0%, ${tokens.surface3} 60%, #1a1430 100%)`,
        dpadShadow: '0 4px 10px rgba(0,0,0,0.6), inset 0 2px 4px rgba(255,255,255,0.05)',
        flatButtonBackground: tokens.surface3,
        flatButtonHoverBackground: tokens.surface4,
        flatButtonColor: '#ffffff',
        ringBorderColor: 'rgba(255,255,255,0.14)',
        // The splash in index.html uses this pair (src/splash.test.ts).
        centerButtonBackground: `linear-gradient(145deg, ${tokens.brandPurpleLight}, ${tokens.brandPurple})`,
        centerButtonHoverBackground: `linear-gradient(145deg, ${tokens.brandPurple}, ${tokens.brandPurpleDark})`,
        centerButtonColor: '#ffffff',
        centerButtonShadow: '0 6px 12px rgba(0,0,0,0.5), inset 0 1px 1px rgba(255,255,255,0.1)',
        ...powerButton,
        dividerOpacity: 0.3,
        helperTextOpacity: 0.6,
      };
  }
};
