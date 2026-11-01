const OPTIONS = [
  { name: "Voice Notes Cloud", detail: "120 free minutes a month. Sign in with Google and there's nothing to set up." },
  { name: "Built-in", detail: "Download a speech model and transcribe on your own PC." },
  { name: "Your own server", detail: "Point the app at any OpenAI-compatible Whisper server you run." },
];

export function Transcription() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
      <h2 className="text-3xl font-semibold sm:text-4xl">Three ways to turn a clip into text</h2>
      <dl className="mt-8 divide-y divide-border border-y border-border">
        {OPTIONS.map((option) => (
          <div key={option.name} className="grid gap-1 py-5 sm:grid-cols-[16rem_minmax(0,1fr)] sm:gap-6">
            <dt className="font-display text-lg font-semibold">{option.name}</dt>
            <dd className="leading-relaxed text-muted-foreground">{option.detail}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
