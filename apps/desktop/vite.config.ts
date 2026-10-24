/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Set by `tauri dev` when the app is served to a device on the network; unset otherwise.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    // WebView2 on Windows is Chromium; the other targets cover macOS/Linux webviews.
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
    rollupOptions: {
      output: {
        // three.js changes rarely; keeping it in its own chunk makes updates smaller.
        // Matched by path because `three` is a dependency of the viewer package, not this app.
        manualChunks: (id) =>
          id.replace(/\\/g, '/').includes('/node_modules/three/') ? 'three' : undefined,
        // web-ifc locates its runtime by file name, so .wasm assets keep their names.
        assetFileNames: (info) => {
          const name = info.names?.[0] ?? '';
          return name.endsWith('.wasm') ? 'wasm/[name][extname]' : 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
