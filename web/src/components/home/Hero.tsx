import { DownloadButton } from "../DownloadButton";
import { HeroMedia } from "../HeroMedia";

// A fixed shape, so the server and every visit draw the same waveform.
const BARS = Array.from({ length: 120 },(_, i) => Math.round(18 + 74 * Math.abs(Math.sin(i * 0.61) * Math.cos(i * 0.23))));
const SAVED_FROM = BARS.length - 14;

export function Hero() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
      <div className="overflow-hidden rounded-2xl bg-screen px-5 pt-20 pb-6 sm:px-10 sm:pt-32">
        <h1 className="text-center text-5xl leading-[1.05] font-semibold text-subtitle sm:text-7xl lg:text-8xl">
          What did they just say?
        </h1>
        <div className="mt-14 flex h-16 items-center justify-end gap-1 sm:mt-24 sm:h-20" aria-hidden="true">
          {BARS.map((height, i) =>
            i < SAVED_FROM ? (
              <span key={i} className="w-1.5 shrink-0 rounded-full bg-screen-foreground/35" style={{ height: `${height}%` }} />
            ) : (
              <span
                key={i}
                className="saved-bar w-1.5 shrink-0 rounded-full bg-subtitle"
                style={{ height: `${height}%`, animationDelay: `${(i - SAVED_FROM) * 45}ms` }}
              />
            ),
          )}
        </div>
      </div>

      <div className="mt-10 grid items-start gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,8fr)] lg:gap-14">
        <div>
          <p className="text-xl leading-relaxed sm:text-2xl">
            Press one shortcut to save the line you just heard from any show, film or video on your PC. Listen again, and read it as text.
          </p>
          <div className="mt-7">
            <DownloadButton />
          </div>
        </div>
        <HeroMedia />
      </div>
    </section>
  );
}
