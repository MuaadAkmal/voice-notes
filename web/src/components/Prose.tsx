import type { ReactNode } from "react";
import { Footer } from "./Footer";
import { Header } from "./Header";

/** The frame and text styles for long-form pages. */
export function Prose({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <>
      <Header />
      {/* Same width and side padding as the header, so the card lines up with the navbar. */}
      <main className="mx-auto w-full max-w-5xl flex-1 px-3 pt-12 pb-16 sm:px-6">
        <div className="glass rounded-3xl px-6 py-10 sm:px-12 sm:py-14">
          <h1 className="text-4xl font-semibold sm:text-5xl">{title}</h1>
          <p className="mt-3 text-sm text-muted-foreground">Last updated {updated}</p>
          <div className="mt-8 space-y-4 leading-relaxed [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mt-10 [&_h2]:text-2xl [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
            {children}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
