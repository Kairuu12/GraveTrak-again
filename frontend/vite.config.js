import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Retire the old PWA worker on the dev origin, even if cached modules cannot boot.
const devServiceWorker = {
  name: 'gravetrak-dev-service-worker',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.split('?')[0] !== '/sw.js') return next();
      res.setHeader('Content-Type', 'application/javascript');
      res.setHeader('Cache-Control', 'no-store');
      res.end(`
        self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
        self.addEventListener('activate', event => event.waitUntil((async () => {
          const names = await caches.keys();
          await Promise.all(names.filter(name => name.startsWith('gravetrak-v')).map(name => caches.delete(name)));
          await self.registration.unregister();
          const windows = await self.clients.matchAll({ type: 'window' });
          await Promise.all(windows.map(client => client.navigate(client.url)));
        })()));
      `);
    });
  },
};

export default defineConfig({
  // LegacyAdminWorkspace is intentionally still a large compatibility module
  // while its role-specific panels are migrated in small, testable slices.
  // Compact output prevents Babel's formatting-only 500 KB notice without
  // altering the code that runs in the browser.
  plugins: [react({ babel: { compact: true } }), devServiceWorker],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
