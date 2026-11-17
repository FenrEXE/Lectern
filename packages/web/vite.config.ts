import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// In development, Vite serves the web app on :5173 and forwards /api to the
// Lectern server on :8787. In production, the server serves the built files itself.
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
});
