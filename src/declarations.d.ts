/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';

// Injected by Forge's Vite plugin, one pair per renderer in forge.config.mts.
declare const OVERLAY_VITE_DEV_SERVER_URL: string | undefined;
declare const OVERLAY_VITE_NAME: string;
declare const DASHBOARD_VITE_DEV_SERVER_URL: string | undefined;
declare const DASHBOARD_VITE_NAME: string;
