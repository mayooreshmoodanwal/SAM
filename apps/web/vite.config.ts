import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': process.env.API_PROXY_TARGET || 'http://localhost:3001' },
  },
  preview: {
    host: '127.0.0.1',
    port: 8080,
    proxy: { '/api': process.env.API_PROXY_TARGET || 'http://localhost:3001' },
  },
});
