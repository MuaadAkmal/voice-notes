import type { ForgeConfig } from '@electron-forge/shared-types';
import fs from 'node:fs/promises';
import path from 'node:path';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

// Vite bundles everything except these natives, so they are copied into the package by hand.
const NATIVE_MODULES = ['better-sqlite3', 'uiohook-napi', 'node-gyp-build'];
const SKIP_DIRS = new Set(['deps', 'src', 'libuiohook', 'obj', 'docs']);

const config: ForgeConfig = {
  hooks: {
    packageAfterCopy: async (_config, buildPath) => {
      for (const name of NATIVE_MODULES) {
        await fs.cp(path.resolve('node_modules', name), path.join(buildPath, 'node_modules', name), {
          recursive: true,
          filter: (src) => !SKIP_DIRS.has(path.basename(src)),
        });
      }
    },
  },
  packagerConfig: {
    asar: true,
    name: 'Voice Notes',
    icon: 'assets/icon', // Packager appends .ico on Windows
  },
  rebuildConfig: {},
  makers: [new MakerSquirrel({ setupIcon: 'assets/icon.ico' }), new MakerZIP({}, ['win32'])],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        { entry: 'src/main/index.ts', config: 'vite.main.config.mts', target: 'main' },
        { entry: 'src/preload/overlay.ts', config: 'vite.preload.config.mts', target: 'preload' },
        { entry: 'src/preload/dashboard.ts', config: 'vite.preload.config.mts', target: 'preload' },
      ],
      renderer: [
        { name: 'overlay', config: 'vite.overlay.config.mts' },
        { name: 'dashboard', config: 'vite.dashboard.config.mts' },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
