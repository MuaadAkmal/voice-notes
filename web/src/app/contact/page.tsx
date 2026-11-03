import type { Metadata } from "next";
import { Prose } from "@/components/Prose";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact",
  description: "How to reach Voice Notes about the app, your account or a payment.",
};

export default function Contact() {
  return (
    <Prose title="Contact" updated="3 November 2026">
      <p>
        For help with the app, your account, a payment or a refund, email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. We usually reply
        within two working days.
      </p>
      <p>
        For a payment, include the email address you sign in with and the payment ID from Razorpay&apos;s receipt, which starts with
        &ldquo;pay_&rdquo;.
      </p>
    </Prose>
  );
}
