import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run dev:web` = hot-reload UI on :5173, API proxied to `wrangler dev` on :8787.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: { proxy: { '/api': 'http://localhost:8787' } },
});
