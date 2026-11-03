import { Reveal } from "../Reveal";

const POINTS = [
  { title: "Folders and search", body: "Sort clips into folders by language or show, and search titles, shows and transcripts." },
  { title: "Text pages", body: "Keep word lists and grammar notes in markdown pages next to your clips." },
  { title: "A Home you arrange", body: "Pin the pages you use most, and add to a daily list from a quick-add box." },
  { title: "Sync between PCs", body: "Your notes, pages and audio stay the same on each PC you sign in on." },
];

export function YourNotes() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6">
      <Reveal>
        <h2 className="text-center text-3xl font-semibold sm:text-5xl">Turn what you hear and find into notes you&apos;ll actually revisit</h2>
      </Reveal>
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {POINTS.map((point, i) => (
          <Reveal key={point.title} delay={i * 0.08} className="h-full">
            <div className="glass glass-hover h-full rounded-3xl p-6">
              <h3 className="text-lg font-semibold">{point.title}</h3>
              <p className="mt-2 leading-relaxed text-muted-foreground">{point.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
