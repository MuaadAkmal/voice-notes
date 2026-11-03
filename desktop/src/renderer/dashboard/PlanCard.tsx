import { CheckIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CloudUsageResult } from '../../shared/channels';
import { PLAN_PAGE_URL, planName, usageText } from '../../shared/cloud-usage';
import { cleanIpcError } from '../../shared/format';
import { Button } from '@/components/ui/button';
import { useToast } from './Toast';

const api = window.dashboardApi;

/** On every plan, as on voicenote.cloud's pricing cards. */
const SHARED = [
  'Pixie voice commands: say it, and it lands on the right list',
  'Voice to calendar: say “calendar…” to add a Google Calendar event',
  'Sync between all your devices',
];

/** Each paid plan at its launch price, listed as on voicenote.cloud's pricing. */
const PAID = [
  {
    name: 'Standard',
    price: '₹129/month',
    yearly: 'or ₹1,299/year',
    benefits: [
      '5 hours of Cloud transcription every month',
      '5 GB storage',
      ...SHARED,
    ],
  },
  {
    name: 'Pro',
    price: '₹299/month',
    yearly: 'or ₹2,999/year',
    benefits: [
      '10 hours of Cloud transcription every month',
      '20 GB storage',
      ...SHARED,
    ],
  },
];

/** Opens the web app's plan page in the browser, where plans are bought, changed and cancelled. */
export function PlanButton({
  plan,
  size = 'sm',
}: {
  plan: string;
  size?: 'sm' | 'default';
}) {
  const toast = useToast();
  return (
    <Button
      size={size}
      variant={plan === 'free' ? 'default' : 'outline'}
      onClick={() =>
        api.openExternal(PLAN_PAGE_URL).catch((e) => toast(cleanIpcError(e)))
      }
    >
      {plan === 'free' ? 'See plans' : 'Manage plan'}
    </Button>
  );
}

function UsageBar({ used, limit }: { used: number; limit: number }) {
  return (
    <div
      role="progressbar"
      aria-label="Cloud usage"
      aria-valuemin={0}
      aria-valuemax={limit}
      aria-valuenow={Math.min(used, limit)}
      className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className="h-full rounded-full bg-primary"
        style={{
          width: `${limit > 0 ? Math.min(100, (used / limit) * 100) : 0}%`,
        }}
      />
    </div>
  );
}

/**
 * The account's plan and this month's Cloud use; checked again when the window gets focus (after a
 * checkout). On Free it also lays out what Standard and Pro add, with one button to the plan page.
 */
export function PlanCard() {
  const [usage, setUsage] = useState<
    CloudUsageResult | { error: 'unknown' } | null
  >(null);

  useEffect(() => {
    let live = true;
    const refresh = () =>
      api
        .cloudUsage()
        .then((u) => live && setUsage(u))
        .catch(() => live && setUsage({ error: 'unknown' }));
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      live = false;
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const known = usage && !('error' in usage) ? usage : null;
  const free = known?.plan === 'free';

  return (
    <div className="mt-6 rounded-2xl border bg-card p-5">
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-muted-foreground">Plan</div>
          <div className="text-base font-medium">
            {known ? planName(known.plan) : usage ? 'Unavailable' : '…'}
          </div>
          {usage && 'error' in usage && (
            <div className="mt-1 text-xs text-muted-foreground">
              {usage.error === 'offline'
                ? "Can't check your plan offline"
                : "Couldn't check your plan"}
            </div>
          )}
        </div>
        {known && !free && <PlanButton plan={known.plan} />}
      </div>

      {known && (
        <div className="mt-4">
          <div className="text-xs text-muted-foreground">
            Cloud transcription: {usageText(known)}
          </div>
          <UsageBar used={known.used} limit={known.limit} />
        </div>
      )}

      {free && (
        <div className="mt-6 border-t pt-5">
          <div className="text-sm font-medium">More Cloud time and storage</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Free includes 30 minutes of Cloud transcription a month and 250 MB
            of storage.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {PAID.map((p) => (
              <div key={p.name} className="rounded-xl border p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-sm">{p.price}</span>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  {p.yearly}
                </div>
                <ul className="mt-3 space-y-1.5 text-sm">
                  {p.benefits.map((b) => (
                    <li key={b} className="flex gap-2">
                      <CheckIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <PlanButton plan="free" size="default" />
            <span className="text-xs text-muted-foreground">
              Launch price, kept for as long as you stay subscribed. Opens in
              your browser.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
