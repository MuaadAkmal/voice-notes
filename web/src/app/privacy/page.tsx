import type { Metadata } from "next";
import { Prose } from "@/components/Prose";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Voice Notes keeps on your PC, what it sends, and who receives it.",
};

export default function Privacy() {
  return (
    <Prose title="Privacy" updated="1 November 2026">
      <p>
        Voice Notes keeps your recordings, pages and settings on your PC. Anything else on this page happens only if you use the feature it
        describes.
      </p>

      <h2>This website</h2>
      <p>This site sets no cookies and has no analytics. It&apos;s hosted on Cloudflare, which handles requests to it, including the installer download.</p>

      <h2>Without an account</h2>
      <ul>
        <li>The app doesn&apos;t need an account. Notes, audio, pages and film mode&apos;s audio buffer stay on your PC. Film mode&apos;s buffer is held in memory and is saved only when you press the shortcut.</li>
        <li>Each note stores the title of the window in front when you recorded it, on your PC.</li>
        <li>The app contains no analytics. It checks our update server for new versions.</li>
        <li>If you use the built-in transcription, the engine and model download from GitHub and Hugging Face, and clips are transcribed on your PC.</li>
        <li>If you use your own Whisper server, clips go to that server. We don&apos;t see them.</li>
      </ul>

      <h2>Signing in</h2>
      <p>
        Sign-in uses your Google account through Supabase, our backend provider. We receive your account details from Google, such as your name,
        email address and photo.
      </p>

      <h2>Sync</h2>
      <p>
        Sync is optional. If you turn it on, your notes, transcripts, pages, folders, audio, page images and some settings are stored in your
        account on Supabase, so that your other PCs can get them. When you delete a note or page, its files are removed from the server and its
        record is cleared after 30 days.
      </p>

      <h2>Voice Notes Cloud transcription</h2>
      <p>
        If you choose Cloud, each clip you transcribe goes through our server to ElevenLabs, which turns it into text. This includes dictation and,
        if voice to folders is on, the first 4 seconds of each new voice note. We don&apos;t store the clip on our server. We count the seconds you
        use against your monthly allowance.
      </p>

      <h2>Voice commands and reminders</h2>
      <p>
        When a dictation starts with a wake word, the words you said and the titles of your pages, but never their contents, go through our server to
        Groq, which works out where the words belong. If the app can&apos;t read the time in a voice reminder itself, the reminder&apos;s words, your
        current time and your time zone go to Groq the same way. We count these requests to apply a daily limit.
      </p>
      <p>
        When you say &ldquo;add this to&rdquo; a page, what the window in front is showing isn&apos;t sent. The app writes its own line for that
        window on your PC, which can include its address, file path or a screenshot. That line then syncs like the rest of the page if sync is on.
      </p>

      <h2>Google Calendar</h2>
      <p>
        Connecting Google Calendar is optional and asks for separate permission. Our server keeps an encrypted refresh token so that your PCs can get
        short-lived access. The app then talks to Google directly to read your events and add the ones you ask for, so event details don&apos;t pass
        through our server. You can disconnect on the Connectors page.
      </p>

      <h2>Deleting your data</h2>
      <p>
        Deleting the app&apos;s data folder removes what&apos;s on your PC. To have your account and everything stored with it deleted, email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>Questions</h2>
      <p>
        Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. If this policy changes, we&apos;ll update this page and its date.
      </p>
    </Prose>
  );
}
