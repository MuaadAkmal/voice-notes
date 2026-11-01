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
    <section className="border-y border-border bg-muted">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-3xl font-semibold sm:text-4xl">Your own voice works too</h2>
        <div className="mt-10 grid gap-12 md:grid-cols-2">
          {SHORTCUTS.map((item) => (
            <div key={item.title}>
              <p className="flex gap-2" aria-label={`Shortcut: ${item.keys.join(" and ")}`}>
                {item.keys.map((key) => (
                  <kbd key={key} className="rounded-lg border border-border bg-card px-3 py-1.5 font-sans text-sm font-medium shadow-sm">
                    {key}
                  </kbd>
                ))}
              </p>
              <h3 className="mt-4 text-xl font-semibold">{item.title}</h3>
              <p className="mt-2 leading-relaxed text-muted-foreground">{item.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
