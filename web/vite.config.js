import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The Node server serves the build under /flow/ when the "ui=flow" cookie is set.
// `npm run dev` proxies everything except the frontend to the server on port 3000.
const backend = 'http://localhost:3000';

export default defineConfig({
  base: '/flow/',
  plugins: [react()],
  build: { outDir: 'dist', assetsDir: 'assets' },
  server: {
    proxy: {
      '/api': backend,
      '/uploads': backend,
      '/logout': backend,
      '/auth': backend,
    },
  },
});
