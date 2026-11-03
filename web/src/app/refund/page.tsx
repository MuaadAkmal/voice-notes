import type { Metadata } from "next";
import { Prose } from "@/components/Prose";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Refunds and cancellation",
  description: "How Voice Notes subscriptions renew, how to cancel, and how refunds work.",
};

export default function Refund() {
  return (
    <Prose title="Refunds and cancellation" updated="3 November 2026">
      <p>
        Voice Notes has a free plan and two paid plans, Standard and Pro, billed monthly or yearly through Razorpay. This page says how paid plans
        renew, how to cancel and when you get your money back.
      </p>

      <h2>Delivery</h2>
      <p>
        A paid plan is a digital service, with nothing shipped. It applies to your Voice Notes account as soon as the payment goes through, usually
        within a minute, on every device signed in to that account.
      </p>

      <h2>Renewal</h2>
      <p>
        When you subscribe, you set up UPI Autopay or a card mandate. Your plan renews automatically at the end of each month or year and charges the
        same price, until you cancel. Founding member prices stay the same for as long as the subscription stays active.
      </p>

      <h2>Cancelling</h2>
      <p>
        You can cancel anytime from your account. Your plan keeps working until the end of the period you&apos;ve already paid for, and then your
        account goes back to the free plan. Nothing is deleted when you cancel. You can also cancel the mandate from your UPI app or your bank.
      </p>

      <h2>Refunds</h2>
      <ul>
        <li>
          If you&apos;re not happy, email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> within 7 days of a payment and we&apos;ll refund
          that payment in full. Your account goes back to the free plan.
        </li>
        <li>After 7 days, payments aren&apos;t refunded, but you can still cancel so the next one isn&apos;t taken.</li>
        <li>If you were charged twice or by mistake, email us and we&apos;ll refund the extra charge, whenever it happened.</li>
        <li>Refunds go back to the account or card you paid with, normally within 5 to 7 working days of our approval.</li>
      </ul>

      <h2>Failed payments</h2>
      <p>
        If a renewal can&apos;t be charged, Razorpay tries again over the next few days and your plan keeps working meanwhile. If it still can&apos;t be
        charged, your account goes back to the free plan, and you can subscribe again anytime.
      </p>

      <h2>Questions</h2>
      <p>
        Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. If this policy changes, we&apos;ll update this page and its date.
      </p>
    </Prose>
  );
}
