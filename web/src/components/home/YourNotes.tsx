const POINTS = [
  { title: "Folders and search", body: "Sort clips into folders by language or show, and search titles, shows and transcripts." },
  { title: "Text pages", body: "Keep word lists and grammar notes in markdown pages next to your clips." },
  { title: "A Home you arrange", body: "Pin the pages you use most, and add to a daily list from a quick-add box." },
  { title: "Sync between PCs", body: "Sign in with Google and turn on sync to keep notes, pages and audio the same on each PC." },
];

export function YourNotes() {
  return (
    <section className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,8fr)] lg:gap-14">
      <h2 className="text-3xl font-semibold sm:text-4xl">Everything you catch stays organised</h2>
      <dl className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
        {POINTS.map((point) => (
          <div key={point.title}>
            <dt className="font-semibold">{point.title}</dt>
            <dd className="mt-1.5 leading-relaxed text-muted-foreground">{point.body}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
