import { useEffect, useState } from 'react';
import type { ConnectorsInfo } from '../../shared/channels';

const api = window.dashboardApi;

/** The Google Calendar connection, kept current by main's connectors:changed. */
export function useConnectors(): ConnectorsInfo | null {
  const [info, setInfo] = useState<ConnectorsInfo | null>(null);
  useEffect(() => {
    api.getConnectors().then(setInfo);
    return api.onConnectorsChanged(setInfo);
  }, []);
  return info;
}
