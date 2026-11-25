import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from '@mui/material/styles';
import theme from './theme';
import './index.css';
import { ToastProvider } from './components/ToastProvider';

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
