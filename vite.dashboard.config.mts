import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cspPlugin } from './vite.csp.mts';

export default defineConfig({
  root: 'src/renderer/dashboard',
  // With a custom root, Vite would emit under the root; Forge loads from .vite/renderer/<name>.
  build: {
    outDir: path.resolve('.vite/renderer/dashboard'),
    emptyOutDir: true,
    // Fonts stay same-origin files: the CSP (default-src 'self') blocks data: URL fonts.
    assetsInlineLimit: (file) => (file.endsWith('.woff2') ? false : undefined),
  },
  resolve: { alias: { '@': path.resolve('src/renderer/dashboard') } },
  plugins: [react(), tailwindcss(), cspPlugin()],
});
