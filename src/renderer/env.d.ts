import type { OverlayApi } from '../preload/overlay';

declare global {
  interface Window {
    overlayApi: OverlayApi;
  }
}
