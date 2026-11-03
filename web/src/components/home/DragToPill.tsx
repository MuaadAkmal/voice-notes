"use client";

import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Reveal } from "../Reveal";

const EASE = [0.22, 1, 0.36, 1] as const;

// One link and one piece of text, each landing where the app would put it.
const ITEMS = [
  {
    label: "How to hear fast Spanish",
    page: "YouTube",
    saved: "Saved to YouTube ✓",
    line: "How to hear fast Spanish",
    earlier: "Ser vs estar in 6 minutes",
  },
  {
    label: "Ojalá comes from the Arabic for “if God wills”.",
    page: "Review later",
    saved: "Saved for later ✓",
    line: "Ojalá comes from the Arabic for “if God wills”.",
    earlier: "A recipe for arroz con leche",
  },
];

type Phase = "rest" | "approach" | "lift" | "carry" | "over" | "saved";
type Point = { x: number; y: number };
type Path = { rest: Point; source: Point; pill: Point };

const NEXT: Record<Phase, { to: Phase; ms: number }> = {
  rest: { to: "approach", ms: 350 },
  approach: { to: "lift", ms: 900 },
  lift: { to: "carry", ms: 300 },
  carry: { to: "over", ms: 750 },
  over: { to: "saved", ms: 650 },
  saved: { to: "rest", ms: 2600 },
};

export function DragToPill() {
  const reduce = useReducedMotion();
  const stage = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLDivElement>(null);
  const sources = useRef<(HTMLElement | null)[]>([]);
  const inView = useInView(stage, { amount: 0.4 });
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("saved");
  const [path, setPath] = useState<Path | null>(null);

  useEffect(() => {
    if (reduce || !inView) return;
    const { to, ms } = NEXT[phase];
    const timer = setTimeout(() => {
      if (to === "rest") {
        // Measured for each pass, so a resized window can't leave the drag aiming at an old spot.
        const next = (index + 1) % ITEMS.length;
        const box = stage.current?.getBoundingClientRect();
        const middle = (el: Element | null | undefined): Point => {
          const r = el?.getBoundingClientRect();
          return r && box ? { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top } : { x: 0, y: 0 };
        };
        setPath({
          rest: box ? { x: box.width * 0.5, y: box.height * 0.42 } : { x: 0, y: 0 },
          source: middle(sources.current[next]),
          pill: middle(pill.current),
        });
        setIndex(next);
      }
      setPhase(to);
    }, ms);
    return () => clearTimeout(timer);
  }, [phase, index, inView, reduce]);

  const item = ITEMS[index];
  const dragging = phase === "lift" || phase === "carry" || phase === "over";

  const target = (() => {
    if (!path) return { x: 0, y: 0 };
    if (phase === "rest") return path.rest;
    if (phase === "approach" || phase === "lift") return path.source;
    // The dragged item rides above the cursor, so it never covers what the pill says.
    return { x: path.pill.x, y: path.pill.y - (phase === "carry" ? 44 : 14) };
  })();
  const duration = phase === "rest" ? 0 : NEXT[phase === "saved" ? "over" : phase].ms / 1000;

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6">
      <Reveal>
        <h2 className="text-center text-3xl font-semibold sm:text-5xl">Save what intrigues you</h2>
        <p className="mx-auto mt-4 max-w-xl text-center text-lg leading-relaxed text-muted-foreground">
          From movie lines to midnight rabbit holes, Voice Notes keeps it all. Drag a link or some text from your browser onto the pill, and it&apos;s
          there when you come back.
        </p>
      </Reveal>

      <Reveal delay={0.1}>
        <div
          ref={stage}
          role="img"
          aria-label="A link is dragged from a browser window onto the Voice Notes pill, which shows Saved to YouTube, and the link appears on the YouTube page."
          className="relative mt-12 grid gap-4 md:grid-cols-[1.15fr_1fr]"
        >
          <div className="glass overflow-hidden rounded-2xl" aria-hidden="true">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <span className="size-2.5 rounded-full bg-foreground/15" />
              <span className="size-2.5 rounded-full bg-foreground/15" />
              <span className="ml-2 truncate rounded-full bg-foreground/5 px-3 py-1 text-xs text-muted-foreground">learnspanish.example/listening</span>
            </div>
            <div className="p-5 sm:p-6">
              <p className="text-lg font-semibold">Why films feel so much faster</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Native speakers join words together. Start with slow clips, like{" "}
                <span
                  ref={(el) => {
                    sources.current[0] = el;
                  }}
                  className={`text-accent underline underline-offset-2 transition-opacity ${index === 0 && dragging ? "opacity-50" : ""}`}
                >
                  {ITEMS[0].label}
                </span>
                , then build up to full scenes.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                You&apos;ll also hear old loanwords everywhere.{" "}
                <span
                  ref={(el) => {
                    sources.current[1] = el;
                  }}
                  className={`rounded bg-accent/20 text-foreground transition-opacity ${index === 1 && dragging ? "opacity-50" : ""}`}
                >
                  {ITEMS[1].label}
                </span>
              </p>
            </div>
          </div>

          <div className="flex h-12 items-center justify-center md:order-last md:col-span-2" aria-hidden="true">
            <div ref={pill}>
              <DemoPill phase={phase} saved={item.saved} />
            </div>
          </div>

          <div className="glass rounded-2xl p-5 sm:p-6 md:row-start-1 md:col-start-2" aria-hidden="true">
            <p className="text-lg font-semibold">{item.page}</p>
            <p className="mt-3 text-sm font-medium">14 Nov 2026</p>
            <ul className="mt-2 space-y-2 text-sm">
              <PageLine text={item.earlier} />
              <AnimatePresence initial={false}>
                {phase === "saved" && (
                  <motion.li
                    key={item.line}
                    className="overflow-hidden"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.45, ease: EASE }}
                  >
                    <span className="flex items-start gap-2">
                      <Checkbox />
                      <span className={index === 0 ? "text-accent underline underline-offset-2" : ""}>{item.line}</span>
                    </span>
                  </motion.li>
                )}
              </AnimatePresence>
            </ul>
          </div>

          {path && (
            <motion.div
              className="pointer-events-none absolute top-0 left-0 z-20"
              aria-hidden="true"
              animate={{ x: target.x, y: target.y, opacity: phase === "saved" ? 0 : 1 }}
              transition={{ duration, ease: EASE, opacity: { duration: 0.25 } }}
            >
              <motion.div
                className="glass absolute bottom-full left-0 mb-1 w-max max-w-52 -translate-x-1/2 truncate rounded-lg px-3 py-1.5 text-xs font-medium"
                animate={{ opacity: dragging ? 1 : 0, scale: phase === "over" ? 0.85 : 1 }}
                transition={{ duration: 0.2 }}
              >
                {item.label}
              </motion.div>
              <svg viewBox="0 0 24 24" className="size-6 drop-shadow-md" aria-hidden="true">
                <path d="M5 3l14 8.5-6.2 1.4L9.4 19z" fill="var(--foreground)" stroke="var(--background)" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
            </motion.div>
          )}
        </div>
      </Reveal>

      <p className="mx-auto mt-6 max-w-xl text-center text-sm leading-relaxed text-muted-foreground">
        YouTube, Reddit and Instagram links each get their own page, and everything else goes to Review later. You can change where each site saves in
        Settings.
      </p>
    </section>
  );
}

/** Dark in both themes, like the pill on the desktop. */
function DemoPill({ phase, saved }: { phase: Phase; saved: string }) {
  const shell = "flex items-center justify-center rounded-full border border-white/15 bg-[#14151a] text-sm whitespace-nowrap text-white shadow-soft";
  const swap = { initial: { opacity: 0, scale: 0.92 }, animate: { opacity: 1, scale: 1 }, transition: { duration: 0.25, ease: EASE } };
  if (phase === "over")
    return (
      <motion.div key="over" {...swap} className={`${shell} h-10 gap-2 border-dashed border-sky-400/70 px-5 ring-2 ring-sky-400/30`}>
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
        </svg>
        Drop to save for later
      </motion.div>
    );
  if (phase === "saved")
    return (
      <motion.div key="saved" {...swap} className={`${shell} h-9 px-4`}>
        {saved}
      </motion.div>
    );
  return <motion.div key="idle" {...swap} className={`${shell} h-4 w-20`} />;
}

function PageLine({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2 text-muted-foreground">
      <Checkbox />
      {text}
    </li>
  );
}

function Checkbox() {
  return <span className="mt-0.5 size-3.5 shrink-0 rounded-[4px] border border-foreground/30" />;
}
