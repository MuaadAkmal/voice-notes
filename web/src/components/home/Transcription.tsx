import { Reveal } from "../Reveal";

const OPTIONS = [
  { name: "Voice Notes Cloud", detail: "30 free minutes a month, more with Standard or Pro. Sign in with Google and there's nothing to set up." },
  { name: "Built-in", detail: "Download a speech model and transcribe on your own PC." },
  { name: "Your own server", detail: "Point the app at any OpenAI-compatible Whisper server you run." },
];

export function Transcription() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6">
      <Reveal>
        <h2 className="text-center text-3xl font-semibold sm:text-5xl">Three ways to turn a clip into text</h2>
      </Reveal>
      <Reveal delay={0.1}>
        <dl className="glass mt-12 divide-y divide-border rounded-3xl px-7 py-2">
          {OPTIONS.map((option) => (
            <div key={option.name} className="grid gap-1 py-6 sm:grid-cols-[15rem_minmax(0,1fr)] sm:gap-6">
              <dt className="text-lg font-semibold tracking-tight">{option.name}</dt>
              <dd className="leading-relaxed text-muted-foreground">{option.detail}</dd>
            </div>
          ))}
        </dl>
      </Reveal>
    </section>
  );
}
