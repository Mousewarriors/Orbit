import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config tuned for Tauri: fixed dev port, no clearing of the Rust logs.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // src-tauri is watched by the Rust side, not Vite.
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
  },
});
