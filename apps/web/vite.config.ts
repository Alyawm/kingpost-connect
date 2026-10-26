/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The sync server serves this app from its root (or from a sub-path behind a proxy), so
// every asset is referenced relatively. During development, API calls go to a server
// running locally (KINGPOST_SERVER, default port 8640).
const server = process.env.KINGPOST_SERVER ?? 'http://127.0.0.1:8640';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1430,
    strictPort: true,
    proxy: { '/api': server },
  },
  build: {
    target: 'es2022',
    // The IFC engine (web-ifc) is a few megabytes by nature; it loads once per visit.
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
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
    environment: 'node',
    globals: true,
  },
});
