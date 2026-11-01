const STEPS = [
  {
    title: "Hear a line",
    body: "Watch as usual with film mode on. It holds your PC's last 60 seconds of sound in memory. Turn it on from the tray or Settings each time you open the app.",
  },
  {
    title: "Press Alt+Win+Shift",
    body: "The moments you just heard become a clip, saved with the name of the show. You don't have to pause or go back.",
  },
  {
    title: "Replay and transcribe",
    body: "Play the clip as many times as you need, then transcribe it to see the words. Transcripts are searchable and you can edit them.",
  },
];

export function HowItWorks() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
      <h2 className="text-3xl font-semibold sm:text-4xl">Save it after you hear it</h2>
      <ol className="mt-10 grid gap-10 md:grid-cols-3">
        {STEPS.map((step, i) => (
          <li key={step.title}>
            <span className="font-display text-5xl font-semibold text-muted-foreground">{i + 1}</span>
            <h3 className="mt-3 text-xl font-semibold">{step.title}</h3>
            <p className="mt-2 leading-relaxed text-muted-foreground">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
