import { Reveal } from "../Reveal";

const QUOTES = [
  { text: "Docendo discimus.", meaning: "By teaching, we learn.", who: "Seneca" },
  { text: "If you can’t explain it simply, you don’t understand it well enough.", who: "Albert Einstein" },
  { text: "What I cannot create, I do not understand.", who: "Richard Feynman, on his blackboard, 1988" },
];

/** Why explaining out loud works, in three people's words. */
export function Quotes() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6">
      <div className="grid gap-5 md:grid-cols-3">
        {QUOTES.map((q, i) => (
          <Reveal key={q.who} delay={0.06 * i} className="h-full">
            <figure className="glass flex h-full flex-col rounded-3xl p-7">
              <blockquote className="flex-1 text-xl leading-snug font-medium">
                &ldquo;{q.text}&rdquo;
                {q.meaning && <span className="mt-2 block text-base font-normal text-muted-foreground">{q.meaning}</span>}
              </blockquote>
              <figcaption className="mt-5 text-sm text-muted-foreground">{q.who}</figcaption>
            </figure>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
