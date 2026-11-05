import type { Metadata } from "next";
import { Prose } from "@/components/Prose";

export const metadata: Metadata = {
  title: "What's new",
  description: "What changed in each version of Voice Notes for Windows.",
};

/** Newest first. Installed apps update on their own within the hour, so each entry is what people already have. */
const RELEASES: { version: string; date: string; items: string[] }[] = [
  {
    version: "3.8.1",
    date: "5 November 2026",
    items: [
      "Pages show a small dot with the number of lines voice commands added, on the sidebar and on Home, until you open them.",
      "“Pixie” is heard more reliably, and a near miss like “Dixie, add milk to groceries” still works.",
      "The language learner understands more ways of saying it (“add the word taweel to Arabic”, “how do you say secret in Tamil”) and writes each word in its own script, with how it sounds and what it means.",
      "A page you have open now shows the lines a voice command just added to it.",
      "Your account page shows how much cloud storage you use, and the pill tells you at 80% and when it’s full.",
      "A long “Added” message on the pill always shows which page it went to, and the Move to… list looks right.",
    ],
  },
  {
    version: "3.8.0",
    date: "4 November 2026",
    items: [
      "New voice notes are transcribed on their own and get a short title written from what you said.",
      "Custom words: add names and jargon once, and every transcription spells them your way.",
      "The pill tells you when your Cloud minutes are 80% used, and when they run out.",
      "Undo, or Move to another page, right from the pill after a voice command adds something.",
      "Language learner: say “Pixie, I learned a new word in Arabic, shukran” and it lands on your Arabic page with how it sounds and what it means.",
      "A short welcome for new accounts, with a mic check and a few starter pages.",
      "Type /audio in a page to record a voice note right there.",
    ],
  },
];

export default function Releases() {
  return (
    <Prose title="What's new" updated={RELEASES[0].date}>
      <p>Voice Notes updates itself in the background. Here&apos;s what changed in each version.</p>
      {RELEASES.map((r) => (
        // id: the app's "What's new" link opens /releases#<version>; scroll-mt keeps it clear of the sticky header.
        <section key={r.version} id={r.version} className="scroll-mt-24">
          <h2>
            {r.version} <span className="text-base font-normal text-muted-foreground">· {r.date}</span>
          </h2>
          <ul className="mt-4">
            {r.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </Prose>
  );
}
