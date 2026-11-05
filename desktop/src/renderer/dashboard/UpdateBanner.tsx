import { useEffect, useState } from 'react';
import type { UpdateStatus } from '../../shared/channels';
import { cleanIpcError } from '../../shared/format';
import { releaseNotesUrl } from '../../shared/releases';
import { Button } from '@/components/ui/button';
import { useToast } from './Toast';

const api = window.dashboardApi;

export function useUpdates(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    api.getUpdateStatus().then(setStatus);
    return api.onUpdatesChanged(setStatus);
  }, []);
  return status;
}

/** Ask main to restart into the new version; it refuses during a recording. */
export function useRestartToUpdate(): () => void {
  const toast = useToast();
  return () => {
    api.restartToUpdate().then((r) => {
      if (r === 'busy') toast('Finish recording first, then restart');
    });
  };
}

export const readyText = (s: UpdateStatus) => (s.newVersion ? `Version ${s.newVersion} is ready` : 'A new version is ready');

/** Opens the website's notes for `version` in the browser. */
export function WhatsNewButton({ version }: { version?: string | null }) {
  const toast = useToast();
  return (
    <Button variant="ghost" size="sm" onClick={() => api.openExternal(releaseNotesUrl(version)).catch((e) => toast(cleanIpcError(e)))}>
      What&apos;s new
    </Button>
  );
}

/** The bar above the dashboard once an update has downloaded. Later hides it until the next launch. */
export function UpdateBanner() {
  const status = useUpdates();
  const restart = useRestartToUpdate();
  const [later, setLater] = useState(false);
  if (status?.state !== 'ready' || later) return null;
  return (
    <div role="status" className="flex shrink-0 items-center gap-3 border-b bg-card px-5 py-2 text-sm">
      <span className="flex-1">{readyText(status)}. Restart to update; your notes stay as they are.</span>
      <WhatsNewButton version={status.newVersion} />
      <Button variant="ghost" size="sm" onClick={() => setLater(true)}>
        Later
      </Button>
      <Button size="sm" onClick={restart}>
        Restart now
      </Button>
    </div>
  );
}
