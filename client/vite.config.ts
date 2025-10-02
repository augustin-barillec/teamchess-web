import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    proxy: {
      // proxy both HTTP polling & WebSocket upgrade
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true, // <-- proxy WebSocket upgrades
        changeOrigin: true, // optional but often helpful
      },
    },
  },
});
