import { useEffect, useRef, useState } from 'react';
import type { CloudUsageResult, Settings } from '../../shared/channels';
import { usageText } from '../../shared/cloud-usage';
import { cleanIpcError } from '../../shared/format';
import { Button } from '@/components/ui/button';
import { useAccount } from './useAccount';
import { useToast } from './Toast';

const api = window.dashboardApi;

export function CloudCard({ settings, onSaved }: { settings: Settings; onSaved: (s: Settings) => void }) {
  const toast = useToast();
  const account = useAccount();
  const [usage, setUsage] = useState<CloudUsageResult | { error: 'unknown' } | null>(null);
  const signedIn = account?.state === 'signed-in';

  const inUse = settings.transcription.provider === 'cloud';
  const seq = useRef(0);

  useEffect(() => {
    setUsage(null);
    if (!signedIn) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      const mine = ++seq.current;
      api
        .cloudUsage()
        .then((u) => mine === seq.current && setUsage(u))
        .catch(() => mine === seq.current && setUsage({ error: 'unknown' }));
    };
    refresh();
    // Only Cloud jobs change what was used; a bulk run sends many events, so wait for it to settle.
    const off = inUse
      ? api.onTranscriptionStatus(() => {
          clearTimeout(timer);
          timer = setTimeout(refresh, 1000);
        })
      : undefined;
    return () => {
      off?.();
      clearTimeout(timer);
      seq.current++;
    };
  }, [signedIn, inUse]);

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
