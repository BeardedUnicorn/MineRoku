import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#673AB7', // Roku purple
      light: '#8e65cf', // Lighter shade for gradients
      dark: '#512da8', // Darker shade for hovers
    },
    secondary: {
      main: '#424242', // Dark gray
    },
    background: {
      default: '#121212', // A more standard dark theme background
      paper: '#1e1e1e',   // A slightly lighter paper color
    },
    text: {
      primary: '#ffffff', // White
      secondary: '#b0b0b0', // Lighter secondary text for better readability
    },
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif', // Use a more standard font stack
    h4: {
        fontWeight: 700,
    },
    h6: {
        fontWeight: 600,
    }
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: 8, // Softer corners
        },
      },
    },
    MuiPaper: {
        styleOverrides: {
            root: {
                backgroundImage: 'none', // Ensure paper components don't have gradients unless specified
            }
        }
    }
  },
});

export default theme;