"use client";

import { motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

const EASE = [0.22, 1, 0.36, 1] as const;
const BARS = [8, 14, 20, 12, 18, 10, 16];
const SHELL = "rounded-full border border-white/15 bg-[#14151a] text-white shadow-soft";

type Stop = {
  time: string;
  tab: string;
  window: string;
  scene: string;
  keys?: string[];
  say?: string;
  chip?: "save" | "pomodoro";
  page: string;
  earlier: string;
  added: string;
  task?: boolean; // false where the real thing has no checkbox
  pill: string;
  note: string;
};

// One day, from breakfast to a film. The pill's wording is the app's own; keep it that way if the app's changes.
const STOPS: Stop[] = [
  {
    time: "8:30",
    tab: "Ask Pixie",
    window: "Porridge recipe",
    scene: "You need oat milk, and you're out.",
    keys: ["Ctrl", "Win"],
    say: "“Pixie, add oat milk to my shopping list.”",
    page: "Shopping list",
    earlier: "Eggs",
    added: "Oat milk",
    pill: "Added · oat milk → Shopping list",
    note: "Sign in, and Pixie puts it on the page you meant.",
  },
  {
    time: "10:00",
    tab: "Pomodoro",
    window: "Essay draft",
    scene: "Time to get some work done.",
    chip: "pomodoro",
    page: "Pomodoro",
    earlier: "Focus, 25 min, done",
    added: "Focus, 25 min, started",
    task: false,
    pill: "24:59",
    note: "The pill fills as you work, and the Pomodoro tab keeps your streak.",
  },
  {
    time: "13:00",
    tab: "Schedule a meeting",
    window: "Email from Sam",
    scene: "“Can we meet on Friday at 3?”",
    keys: ["Ctrl", "Win"],
    say: "“Calendar, meeting with Sam on Friday at 3.”",
    page: "Google Calendar",
    earlier: "Fri 6 Nov, 09:00 · Gym",
    added: "Fri 6 Nov, 15:00 · Meeting with Sam",
    task: false,
    pill: "Added · Meeting with Sam · Fri 6 Nov, 15:00",
    note: "Connect Google Calendar once, then add events by voice.",
  },
  {
    time: "18:30",
    tab: "Save this page",
    window: "Why films feel so much faster",
    scene: "A good article, but you haven't got time now.",
    chip: "save",
    page: "Review later",
    earlier: "A recipe for arroz con leche",
    added: "Why films feel so much faster",
    pill: "Saved to Review later",
    note: "Keeps the window in front, with a link back when it's a browser tab.",
  },
  {
    time: "21:15",
    tab: "Catch a line",
    window: "El último verano",
    scene: "“¿Quién te ha contado eso?”",
    keys: ["Alt", "Win", "Shift"],
    page: "Inbox",
    earlier: "Ya es demasiado tarde para volver atrás.",
    added: "¿Quién te ha contado eso?",
    task: false,
    pill: "Saved ✓",
    note: "With film mode on, the last moments of your PC's sound become a clip.",
  },
];

type Phase = "move" | "listen" | "reveal" | "aim" | "added" | "point";

const after = (stop: Stop, phase: Phase): Phase | null => {
  const script: Phase[] = stop.chip ? ["move", "reveal", "aim", "added", "point"] : ["move", "listen", "added", "point"];
  return script[script.indexOf(phase) + 1] ?? null;
};

const hold = (stop: Stop, phase: Phase) => {
  if (phase === "move") return 950;
  if (phase === "listen") return stop.say ? 450 + stop.say.split(" ").length * 190 : 450;
  if (phase === "reveal") return 450;
  if (phase === "aim") return 800;
  if (phase === "added") return 800;
  return 3000;
};

/** The day's timeline: a cursor shows each feature being used, and the result lands where the app would put it. */
export function HeroFeatures() {
  const reduce = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const keys = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLDivElement>(null);
  const chips = useRef<Record<string, HTMLElement | null>>({});
  const row = useRef<HTMLDivElement>(null);
  const inView = useInView(root, { amount: 0.3 });
  const [active, setActive] = useState(0);
  const [phase, setPhase] = useState<Phase>("point"); // what shows without JavaScript or with reduced motion
  const [started, setStarted] = useState(false);
  const [chosen, setChosen] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [clicks, setClicks] = useState(0);

  const stop = STOPS[active];

  // Measured at every step, so a resized window can't leave the cursor aiming at an old spot.
  const go = (index: number, next: Phase) => {
    const target = STOPS[index];
    const el =
      next === "point"
        ? row.current
        : target.chip
          ? next === "aim" || next === "added"
            ? chips.current[target.chip]
            : pill.current
          : keys.current;
    const box = root.current?.getBoundingClientRect();
    const r = el?.getBoundingClientRect();
    if (box && r) setCursor({ x: r.left + Math.min(r.width / 2, 60) - box.left, y: r.top + r.height / 2 - box.top });
    if (next === "listen" || (next === "added" && target.chip)) setClicks((n) => n + 1);
    setActive(index);
    setPhase(next);
  };

  useEffect(() => {
    if (reduce || !inView) return;
    if (phase === "point" && chosen && started) return; // stays on the one that was picked
    const timer = setTimeout(
      () => {
        const next = after(STOPS[active], phase);
        if (next) return go(active, next);
        go(started ? (active + 1) % STOPS.length : active, "move");
        setStarted(true);
      },
      started ? hold(stop, phase) : 500,
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- go only reads refs and sets state
  }, [phase, active, chosen, started, inView, reduce]);

  const pick = (i: number) => {
    setChosen(true);
    setStarted(true);
    if (reduce) {
      setActive(i);
      return;
    }
    go(i, "move");
  };

  const pressing = phase === "listen";
  const heard = phase === "listen" || phase === "added" || phase === "point";
  const done = phase === "added" || phase === "point";
  const chipsUp = phase === "reveal" || phase === "aim" || (stop.chip === "pomodoro" && done);

  return (
    <div ref={root} className="relative">
      <div role="tablist" aria-label="A day with Voice Notes" className="relative mx-auto grid max-w-3xl grid-cols-5">
        <span className="absolute top-[2.05rem] right-[10%] left-[10%] h-0.5 rounded-full bg-foreground/10" aria-hidden="true" />
        <motion.span
          className="absolute top-[2.05rem] left-[10%] h-0.5 w-[80%] origin-left rounded-full bg-accent"
          aria-hidden="true"
          initial={false}
          animate={{ scaleX: active / (STOPS.length - 1) }}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 70, damping: 18 }}
        />
        {STOPS.map((item, i) => (
          <button
            key={item.tab}
            type="button"
            role="tab"
            id={`stop-tab-${i}`}
            aria-selected={i === active}
            aria-controls="stop-panel"
            aria-label={`${item.time}, ${item.tab}`}
            onClick={() => pick(i)}
            className="group relative flex cursor-pointer flex-col items-center text-center"
          >
            <span className={`text-xs tabular-nums transition-colors ${i === active ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{item.time}</span>
            <motion.span
              className={`mt-2.5 size-3.5 rounded-full border-2 transition-colors ${i <= active ? "border-accent bg-accent" : "border-foreground/25 bg-background group-hover:border-accent"}`}
              initial={false}
              animate={{ scale: i === active ? 1.35 : 1 }}
              transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 400, damping: 18 }}
            />
            <span className={`mt-2.5 hidden text-sm font-medium transition-colors sm:block ${i === active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"}`}>{item.tab}</span>
          </button>
        ))}
      </div>

      <div id="stop-panel" role="tabpanel" aria-labelledby={`stop-tab-${active}`} className="glass mx-auto mt-5 max-w-4xl rounded-3xl p-4 text-left sm:p-5">
        <p className="sr-only">
          {stop.tab}: {stop.say ?? stop.scene} {stop.pill}. {stop.note}
        </p>
        <div aria-hidden="true" className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-background/60">
            <div className="flex items-center gap-1.5 border-b border-border px-4 py-2.5">
              <span className="size-2 rounded-full bg-foreground/15" />
              <span className="size-2 rounded-full bg-foreground/15" />
              <span className="ml-1.5 truncate text-xs text-muted-foreground">{stop.window}</span>
            </div>
            <div className="flex min-h-40 flex-1 flex-col p-4">
              <p className="text-sm text-muted-foreground">{stop.scene}</p>
              <div ref={keys} className="mt-3 flex min-h-9 items-center gap-1.5">
                {stop.keys?.map((key) => (
                  <kbd key={key} className={`keycap font-sans transition-all duration-150 ${pressing ? "translate-y-0.5 !bg-accent text-white" : ""}`}>
                    {key}
                  </kbd>
                ))}
              </div>
              <p className="mt-3 min-h-12 font-medium">
                {stop.say &&
                  heard &&
                  stop.say.split(" ").map((word, i) => (
                    <motion.span
                      key={`${active}-${i}`}
                      className="mr-[0.25em] inline-block"
                      initial={reduce ? false : { opacity: 0, y: 6, filter: "blur(3px)" }}
                      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                      transition={{ duration: 0.3, delay: i * 0.19, ease: EASE }}
                    >
                      {word}
                    </motion.span>
                  ))}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-background/60 p-4">
            <p className="font-semibold">{stop.page}</p>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-start gap-2 px-2 text-muted-foreground">
                {stop.task !== false && <span className="mt-0.5 size-3.5 shrink-0 rounded-[4px] border border-foreground/30" />}
                {stop.earlier}
              </div>
              <motion.div
                ref={row}
                className="flex w-fit items-start gap-2 rounded-lg bg-accent/15 px-2 py-1 font-medium"
                initial={false}
                animate={done ? { opacity: 1, x: 0, scale: 1 } : { opacity: 0, x: -14, scale: 0.96 }}
                transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 20 }}
              >
                {stop.task !== false && <span className="mt-0.5 size-3.5 shrink-0 rounded-[4px] border border-foreground/40" />}
                {stop.added}
              </motion.div>
            </div>
            <motion.p
              className="mt-4 text-sm leading-relaxed text-muted-foreground"
              initial={false}
              animate={{ opacity: done ? 1 : 0 }}
              transition={{ duration: reduce ? 0 : 0.4 }}
            >
              {stop.note}
            </motion.p>
          </div>
        </div>

        {/* The pill. Its row keeps its height, so nothing jumps as the pill changes shape. */}
        <div aria-hidden="true" className="relative mt-4 flex h-24 flex-col items-center justify-end">
          <motion.div
            className="mb-2 flex items-center gap-2"
            initial={false}
            animate={chipsUp ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 8, scale: 0.9 }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 340, damping: 22 }}
          >
            <span
              ref={(el) => {
                chips.current.pomodoro = el;
              }}
              className={`${SHELL} flex h-8 items-center gap-2 px-3 text-xs tabular-nums ${phase === "aim" && stop.chip === "pomodoro" ? "ring-2 ring-rose-400/50" : ""}`}
            >
              <svg viewBox="0 0 18 18" className="size-[18px] -rotate-90">
                <circle cx="9" cy="9" r="7" fill="none" stroke="rgb(255 255 255 / 0.15)" strokeWidth="2.5" />
                {stop.chip === "pomodoro" && done && <circle cx="9" cy="9" r="7" fill="none" stroke="#fb7185" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="44" strokeDashoffset="42" />}
              </svg>
              {stop.chip === "pomodoro" && done ? stop.pill : "25:00"}
            </span>
            <span
              ref={(el) => {
                chips.current.save = el;
              }}
              className={`${SHELL} grid size-8 place-items-center transition-colors ${phase === "aim" && stop.chip === "save" ? "text-sky-200 ring-2 ring-sky-300/50" : "text-white/75"}`}
            >
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-4-6.5 4v-16a1 1 0 0 1 1-1Z" />
                <path d="M12 7.5v5M9.5 10h5" />
              </svg>
            </span>
          </motion.div>

          <div ref={pill} className="flex h-9 items-center">
            <motion.div
              key={`${active}-${done}-${pressing}`}
              initial={reduce ? false : { opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 380, damping: 26 }}
            >
              {pressing && stop.say ? (
                <span className={`${SHELL} flex h-9 items-center gap-2.5 px-4 text-sm`}>
                  <span className="flex h-5 items-center gap-[3px]">
                    {BARS.map((height, i) => (
                      <span key={i} className="bar w-[3px]" style={{ height, animationDelay: `${i * 90}ms` }} />
                    ))}
                  </span>
                  Dictating
                </span>
              ) : done && stop.chip !== "pomodoro" ? (
                <span className={`${SHELL} flex h-9 max-w-[85vw] items-center truncate px-4 text-sm whitespace-nowrap`}>{stop.pill}</span>
              ) : (
                <span className={`${SHELL} relative block h-4 w-20 overflow-hidden`}>
                  {stop.chip === "pomodoro" && done && <span className="absolute inset-y-0 left-0 w-[8%] bg-rose-400" />}
                </span>
              )}
            </motion.div>
          </div>
        </div>
      </div>

      {cursor && !reduce && (
        <motion.div
          className="pointer-events-none absolute top-0 left-0 z-20"
          aria-hidden="true"
          initial={{ x: cursor.x, y: cursor.y + 80, opacity: 0 }}
          animate={{ x: cursor.x, y: cursor.y, opacity: 1 }}
          transition={{ type: "spring", stiffness: 75, damping: 17, mass: 0.9, opacity: { duration: 0.3 } }}
        >
          {clicks > 0 && (
            <motion.span
              key={`ring-${clicks}`}
              className="absolute -top-5 -left-5 size-10 rounded-full border-2 border-accent"
              initial={{ scale: 0.2, opacity: 0.8 }}
              animate={{ scale: 1.2, opacity: 0 }}
              transition={{ duration: 0.55, ease: "easeOut" }}
            />
          )}
          <motion.svg
            key={`arrow-${clicks}`}
            viewBox="0 0 24 24"
            className="size-7 origin-top-left drop-shadow-md"
            initial={clicks > 0 ? { scale: 0.75 } : false}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 14 }}
          >
            <path d="M5 3l14 8.5-6.2 1.4L9.4 19z" fill="var(--foreground)" stroke="var(--background)" strokeWidth="1.5" strokeLinejoin="round" />
          </motion.svg>
        </motion.div>
      )}
    </div>
  );
}
