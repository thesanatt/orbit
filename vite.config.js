import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: '.',
  publicDir: 'public',
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/walker': 'http://localhost:8000',
      '/user': 'http://localhost:8000',
      '/graph': 'http://localhost:8000',
      '/healthz': 'http://localhost:8000',
      '/admin': 'http://localhost:8000',
    }
  }
});
