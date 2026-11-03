import type { Metadata } from "next";
import Link from "next/link";
import { Prose } from "@/components/Prose";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms",
  description: "The terms for using Voice Notes and its online services.",
};

export default function Terms() {
  return (
    <Prose title="Terms" updated="3 November 2026">
      <p>By using Voice Notes, you agree to these terms.</p>

      <h2>Plans and payment</h2>
      <p>
        Voice Notes has a free plan and two paid plans, Standard and Pro, sold as subscriptions in Indian rupees through Razorpay. The{" "}
        <Link href="/#pricing">pricing</Link> section lists what each plan includes.
      </p>
      <ul>
        <li>A subscription renews automatically every month or year at the same price until you cancel.</li>
        <li>You can cancel anytime. The plan lasts until the end of the period you&apos;ve paid for.</li>
        <li>
          Refunds follow the <Link href="/refund">refund and cancellation policy</Link>.
        </li>
        <li>A founding member price stays the same for as long as that subscription stays active.</li>
      </ul>

      <h2>The app is provided as is</h2>
      <p>
        We provide Voice Notes and its online services as they are, without warranties. To the extent the law allows, we aren&apos;t liable for lost
        data or other losses from using them. Keep your own copies of anything important.
      </p>

      <h2>Online services can change</h2>
      <p>Sync, Voice Notes Cloud and voice commands can change or stop. This includes the free plan&apos;s allowance and other limits. A paid plan&apos;s allowance doesn&apos;t shrink during a period you&apos;ve paid for.</p>

      <h2>Use it fairly</h2>
      <ul>
        <li>Don&apos;t try to get around usage limits, or disrupt or break into the services.</li>
        <li>Only record and save what you have the right to. Follow the law and the terms of what you watch, and get consent where recording someone requires it.</li>
      </ul>
      <p>We can suspend access to the online services if these rules are broken.</p>

      <h2>Your content</h2>
      <p>Your notes and recordings stay yours. We handle them only to run the features you use, as described in the <a href="/privacy">privacy policy</a>.</p>

      <h2>Changes and questions</h2>
      <p>
        If these terms change, we&apos;ll update this page and its date. Questions go to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </Prose>
  );
}
