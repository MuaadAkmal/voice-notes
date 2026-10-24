import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cspPlugin } from './vite.csp.mts';

export default defineConfig({
  root: 'src/renderer/overlay',
  plugins: [react(), tailwindcss(), cspPlugin()],
});
