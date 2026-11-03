import { Reveal } from "../Reveal";

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
    <section className="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6">
      <Reveal>
        <h2 className="text-center text-3xl font-semibold sm:text-5xl">Save it after you hear it</h2>
      </Reveal>
      <ol className="mt-12 grid gap-4 md:grid-cols-3">
        {STEPS.map((step, i) => (
          <li key={step.title}>
            <Reveal delay={i * 0.1} className="h-full">
              <div className="glass glass-hover h-full rounded-3xl p-7">
                <span className="flex size-10 items-center justify-center rounded-full bg-primary font-medium text-primary-foreground shadow-soft">
                  {i + 1}
                </span>
                <h3 className="mt-6 text-xl font-semibold">{step.title}</h3>
                <p className="mt-2.5 leading-relaxed text-muted-foreground">{step.body}</p>
              </div>
            </Reveal>
          </li>
        ))}
      </ol>
    </section>
  );
}
