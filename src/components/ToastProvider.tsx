import React, { createContext, useCallback, useContext, useState } from 'react';
import { Alert, Button, Snackbar } from '@mui/material';
import { BOTTOM_NAV_CLEARANCE } from '../layout';

export interface Toast {
  message: string;
  severity: 'success' | 'error' | 'info';
  /** A button inside the toast. It belongs to this message only. */
  action?: { label: string; onClick: () => void };
}

type ShowToast = (toast: Toast) => void;

const ToastContext = createContext<ShowToast>(() => undefined);

/** Show a short message at the bottom of the window. A newer message replaces the current one. */
export const useToast = (): ShowToast => useContext(ToastContext);

/** The app's single toast: rendered at the root so no card or scroll container can clip it. */
export const ToastProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [toast, setToast] = useState<Toast | null>(null);
  const [open, setOpen] = useState(false);

  const show = useCallback<ShowToast>((next) => {
    setToast(next);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <Snackbar
        open={open}
        autoHideDuration={4000}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        // Raised above the bottom navigation on phones.
        sx={{ bottom: { xs: BOTTOM_NAV_CLEARANCE, md: 24 } }}
      >
        <Alert
          onClose={close}
          severity={toast?.severity}
          sx={{ width: '100%' }}
          action={
            toast?.action ? (
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  toast.action?.onClick();
                  close();
                }}
              >
                {toast.action.label}
              </Button>
            ) : undefined
          }
        >
          {toast?.message}
        </Alert>
      </Snackbar>
    </ToastContext.Provider>
  );
};
