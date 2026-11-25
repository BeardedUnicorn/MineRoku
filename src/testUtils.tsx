import type { PropsWithChildren, ReactElement } from 'react';
import { render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from './theme';
import { ToastProvider } from './components/ToastProvider';

/** Render inside what src/main.tsx provides: the app theme and the toast. */
export function renderWithTheme(ui: ReactElement, options = {}) {
  return render(ui, {
    wrapper: ({ children }: PropsWithChildren) => (
      <ThemeProvider theme={theme}>
        <ToastProvider>{children}</ToastProvider>
      </ThemeProvider>
    ),
    ...options,
  });
}
