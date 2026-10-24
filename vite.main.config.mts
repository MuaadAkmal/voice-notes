import { defineConfig } from 'vite';

// Native modules are loaded from node_modules at runtime, never bundled.
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['better-sqlite3', 'uiohook-napi'],
    },
  },
});
