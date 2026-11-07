"use client";

import { useState } from "react";
import { CONTACT_EMAIL, DOWNLOAD_URL, WEB_APP_URL } from "@/lib/site";
import { Reveal } from "../Reveal";

type Period = "monthly" | "annual";

type Price = { now: string; was: string; unit: string; note?: string; save?: string };

type Plan = {
  id: "free" | "standard" | "pro";
  name: string;
  popular?: boolean;
  price: Record<Period, Price>;
  features: string[];
  cta: string;
};

const FREE_PRICE: Price = { now: "₹0", was: "", unit: "" };

/** On every plan, so each card lists them rather than pointing at another card. */
const SHARED = [
  "Pixie voice commands: say it, and it lands on the right list",
  "Voice to calendar: say “calendar…” to add a Google Calendar event",
  "Sync between all your devices",
];

const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    price: { monthly: FREE_PRICE, annual: FREE_PRICE },
    features: ["30 minutes of Cloud transcription every month", "250 MB storage", ...SHARED],
    cta: "Start free",
  },
  {
    id: "standard",
    name: "Standard",
    popular: true,
    price: {
      monthly: { now: "₹129", was: "₹159", unit: "/month" },
      annual: { now: "₹1,299", was: "₹1,599", unit: "/year", note: "About ₹108 a month", save: "Save 16%" },
    },
    features: ["5 hours of Cloud transcription every month", "5 GB storage", ...SHARED],
    cta: "Get Standard",
  },
  {
    id: "pro",
    name: "Pro",
    price: {
      monthly: { now: "₹299", was: "₹349", unit: "/month" },
      annual: { now: "₹2,999", was: "₹3,499", unit: "/year", note: "About ₹250 a month", save: "Save 16%" },
    },
    features: [
      "10 hours of Cloud transcription every month",
      "20 GB storage",
      "Hear your notes in your own voice: clone it once, and every polished note sounds like you",
      ...SHARED,
    ],
    cta: "Get Pro",
  },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "What counts toward my monthly hours?",
    a: "Only audio transcribed with Voice Notes Cloud. Hours reset every month. Transcription with the built-in engine or your own server never counts.",
  },
  {
    q: "What happens when I reach my monthly limit?",
    a: "Your notes stay saved. Cloud transcription pauses until your hours reset, and the built-in engine or your own server keeps working.",
  },
  {
    q: "What does founding member pricing mean?",
    a: "Your launch price stays the same for as long as your subscription is active.",
  },
  {
    q: "How does payment work?",
    a: "You pay through Razorpay with UPI Autopay or a card. It renews automatically each month or year until you cancel.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Cancel from your account and keep your plan until the end of the period you've paid for.",
  },
  {
    q: "Can I switch plans?",
    a: `Yes. Email ${CONTACT_EMAIL} and we'll move you to the other plan.`,
  },
  {
    q: "Which platforms are supported?",
    a: "Windows, and the web app in your browser. Android is coming soon.",
  },
  {
    q: "What happens to my notes if I cancel?",
    a: "Nothing is deleted. Your account goes back to Free, and your notes stay on your PCs and in your account.",
  },
  {
    q: "Is my voice data private?",
    a: "Your notes and recordings are stored in your account so your devices can sync them. Cloud clips are sent to our transcription provider and aren't stored on our server. We don't use your recordings to train AI. The privacy policy has the details.",
  },
];

const checkoutUrl = (plan: Plan["id"], period: Period) => `${WEB_APP_URL}/account?plan=${plan}&period=${period}`;

function Check() {
  return (
    <svg viewBox="0 0 16 16" className="mt-1.5 size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  );
}

function PeriodToggle({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  return (
    <div role="radiogroup" aria-label="Billing period" className="glass inline-flex rounded-full p-1 text-sm font-medium">
      {(["monthly", "annual"] as const).map((p) => (
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={period === p}
          onClick={() => onChange(p)}
          className={`rounded-full px-5 py-2 transition-colors ${period === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          {p === "monthly" ? "Monthly" : "Annual"}
        </button>
      ))}
    </div>
  );
}

function PlanCard({ plan, period }: { plan: Plan; period: Period }) {
  const price = plan.price[period];
  const href = plan.id === "free" ? DOWNLOAD_URL : checkoutUrl(plan.id, period);
  return (
    <div className={`glass relative flex h-full flex-col rounded-3xl p-7 sm:p-8 ${plan.popular ? "ring-2 ring-foreground" : ""}`}>
      {plan.popular && (
        <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3.5 py-1 text-xs font-medium whitespace-nowrap text-primary-foreground">
          Most popular
        </span>
      )}
      <div className="flex items-center justify-between gap-3">
        <p className="text-lg font-semibold">{plan.name}</p>
        {price.save && <span className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium">{price.save}</span>}
      </div>
      <p className="mt-4 flex flex-wrap items-baseline gap-x-2">
        <span className="text-5xl font-semibold tracking-tight">{price.now}</span>
        {price.unit && <span className="text-muted-foreground">{price.unit}</span>}
        {price.was && (
          <s className="text-muted-foreground" aria-label={`Regular price ${price.was}`}>
            {price.was}
          </s>
        )}
      </p>
      <p className="mt-1 h-5 text-sm text-muted-foreground">{price.note ?? ""}</p>
      <ul className="mt-6 flex-1 space-y-3 leading-relaxed">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-3">
            <Check />
            {f}
          </li>
        ))}
      </ul>
      <a
        href={href}
        className={`mt-8 block rounded-full px-6 py-3.5 text-center font-medium ${plan.popular ? "btn-primary" : "border border-border transition-colors hover:bg-foreground/5"}`}
      >
        {plan.cta}
      </a>
    </div>
  );
}

export function Pricing() {
  const [period, setPeriod] = useState<Period>("annual");
  return (
    <section id="pricing" className="mx-auto w-full max-w-5xl scroll-mt-24 px-4 py-14 sm:px-6">
      <Reveal className="text-center">
        <h2 className="text-3xl font-semibold sm:text-5xl">Speak it. Keep it. Learn from it.</h2>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
          Record from movies or anywhere else, transcribe it, and save it to revisit later.
        </p>
        <p className="glass mx-auto mt-6 inline-block rounded-full px-5 py-2 text-sm">
          Founding member offer: lock in launch pricing for as long as you stay subscribed.
        </p>
        <div className="mt-8">
          <PeriodToggle period={period} onChange={setPeriod} />
        </div>
      </Reveal>

      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {PLANS.map((plan, i) => (
          <Reveal key={plan.id} delay={0.05 * i} className="h-full">
            <PlanCard plan={plan} period={period} />
          </Reveal>
        ))}
      </div>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        Secure payment via Razorpay. 7-day refund. Cancel anytime. Questions?{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="underline underline-offset-4 hover:text-foreground">
          {CONTACT_EMAIL}
        </a>
      </p>

      <Reveal className="mx-auto mt-14 max-w-3xl">
        <h3 className="text-center text-2xl font-semibold">Questions</h3>
        <div className="mt-6 space-y-3">
          {FAQ.map(({ q, a }) => (
            <details key={q} className="glass group rounded-2xl px-6 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                {q}
                <span aria-hidden="true" className="text-xl leading-none text-muted-foreground transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 leading-relaxed text-muted-foreground">{a}</p>
            </details>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
