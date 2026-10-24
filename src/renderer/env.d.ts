import type { DashboardApi } from '../preload/dashboard';
import type { OverlayApi } from '../preload/overlay';

declare global {
  interface Window {
    overlayApi: OverlayApi;
    dashboardApi: DashboardApi;
  }
}
