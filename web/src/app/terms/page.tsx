import type { Metadata } from "next";
import { Prose } from "@/components/Prose";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms",
  description: "The terms for using Voice Notes and its online services.",
};

export default function Terms() {
  return (
    <Prose title="Terms" updated="1 November 2026">
      <p>By using Voice Notes, you agree to these terms.</p>

      <h2>The app is provided as is</h2>
      <p>
        We provide Voice Notes and its online services as they are, without warranties. To the extent the law allows, we aren&apos;t liable for lost
        data or other losses from using them. Keep your own copies of anything important.
      </p>

      <h2>Online services can change</h2>
      <p>Sync, Voice Notes Cloud and voice commands can change or stop. This includes the free allowance of 120 Cloud minutes a month and other limits.</p>

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
