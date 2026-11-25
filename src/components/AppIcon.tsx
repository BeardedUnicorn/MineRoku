import React, { useEffect, useRef, useState } from 'react';
import { Box, CircularProgress } from '@mui/material';
import { useAppIcon } from '../hooks/useAppIcon';
import { tokens } from '../tokens';

interface AppIconProps {
  device: { ip: string; port: number };
  appId: string;
  appName: string;
  /** Shows a spinner over the artwork. */
  busy?: boolean;
}

/** True once the element has come near the viewport. Stays true. */
function useNearViewport(ref: React.RefObject<Element | null>): boolean {
  // Without IntersectionObserver (tests, very old WebViews) everything counts as visible.
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    const element = ref.current;
    if (near || !element) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near, ref]);

  return near;
}

/**
 * An app's artwork in Roku's 4:3 shape. The icon is only requested once the tile is near the
 * viewport, so a long app list does not ask the device for every icon at once.
 */
const AppIcon: React.FC<AppIconProps> = ({ device, appId, appName, busy = false }) => {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref);
  const icon = useAppIcon(device, appId, near);

  return (
    <Box
      ref={ref}
      sx={{
        position: 'relative',
        width: '100%',
        aspectRatio: '4 / 3',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        backgroundColor: tokens.surface3,
      }}
    >
      {icon ? (
        <Box
          component="img"
          src={icon}
          alt=""
          draggable={false}
          sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        // The name stands in until the artwork arrives, so the tile is never anonymous.
        <Box
          aria-hidden
          sx={{ px: 1, color: 'text.secondary', fontSize: '0.75rem', fontWeight: 600, textAlign: 'center', overflowWrap: 'anywhere' }}
        >
          {appName}
        </Box>
      )}
      {busy && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(15, 10, 28, 0.6)',
          }}
        >
          <CircularProgress size={24} aria-label={`Launching ${appName}`} />
        </Box>
      )}
    </Box>
  );
};

export default React.memo(AppIcon);
