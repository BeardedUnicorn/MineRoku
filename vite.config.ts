import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from 'node:path';

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  build: {
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
      },
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 20,
            },
            {
              name: 'mui',
              test: /node_modules[\\/](@mui|@emotion|@babel[\\/]runtime|@popperjs|react-transition-group|react-is|prop-types|hoist-non-react-statics|stylis|clsx|csstype)[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  test: {
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
    // The app's tests; scripts/ has its own (node --test, `pnpm test:scripts`)
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      include: ['src/**'],
      reporter: ['text', 'html'],
    },
  },
}));
