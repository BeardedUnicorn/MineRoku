import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#673AB7', // Roku purple
    },
    secondary: {
      main: '#424242', // Dark gray
    },
    background: {
      default: '#1a1a1a', // Very dark gray
      paper: '#2a2a2a',
    },
    text: {
      primary: '#ffffff', // White
      secondary: '#bbb',
    },
  },
  typography: {
    fontFamily: 'Arial, sans-serif',
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
        },
      },
    },
  },
});

export default theme;
