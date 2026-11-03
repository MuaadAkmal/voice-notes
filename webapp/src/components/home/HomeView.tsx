"use client";

import { useStore } from "@/app/providers";
import { homeCards, type HomeCard } from "@/lib/home";
import { cn } from "@/lib/utils";
import { PageCard } from "./PageCard";
import { QuickAddCard } from "./QuickAddCard";

// Static class names (Tailwind can't see computed ones): widths in a 2-column grid, then in the 4-column one.
const COLS_MD = { 1: "md:col-span-1", 2: "md:col-span-2", 3: "md:col-span-2", 4: "md:col-span-2" } as const;
const COLS_LG = { 1: "lg:col-span-1", 2: "lg:col-span-2", 3: "lg:col-span-3", 4: "lg:col-span-4" } as const;
const ROWS = { 1: "md:row-span-1", 2: "md:row-span-2", 3: "md:row-span-3", 4: "md:row-span-4" } as const;
// On a phone cards stack, each as tall as its rows on a wide screen at most.
const MAX_H = { 1: "max-md:max-h-[120px]", 2: "max-md:max-h-[252px]", 3: "max-md:max-h-[384px]", 4: "max-md:max-h-[516px]" } as const;

const sizeClass = (c: HomeCard) => {
  const w = c.w as 1 | 2 | 3 | 4;
  const h = c.h as 1 | 2 | 3 | 4;
  return cn(COLS_MD[w], COLS_LG[w], ROWS[h], MAX_H[h]);
};

/** The PCs' Home: the same cards in the same order and sizes, laid out on 4, 2 or 1 columns. */
export function HomeView() {
  const snap = useStore();
  const cards = homeCards(snap);
  return (
    <div>
      <h1 className="mb-8 text-4xl font-semibold tracking-tight">Home</h1>
      {cards.length === 0 ? (
        <p className="text-muted-foreground">Pin pages to Home on your PC to see them here.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:auto-rows-[120px] md:grid-cols-2 lg:grid-cols-4">
          {cards.map((card) => (
            <section key={card.id} className={cn("flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-xs", sizeClass(card))}>
              {card.type === "page" ? <PageCard pageId={card.pageId} /> : <QuickAddCard pageId={card.pageId} />}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
