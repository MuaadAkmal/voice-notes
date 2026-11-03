import { Reveal } from "../Reveal";

const SHORTCUTS = [
  {
    keys: ["Alt", "Win"],
    title: "Say it in your own voice",
    body: "Hold the keys and speak to save a voice note from any app. Useful for trying out a sentence, or for keeping a word you want to look up.",
  },
  {
    keys: ["Ctrl", "Win"],
    title: "Type by talking",
    body: "Hold the keys and speak, and your words appear as text wherever your cursor is. Use it to write in the language you're learning.",
  },
];

export function EverydayCapture() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6">
      <Reveal>
        <h2 className="text-center text-3xl font-semibold sm:text-5xl">Your own voice works too</h2>
      </Reveal>
      <div className="mt-12 grid gap-4 md:grid-cols-2">
        {SHORTCUTS.map((item, i) => (
          <Reveal key={item.title} delay={i * 0.1} className="h-full">
            <div className="glass glass-hover h-full rounded-3xl p-8">
              <p className="flex gap-2" aria-label={`Shortcut: ${item.keys.join(" and ")}`}>
                {item.keys.map((key) => (
                  <kbd key={key} className="keycap font-sans">
                    {key}
                  </kbd>
                ))}
              </p>
              <h3 className="mt-6 text-2xl font-semibold">{item.title}</h3>
              <p className="mt-2.5 leading-relaxed text-muted-foreground">{item.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
