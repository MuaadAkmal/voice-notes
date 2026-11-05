"use client";

import { ArrowLeftIcon, CheckIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { SignIn } from "@/components/SignIn";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/useSession";
import {
  BillingError,
  type BillingStatus,
  type PaidPlan,
  type Period,
  PLAN_NAMES,
  PRICES,
  cancelSubscription,
  formatBytes,
  formatDate,
  formatHours,
  getStatus,
  holdsPlan,
  setReturnTo,
  subscribe,
} from "@/lib/billing";

const SHARED = [
  "Pixie voice commands: say it, and it lands on the right list",
  "Voice to calendar: say “calendar…” to add a Google Calendar event",
  "Sync between all your devices",
];

const FEATURES: Record<PaidPlan, string[]> = {
  standard: ["5 hours of Cloud transcription every month", "5 GB storage", ...SHARED],
  pro: ["10 hours of Cloud transcription every month", "20 GB storage", ...SHARED],
};

/** ?plan=standard&period=annual, as the website's pricing buttons send it. */
function requested(): { plan: PaidPlan; period: Period } | null {
  const q = new URLSearchParams(location.search);
  const plan = q.get("plan");
  const period = q.get("period");
  if ((plan === "standard" || plan === "pro") && (period === "monthly" || period === "annual")) return { plan, period };
  return null;
}

function message(err: unknown): string {
  if (err instanceof BillingError) {
    if (err.code === "offline") return "You're offline. Try again when you're connected.";
    if (err.code === "already_subscribed") return "This account already has a plan.";
    if (err.code === "checkout_busy") return "A checkout is already open, maybe in another tab. Finish it there, or try again in a minute.";
    if (err.status === 401) return "Sign in again to continue.";
    if (err.code === "provider_failed") return "Razorpay didn't answer. Try again in a minute.";
  }
  return "Something went wrong. Try again in a minute.";
}

function Meter({ label, used, limit, text }: { label: string; used: number; limit: number; text: string }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{text}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-foreground transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function PlanSummary({ status, onCancel, cancelling }: { status: BillingStatus; onCancel(): void; cancelling: boolean }) {
  const sub = status.subscription;
  const holding = holdsPlan(status);
  let line = "30 minutes of Cloud transcription a month and 250 MB of storage.";
  if (holding && sub) {
    if (sub.status === "authenticated") line = "Setting up your plan. This takes a moment.";
    else if (sub.status === "pending") line = "Your last renewal didn't go through. Razorpay is trying again, and your plan keeps working meanwhile.";
    else if (sub.cancelAtPeriodEnd && sub.currentEnd) line = `Cancelled. Your plan lasts until ${formatDate(sub.currentEnd)}, then the account goes back to Free.`;
    else if (sub.currentEnd) line = `Renews on ${formatDate(sub.currentEnd)}${sub.period === "annual" ? ", yearly" : ", monthly"}.`;
  } else if (sub?.status === "halted") {
    line = "Your last payment didn't go through, so the account is back on Free. You can subscribe again below.";
  }
  return (
    <section className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
      <p className="text-sm text-muted-foreground">Your plan</p>
      <h2 className="mt-1 text-3xl font-semibold tracking-tight">{PLAN_NAMES[status.plan] ?? status.plan}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{line}</p>
      <div className="mt-6 space-y-5">
        <Meter
          label="Cloud transcription"
          used={status.cloud.used}
          limit={status.cloud.limit}
          text={`${formatHours(status.cloud.used)} of ${formatHours(status.cloud.limit)} · resets ${formatDate(status.cloud.resetsAt)}`}
        />
        <Meter label="Storage" used={status.storage.used} limit={status.storage.limit} text={`${formatBytes(status.storage.used)} of ${formatBytes(status.storage.limit)}`} />
      </div>
      {holding && sub && !sub.cancelAtPeriodEnd && sub.status !== "authenticated" && (
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-5 text-sm">
          <Button variant="outline" disabled={cancelling} onClick={onCancel}>
            {cancelling ? "Cancelling…" : "Cancel subscription"}
          </Button>
          <span className="text-muted-foreground">
            To switch plans, email <a className="underline underline-offset-4" href="mailto:hello@voicenote.cloud">hello@voicenote.cloud</a>.
          </span>
        </div>
      )}
    </section>
  );
}

/** Standard and Pro side by side; `chosen` (the website button the person clicked, else Standard) is highlighted. */
function Plans({ busy, onChoose, initial, chosen }: { busy: PaidPlan | null; onChoose(plan: PaidPlan, period: Period): void; initial: Period; chosen: PaidPlan }) {
  const [period, setPeriod] = useState<Period>(initial);
  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Upgrade</h2>
        <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-full border bg-card p-1 text-sm">
          {(["monthly", "annual"] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={period === p}
              onClick={() => setPeriod(p)}
              className={`rounded-full px-4 py-1.5 transition-colors ${period === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {p === "monthly" ? "Monthly" : "Annual · save 16%"}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">Founding member offer: your launch price stays the same for as long as you stay subscribed.</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {(["standard", "pro"] as const).map((plan) => {
          const price = PRICES[plan][period];
          return (
            <div key={plan} className={`flex flex-col rounded-2xl border bg-card p-6 shadow-sm ${plan === chosen ? "ring-2 ring-foreground" : ""}`}>
              <div className="flex items-center justify-between">
                <p className="font-semibold">{PLAN_NAMES[plan]}</p>
                {plan === "standard" && <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs text-primary-foreground">Most popular</span>}
              </div>
              <p className="mt-3 flex flex-wrap items-baseline gap-x-2">
                <span className="text-3xl font-semibold tracking-tight">{price.now}</span>
                <span className="text-sm text-muted-foreground">{price.unit}</span>
                <s className="text-sm text-muted-foreground" aria-label={`Regular price ${price.was}`}>
                  {price.was}
                </s>
              </p>
              <p className="h-5 text-xs text-muted-foreground">{price.note ?? ""}</p>
              <ul className="mt-4 flex-1 space-y-2 text-sm">
                {FEATURES[plan].map((f) => (
                  <li key={f} className="flex gap-2">
                    <CheckIcon className="mt-0.5 size-4 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button className="mt-6 w-full" size="lg" variant={plan === chosen ? "default" : "outline"} disabled={busy !== null} onClick={() => onChoose(plan, period)}>
                {busy === plan ? "Opening Razorpay…" : `Get ${PLAN_NAMES[plan]}`}
              </Button>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Secure payment via Razorpay with UPI Autopay or a card. Renews automatically until you cancel. 7-day refund, see the{" "}
        <a className="underline underline-offset-4" href="https://voicenote.cloud/refund/">
          refund policy
        </a>
        .
      </p>
    </section>
  );
}

function Account({ email }: { email: string | null }) {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState<PaidPlan | null>(null);
  const [cancelling, setCancelling] = useState(false);
  // The website button that brought the person here (?plan=&period=): preselected, never paid without a click.
  const [initial] = useState(() => requested() ?? { plan: "standard" as const, period: "annual" as const });

  const load = useCallback(
    () =>
      getStatus().then(
        (s) => {
          setStatus(s);
          setFailed(null);
          return s;
        },
        (err) => {
          setFailed(message(err));
          return null;
        },
      ),
    [],
  );

  const choose = useCallback(
    async (plan: PaidPlan, period: Period) => {
      setBusy(plan);
      try {
        const paid = await subscribe(plan, period, email, (m) => toast.error(m));
        if (paid) {
          setStatus(paid);
          toast.success(`You're on ${PLAN_NAMES[paid.plan] ?? paid.plan}. Thank you!`);
        }
      } catch (err) {
        toast.error(message(err));
        // The payment may still have gone through: Razorpay's webhook decides, so look again shortly.
        setTimeout(() => void load(), 4000);
      } finally {
        setBusy(null);
      }
    },
    [email, load],
  );

  useEffect(() => {
    if (requested()) history.replaceState(null, "", location.pathname);
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const cancel = async () => {
    const end = status?.subscription?.currentEnd;
    if (!confirm(`Cancel your subscription? Your plan keeps working${end ? ` until ${formatDate(end)}` : " until the end of the period you've paid for"}, then the account goes back to Free.`)) return;
    setCancelling(true);
    try {
      setStatus(await cancelSubscription());
      toast.success("Cancelled. Nothing more will be charged.");
    } catch (err) {
      toast.error(message(err));
    } finally {
      setCancelling(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">
      <div className="flex items-center justify-between">
        <a href="/app/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-4" />
          Notes
        </a>
        <ThemeToggle className="text-muted-foreground" />
      </div>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Plan and billing</h1>
      {email && <p className="mt-1 text-sm text-muted-foreground">{email}</p>}
      <div className="mt-6">
        {status ? (
          <>
            <PlanSummary status={status} onCancel={cancel} cancelling={cancelling} />
            {!holdsPlan(status) && <Plans busy={busy} onChoose={(p, per) => void choose(p, per)} initial={initial.period} chosen={initial.plan} />}
          </>
        ) : failed ? (
          <div className="rounded-2xl border bg-card p-6 text-sm">
            <p>{failed}</p>
            <Button className="mt-4" variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="h-64 animate-pulse rounded-2xl border bg-card" />
        )}
      </div>
    </main>
  );
}

export default function AccountPage() {
  const session = useSession();
  useEffect(() => {
    // Google sign-in always lands on /app/, which sends the person back here (with the chosen plan).
    if (session.state === "signed-out") setReturnTo(location.pathname + location.search);
  }, [session.state]);
  if (session.state === "loading") return null;
  if (session.state === "signed-out") return <SignIn />;
  return <Account email={session.email} />;
}
