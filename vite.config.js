import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    // `@/…` imports point at src/ (also defined in vitest.config.js and jsconfig.json).
    alias: { '@': path.resolve(rootDir, 'src') },
  },
  server: {
    proxy: {
      // The Express API (server/index.js). Same-origin for the browser, so the session cookie works.
      '/local-api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  plugins: [react()],
});
