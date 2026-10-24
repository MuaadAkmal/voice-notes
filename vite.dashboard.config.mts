import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cspPlugin } from './vite.csp.mts';

export default defineConfig({
  root: 'src/renderer/dashboard',
  // With a custom root, Vite would emit under the root; Forge loads from .vite/renderer/<name>.
  build: { outDir: path.resolve('.vite/renderer/dashboard'), emptyOutDir: true },
  plugins: [react(), tailwindcss(), cspPlugin()],
});
