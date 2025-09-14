import type { PropsWithChildren, ReactElement } from 'react';
import { render } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

export function renderWithTheme(ui: ReactElement, options = {}) {
  const theme = createTheme();
  return render(ui, { wrapper: ({ children }: PropsWithChildren) => <ThemeProvider theme={theme}>{children}</ThemeProvider>, ...options });
}
