import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build straight into ../public, which Express serves. Dev server proxies /api to the local Express.
export default defineConfig({
  plugins: [react()],
  build: { outDir: '../public', emptyOutDir: true },
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
