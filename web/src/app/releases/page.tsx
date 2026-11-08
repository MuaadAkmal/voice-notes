import type { Metadata } from "next";
import { Prose } from "@/components/Prose";

export const metadata: Metadata = {
  title: "What's new",
  description: "What changed in each version of Voice Notes for Windows.",
};

/** Newest first. Installed apps update on their own within the hour, so each entry is what people already have. */
const RELEASES: { version: string; date: string; items: string[] }[] = [
  {
    version: "3.9.0",
    date: "8 November 2026",
    items: [
      "Click the pill to type instead of speaking: a note, “remind me to…”, a calendar event, or a Pixie command. Anything else goes straight into Quick notes.",
      "Under the box, Undo last and Move last to… fix your latest command even after its message has gone.",
      "With Cloud, voice notes are cleaned up as they are transcribed: fillers and false starts go, your words stay.",
      "Polished audio: hear a note read back clearly in one of six voices, and switch between it and the original.",
      "On Pro, clone your own voice once and every polished note sounds like you.",
      "Clicking the pill no longer starts a recording; hold your hotkey to speak.",
    ],
  },
  {
    version: "3.8.3",
    date: "5 November 2026",
    items: [
      "Changes that were being sent when the app closed or crashed now sync next time instead of waiting forever.",
      "A very long page no longer holds up syncing your other changes.",
      "A recording saved just before a crash now reaches your other devices.",
      "Closing a voice block while the microphone is starting no longer leaves it recording.",
    ],
  },
  {
    version: "3.8.2",
    date: "5 November 2026",
    items: ["A What’s new link, in the update bar and in Settings, opens these notes for the version you’re getting."],
  },
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
