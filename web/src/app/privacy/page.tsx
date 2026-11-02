import type { Metadata } from "next";
import { Prose } from "@/components/Prose";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Voice Notes keeps on your PC, what it sends, and who receives it.",
};

export default function Privacy() {
  return (
    <Prose title="Privacy" updated="2 November 2026">
      <p>
        Voice Notes needs a Google account. It keeps your recordings, pages and settings on your PC and syncs them to your account. This page says
        what goes where.
      </p>

      <h2>This website</h2>
      <p>This site sets no cookies and has no analytics. It&apos;s hosted on Cloudflare, which handles requests to it, including the installer download.</p>

      <h2>On your PC</h2>
      <ul>
        <li>Each account that signs in on a PC has its own library there. Signing out keeps it on the PC for the next time you sign in, and other accounts can&apos;t see it in the app.</li>
        <li>Film mode&apos;s audio buffer is held in memory and is saved only when you press the shortcut.</li>
        <li>Each note stores the title of the window in front when you recorded it. It syncs with the note.</li>
        <li>The app contains no analytics. It checks our update server for new versions.</li>
        <li>If you use the built-in transcription, the engine and model download from GitHub and Hugging Face, and clips are transcribed on your PC.</li>
        <li>If you use your own Whisper server, clips go to that server. We don&apos;t see them.</li>
      </ul>

      <h2>Signing in</h2>
      <p>
        You sign in with your Google account through Supabase, our backend provider. We receive your account details from Google, such as your
        name, email address and photo.
      </p>

      <h2>Sync</h2>
      <p>
        Your notes, transcripts, pages, folders, audio, page images and some settings are stored in your account on Supabase, so that your other
        PCs can get them. This includes the window title saved with each note and your PC&apos;s name.
      </p>
      <p>
        When you delete a note or page, its audio and images are removed from the server. Its text, such as a note&apos;s title and transcript or a
        page&apos;s body, stays in your account on the server, hidden from your PCs, until your account is deleted.
      </p>

      <h2>Voice Notes Cloud transcription</h2>
      <p>
        If you haven&apos;t set up another transcription provider, Cloud is used automatically. You can choose another provider
        on the Transcription page.
      </p>
      <p>
        With Cloud, each clip you transcribe and each dictation goes through our server to ElevenLabs, which turns it into text. Voice to folders is
        on by default, so the first 4 seconds of each new microphone voice note are sent too, whether or not you say a wake word. You can turn this
        off on the Connectors page.
      </p>
      <p>
        We don&apos;t store the clip on our server, but we count the seconds you use against your monthly allowance. ElevenLabs handles what it receives
        under <a href="https://elevenlabs.io/privacy-policy">its own privacy policy</a> and may keep it for a time.
      </p>

      <h2>Voice commands and reminders</h2>
      <p>
        When a dictation starts with a wake word, the words you said and the titles of your pages, but never their contents, go through our server to
        Groq, which works out where the words belong. If the app can&apos;t read the time in a reminder itself, whether spoken or typed, the
        reminder&apos;s words, your current time and your time zone go to Groq the same way. We count these requests to apply a daily limit. Groq handles
        what it receives under <a href="https://groq.com/privacy-policy">its own privacy policy</a>.
      </p>
      <p>
        When you say &ldquo;add this to&rdquo; a page, what the window in front is showing isn&apos;t sent. The app writes its own line for that
        window on your PC, which can include its address, file path or a screenshot. That line then syncs like the rest of the page.
      </p>

      <h2>Google Calendar</h2>
      <p>
        Connecting Google Calendar is optional and asks for separate permission. Our server keeps an encrypted refresh token so that your PCs can get
        short-lived access. The app then talks to Google directly to read your events and add the ones you ask for, so event details don&apos;t pass
        through our server. While connected, each reminder is also added to your calendar, and moved or removed when you change it. You can
        disconnect on the Connectors page.
      </p>

      <h2>Deleting your data</h2>
      <p>
        Deleting the app&apos;s data folder removes what&apos;s on your PC, for every account that signed in on it. To have your account and everything stored with it deleted, email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>Questions</h2>
      <p>
        Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. If this policy changes, we&apos;ll update this page and its date.
      </p>
    </Prose>
  );
}
