import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cspPlugin } from './vite.csp.mts';

export default defineConfig({
  root: 'src/renderer/overlay',
  // Each renderer's dev server optimises its own deps; one shared cache made them invalidate each other (504s).
  cacheDir: path.resolve('node_modules/.vite/overlay'),
  // With a custom root, Vite would emit under the root; Forge loads from .vite/renderer/<name>.
  build: {
    outDir: path.resolve('.vite/renderer/overlay'),
    emptyOutDir: true,
    // The AudioWorklet module and fonts must stay same-origin files: the CSP blocks data: URLs for them.
    assetsInlineLimit: (file) => (file.endsWith('.js') || file.endsWith('.woff2') ? false : undefined),
  },
  plugins: [react(), tailwindcss(), cspPlugin()],
});
