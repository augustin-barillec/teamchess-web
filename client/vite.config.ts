import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import flowbiteReact from 'flowbite-react/plugin/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), flowbiteReact()],
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
