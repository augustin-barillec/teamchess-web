import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'icons/icon-192x192.png'],
      manifest: {
        name: 'TeamChess',
        short_name: 'TeamChess',
        description: 'Collaborative team-based chess.',
        theme_color: '#333333',
        background_color: '#f8f8f8',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
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
