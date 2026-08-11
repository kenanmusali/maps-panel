import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Keep VITE_API_URL empty in frontend/.env so the browser calls /api/*
      // (same origin). Vite forwards to the deployed backend that has Mongo
      // data — same groups as maps-panel.vercel.app. Avoids CORS and avoids
      // the empty local backend on :4000 (no MONGODB_URI).
      '/api': {
        target: 'https://maps-panel-backend.vercel.app',
        changeOrigin: true,
        secure: true
      }
    }
  }
});
