import { useCallback, useEffect, useState } from 'react';
import type { CloudUsageResult, Settings } from '../../shared/channels';
import { cleanIpcError } from '../../shared/format';
import { Button } from '@/components/ui/button';
import { useAccount } from './useAccount';
import { useToast } from './Toast';

const api = window.dashboardApi;

export function usageText(u: { used: number; limit: number; resetsAt: string }): string {
  const resets = new Date(u.resetsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${Math.floor(u.used / 60)} / ${Math.floor(u.limit / 60)} min this month · resets ${resets}`;
}

export function CloudCard({ settings, onSaved }: { settings: Settings; onSaved: (s: Settings) => void }) {
  const toast = useToast();
  const account = useAccount();
  const [usage, setUsage] = useState<CloudUsageResult | null>(null);
  const signedIn = account?.state === 'signed-in';

  const refresh = useCallback(() => {
    api.cloudUsage().then(setUsage).catch(() => setUsage({ error: 'offline' }));
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    refresh();
    // A job leaving the queue (done or failed) changes what was used.
    return api.onTranscriptionStatus(refresh);
  }, [signedIn, refresh]);

  const inUse = settings.transcription.provider === 'cloud';
  const use = () =>
    api
      .setSettings({ transcription: { ...settings.transcription, provider: 'cloud' } })
      .then(onSaved)
      .catch((e) => toast(cleanIpcError(e)));

  return (
    <div className="rounded-2xl border bg-card px-6 py-5">
      <h2 className="text-xl font-semibold tracking-tight">Voice Notes Cloud</h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Fast, accurate transcription hosted for you. No GPU, no server, nothing to install.
      </p>
      <div className="mt-4 space-y-3">
        {!signedIn ? (
          <>
            <div className="text-sm font-medium">Sign in to use Cloud</div>
            <Button size="sm" disabled={account?.state === 'signing-in'} onClick={() => api.signIn().catch((e) => toast(cleanIpcError(e)))}>
              {account?.state === 'signing-in' ? 'Waiting for browser…' : 'Sign in with Google'}
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" onClick={use} disabled={inUse}>
              {inUse ? 'In use' : 'Use Cloud'}
            </Button>
            {usage && 'error' in usage ? (
              <p className="text-xs text-muted-foreground">
                {usage.error === 'offline' ? 'Usage unavailable offline' : 'Usage unavailable'}
              </p>
            ) : usage ? (
              <div>
                <div className="text-sm">{usageText(usage)}</div>
                <div
                  role="progressbar"
                  aria-label="Cloud usage"
                  aria-valuemin={0}
                  aria-valuemax={usage.limit}
                  aria-valuenow={Math.min(usage.used, usage.limit)}
                  className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${usage.limit > 0 ? Math.min(100, (usage.used / usage.limit) * 100) : 0}%` }}
                  />
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
